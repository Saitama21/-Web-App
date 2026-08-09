import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import pg from 'pg';
import * as cheerio from 'cheerio';

const { Pool } = pg;
const app = express();
const PORT = Number(process.env.PORT || 3000);
const VERSION = '1.1.10';
const DATABASE_URL = String(process.env.DATABASE_URL || '');
const LEGACY_APP_PASSWORD = String(process.env.APP_PASSWORD || '');
const ADMIN_EMAIL = normalizeEmail(process.env.ADMIN_EMAIL || 'admin@hochu.local');
const ADMIN_USERNAME = normalizeUsername(process.env.ADMIN_USERNAME || 'admin');
const ADMIN_NAME = cleanShort(process.env.ADMIN_NAME || 'Иван', 80) || 'Иван';
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || LEGACY_APP_PASSWORD || '');
const COOKIE_NAME = 'hochu_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const RESET_TTL_MS = 1000 * 60 * 30;

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());
app.use(express.static('public', {
  extensions: ['html'],
  maxAge: 0,
  etag: false,
  setHeaders(res, filePath) {
    if (/\.(?:html|css|js|webmanifest)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false }
}) : null;

// In-memory fallback keeps local development/test mode working without PostgreSQL.
const mem = {
  users: [], sessions: new Map(), items: [], accessRequests: [], resetRequests: [], resetTokens: [], invitations: [], audit: []
};

function cleanShort(value='', max=120) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0,max); }
function normalizeEmail(value='') { return String(value ?? '').trim().toLowerCase().slice(0,254); }
function normalizeUsername(value='') { return String(value ?? '').trim().toLowerCase().replace(/\s+/g,'').slice(0,40); }
function validEmail(value='') { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value)); }
function validUsername(value='') { return /^[\p{L}\p{N}][\p{L}\p{N}._-]{2,39}$/u.test(normalizeUsername(value)); }
function tokenHash(token='') { return crypto.createHash('sha256').update(String(token)).digest('hex'); }

function scryptAsync(password,salt,keylen=64){ return new Promise((resolve,reject)=>crypto.scrypt(password,salt,keylen,(err,key)=>err?reject(err):resolve(key))); }
async function hashPassword(password){ const salt=crypto.randomBytes(16).toString('hex'); const key=await scryptAsync(String(password),salt); return `scrypt$${salt}$${key.toString('hex')}`; }
async function verifyPassword(password,stored=''){ try{ const [kind,salt,hex]=String(stored).split('$'); if(kind!=='scrypt'||!salt||!hex)return false; const key=await scryptAsync(String(password),salt,Buffer.from(hex,'hex').length); const expected=Buffer.from(hex,'hex'); return key.length===expected.length&&crypto.timingSafeEqual(key,expected);}catch{return false;} }
function newRawToken(bytes=32) { return crypto.randomBytes(bytes).toString('base64url'); }
function cookieOptions(maxAge=SESSION_TTL_MS) {
  return { httpOnly:true, sameSite:'lax', secure:Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV==='production'), maxAge, path:'/' };
}
function safeUser(u) {
  if (!u) return null;
  return { id:u.id, name:u.name, username:u.username, email:u.email, role:u.role, status:u.status, createdAt:u.created_at||u.createdAt, lastLoginAt:u.last_login_at||u.lastLoginAt };
}
function appOrigin(req) { return `${req.protocol}://${req.get('host')}`; }

// Basic same-origin guard for browser mutations. SameSite cookies remain the main CSRF boundary.
app.use('/api', (req,res,next) => {
  if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({error:'Недопустимый источник запроса.'}); }
  catch { return res.status(403).json({error:'Недопустимый источник запроса.'}); }
  next();
});

const rate = new Map();
function rateLimit(bucket, max=12, windowMs=60_000) {
  return (req,res,next) => {
    const key=`${bucket}:${req.ip}`; const now=Date.now();
    let v=rate.get(key); if(!v || now-v.start>windowMs) v={start:now,count:0}; v.count++; rate.set(key,v);
    if(v.count>max) return res.status(429).json({error:'Слишком много попыток. Попробуй чуть позже.'});
    next();
  };
}

async function audit(actorUserId, action, targetUserId=null, details={}) {
  try {
    if (pool) await pool.query('INSERT INTO audit_log(actor_user_id,action,target_user_id,details) VALUES($1,$2,$3,$4)',[actorUserId,action,targetUserId,JSON.stringify(details)]);
    else mem.audit.unshift({actorUserId,action,targetUserId,details,createdAt:new Date().toISOString()});
  } catch {}
}

async function initDb() {
  if (!pool) { await ensureMemoryAdmin(); return; }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users((LOWER(email)))`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users((LOWER(username)))`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invitations (
      id UUID PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL DEFAULT '',
      max_uses INTEGER NOT NULL DEFAULT 1,
      uses INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS access_requests (
      id UUID PRIMARY KEY,
      invitation_id UUID REFERENCES invitations(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      username TEXT NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS access_requests_status_idx ON access_requests(status)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_requests (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wishlist_items (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '',
      store TEXT NOT NULL DEFAULT '',
      store_domain TEXT NOT NULL DEFAULT '',
      variant TEXT NOT NULL DEFAULT '',
      price NUMERIC(14,2) NOT NULL DEFAULT 0,
      saved NUMERIC(14,2) NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'Другое',
      priority INTEGER NOT NULL DEFAULT 2,
      status TEXT NOT NULL DEFAULT 'want',
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      purchased_at TIMESTAMPTZ
    )
  `);
  await pool.query(`ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE`);
  await pool.query(`ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS variant TEXT NOT NULL DEFAULT ''`);
  const admin = await ensureDbAdmin();
  if (admin) await pool.query('UPDATE wishlist_items SET user_id=$1 WHERE user_id IS NULL',[admin.id]);
  await pool.query(`CREATE INDEX IF NOT EXISTS wishlist_user_idx ON wishlist_items(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS wishlist_status_idx ON wishlist_items(user_id,status)`);
  await pool.query(`DELETE FROM sessions WHERE expires_at < NOW()`);
  await pool.query(`DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR used_at IS NOT NULL`);
}

async function ensureDbAdmin() {
  let q = await pool.query(`SELECT * FROM users WHERE role='admin' ORDER BY created_at LIMIT 1`);
  if (q.rowCount) {
    // Railway ADMIN_* values are the source of truth for the owner account.
    // This also repairs an admin that was created by an older migration with legacy credentials.
    let admin = q.rows[0];
    const desiredUsername = ADMIN_USERNAME || admin.username;
    const desiredEmail = ADMIN_EMAIL || admin.email;
    const desiredName = ADMIN_NAME || admin.name;
    let desiredHash = admin.password_hash;
    if (ADMIN_PASSWORD && !(await verifyPassword(ADMIN_PASSWORD, admin.password_hash))) {
      desiredHash = await hashPassword(ADMIN_PASSWORD);
    }
    try {
      const updated = await pool.query(`
        UPDATE users SET name=$2, username=$3, email=$4, password_hash=$5, role='admin', status='active'
        WHERE id=$1 RETURNING *
      `,[admin.id,desiredName,desiredUsername,desiredEmail,desiredHash]);
      return updated.rows[0];
    } catch (err) {
      console.error('ADMIN_* sync failed (possible username/email conflict):', err.message);
      return admin;
    }
  }
  if (!ADMIN_PASSWORD) return null;
  const hash = await hashPassword(ADMIN_PASSWORD);
  const id=crypto.randomUUID();
  q=await pool.query(`INSERT INTO users(id,name,username,email,password_hash,role,status) VALUES($1,$2,$3,$4,$5,'admin','active') RETURNING *`,[id,ADMIN_NAME,ADMIN_USERNAME,ADMIN_EMAIL,hash]);
  return q.rows[0];
}
async function ensureMemoryAdmin() {
  if (mem.users.some(u=>u.role==='admin') || !ADMIN_PASSWORD) return;
  mem.users.push({id:crypto.randomUUID(),name:ADMIN_NAME,username:ADMIN_USERNAME,email:ADMIN_EMAIL,password_hash:await hashPassword(ADMIN_PASSWORD),role:'admin',status:'active',createdAt:new Date().toISOString(),lastLoginAt:null});
}

async function getSessionUser(req) {
  const raw=String(req.cookies?.[COOKIE_NAME]||''); if(!raw) return null; const hash=tokenHash(raw);
  if (pool) {
    const q=await pool.query(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.status='active' LIMIT 1`,[hash]);
    if(!q.rowCount) return null;
    pool.query('UPDATE sessions SET last_seen_at=NOW() WHERE token_hash=$1',[hash]).catch(()=>{});
    return q.rows[0];
  }
  const s=mem.sessions.get(hash); if(!s || s.expiresAt<Date.now()) return null;
  const u=mem.users.find(x=>x.id===s.userId && x.status==='active'); return u||null;
}
async function createSession(res,user) {
  const raw=newRawToken(); const hash=tokenHash(raw); const expires=new Date(Date.now()+SESSION_TTL_MS);
  if(pool) await pool.query('INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,$4)',[crypto.randomUUID(),user.id,hash,expires]);
  else mem.sessions.set(hash,{userId:user.id,expiresAt:expires.getTime()});
  res.cookie(COOKIE_NAME,raw,cookieOptions());
}
async function destroySession(req,res) {
  const raw=String(req.cookies?.[COOKIE_NAME]||''); if(raw){const hash=tokenHash(raw); if(pool) await pool.query('DELETE FROM sessions WHERE token_hash=$1',[hash]); else mem.sessions.delete(hash);} res.clearCookie(COOKIE_NAME,{path:'/'});
}
async function requireAuth(req,res,next){ const u=await getSessionUser(req); if(!u)return res.status(401).json({error:'unauthorized'}); req.user=u; next(); }
function requireAdmin(req,res,next){ if(req.user?.role!=='admin')return res.status(403).json({error:'Доступ только для администратора.'}); next(); }

function mapRow(r) {
  return {id:r.id,title:r.title,url:r.url||'',image:r.image||'',store:r.store||'',storeDomain:r.store_domain||r.storeDomain||'',variant:r.variant||'',price:Number(r.price||0),saved:Number(r.saved||0),category:r.category||'Другое',priority:Number(r.priority||2),status:r.status||'want',note:r.note||'',createdAt:r.created_at||r.createdAt,updatedAt:r.updated_at||r.updatedAt,purchasedAt:r.purchased_at||r.purchasedAt};
}
function cleanItem(x={}) {
  const allowedStatus=new Set(['want','plan','ordered','bought','paused']);
  return {title:cleanShort(x.title,250),url:cleanShort(x.url,2000),image:cleanShort(x.image,4000),store:cleanShort(x.store,120),storeDomain:cleanShort(x.storeDomain,250),variant:cleanShort(x.variant,80),price:Math.max(0,Number(x.price||0)),saved:Math.max(0,Number(x.saved||0)),category:cleanShort(x.category||'Другое',80),priority:Math.min(4,Math.max(1,Number(x.priority||2))),status:allowedStatus.has(String(x.status))?String(x.status):'want',note:cleanShort(x.note,2000)};
}

// ----- Public/auth endpoints -----
app.get('/api/health', async (req,res)=>{
  let database='memory'; if(pool){try{await pool.query('SELECT 1');database='postgresql'}catch{database='error'}}
  let adminReady=Boolean(ADMIN_PASSWORD); if(pool){const q=await pool.query(`SELECT 1 FROM users WHERE role='admin' LIMIT 1`);adminReady=Boolean(q.rowCount)}
  res.json({ok:true,app:'Хочу',version:VERSION,database,adminReady});
});
app.get('/api/me', async (req,res)=>{ const u=await getSessionUser(req); res.json({authenticated:Boolean(u),user:safeUser(u),version:VERSION}); });
app.post('/api/login', rateLimit('login',10,60_000), async (req,res)=>{
  const login=String(req.body?.login||'').trim().toLowerCase(), password=String(req.body?.password||'');
  if(!login||!password)return res.status(400).json({error:'Укажи логин/email и пароль.'});
  let u;
  if(pool){const q=await pool.query('SELECT * FROM users WHERE LOWER(username)=$1 OR LOWER(email)=$1 LIMIT 1',[login]);u=q.rows[0];}
  else u=mem.users.find(x=>x.username.toLowerCase()===login||x.email.toLowerCase()===login);
  if(!u || !(await verifyPassword(password,u.password_hash)))return res.status(401).json({error:'Неверный логин или пароль.'});
  if(u.status==='blocked')return res.status(403).json({error:'Аккаунт заблокирован администратором.'});
  if(u.status!=='active')return res.status(403).json({error:'Аккаунт пока не активирован.'});
  if(pool)await pool.query('UPDATE users SET last_login_at=NOW() WHERE id=$1',[u.id]);else u.lastLoginAt=new Date().toISOString();
  await createSession(res,u); await audit(u.id,'login',u.id); res.json({ok:true,user:safeUser(u)});
});
app.post('/api/logout', async (req,res)=>{const u=await getSessionUser(req);await destroySession(req,res);if(u)await audit(u.id,'logout',u.id);res.json({ok:true});});

app.get('/api/invite/validate', async (req,res)=>{
  const token=String(req.query.token||''); if(!token)return res.json({valid:false}); const hash=tokenHash(token);
  if(pool){const q=await pool.query(`SELECT id,label,max_uses,uses,expires_at FROM invitations WHERE token_hash=$1 AND active=TRUE AND expires_at>NOW() AND uses<max_uses LIMIT 1`,[hash]);return res.json(q.rowCount?{valid:true,label:q.rows[0].label}:{valid:false});}
  const x=mem.invitations.find(i=>i.tokenHash===hash&&i.active&&i.expiresAt>Date.now()&&i.uses<i.maxUses);res.json(x?{valid:true,label:x.label}:{valid:false});
});
app.post('/api/access-request', rateLimit('access',5,10*60_000), async (req,res)=>{
  const name=cleanShort(req.body?.name,80),username=normalizeUsername(req.body?.username),email=normalizeEmail(req.body?.email),password=String(req.body?.password||''),message=cleanShort(req.body?.message,500),inviteToken=String(req.body?.inviteToken||'');
  if(!name)return res.status(400).json({error:'Укажи имя.'});
  if(!validUsername(username))return res.status(400).json({error:'Логин: минимум 3 символа. Можно буквы, цифры, точку, дефис и подчёркивание.'});
  if(!validEmail(email))return res.status(400).json({error:'Проверь email — адрес выглядит некорректно.'});
  if(password.length<8)return res.status(400).json({error:'Пароль должен содержать минимум 8 символов.'});
  const inviteHash=tokenHash(inviteToken); let invite=null;
  if(pool){const iq=await pool.query(`SELECT * FROM invitations WHERE token_hash=$1 AND active=TRUE AND expires_at>NOW() AND uses<max_uses LIMIT 1`,[inviteHash]);invite=iq.rows[0];}
  else invite=mem.invitations.find(i=>i.tokenHash===inviteHash&&i.active&&i.expiresAt>Date.now()&&i.uses<i.maxUses);
  if(!invite)return res.status(403).json({error:'Нужна действующая ссылка-приглашение от администратора.'});
  const passwordHash=await hashPassword(password);
  if(pool){
    const exists=await pool.query(`SELECT 1 FROM users WHERE LOWER(email)=$1 OR LOWER(username)=$2 UNION ALL SELECT 1 FROM access_requests WHERE status='pending' AND (LOWER(email)=$1 OR LOWER(username)=$2) LIMIT 1`,[email,username]);
    if(exists.rowCount)return res.status(409).json({error:'Такой email или логин уже используется либо заявка уже отправлена.'});
    const pending=await pool.query(`SELECT COUNT(*)::int AS c FROM access_requests WHERE invitation_id=$1 AND status='pending'`,[invite.id]);
    if(Number(invite.uses)+Number(pending.rows[0].c)>=Number(invite.max_uses))return res.status(409).json({error:'Это приглашение уже используется.'});
    await pool.query(`INSERT INTO access_requests(id,invitation_id,name,username,email,password_hash,message) VALUES($1,$2,$3,$4,$5,$6,$7)`,[crypto.randomUUID(),invite.id,name,username,email,passwordHash,message]);
  } else {
    if(mem.users.some(u=>u.email===email||u.username===username)||mem.accessRequests.some(r=>r.status==='pending'&&(r.email===email||r.username===username)))return res.status(409).json({error:'Такой email или логин уже используется либо заявка уже отправлена.'});
    mem.accessRequests.push({id:crypto.randomUUID(),invitationId:invite.id,name,username,email,passwordHash,message,status:'pending',createdAt:new Date().toISOString()});
  }
  res.json({ok:true,message:'Заявка отправлена. После одобрения администратором можно будет войти.'});
});
app.post('/api/password-reset/request', rateLimit('reset-request',5,10*60_000), async (req,res)=>{
  const key=String(req.body?.login||'').trim().toLowerCase();
  if(pool){const q=await pool.query(`SELECT id,email FROM users WHERE LOWER(email)=$1 OR LOWER(username)=$1 LIMIT 1`,[key]); if(q.rowCount){const u=q.rows[0]; const p=await pool.query(`SELECT 1 FROM password_reset_requests WHERE user_id=$1 AND status='pending' LIMIT 1`,[u.id]); if(!p.rowCount)await pool.query(`INSERT INTO password_reset_requests(id,user_id,email) VALUES($1,$2,$3)`,[crypto.randomUUID(),u.id,u.email]);}}
  else {const u=mem.users.find(x=>x.email===key||x.username===key);if(u&&!mem.resetRequests.some(r=>r.userId===u.id&&r.status==='pending'))mem.resetRequests.push({id:crypto.randomUUID(),userId:u.id,email:u.email,status:'pending',createdAt:new Date().toISOString()});}
  res.json({ok:true,message:'Если аккаунт существует, запрос на сброс передан администратору.'});
});
app.get('/api/password-reset/validate', async (req,res)=>{
  const hash=tokenHash(req.query.token||''); if(!hash)return res.json({valid:false});
  if(pool){const q=await pool.query(`SELECT u.username FROM password_reset_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.used_at IS NULL AND t.expires_at>NOW() LIMIT 1`,[hash]);return res.json(q.rowCount?{valid:true,username:q.rows[0].username}:{valid:false});}
  const t=mem.resetTokens.find(x=>x.tokenHash===hash&&!x.usedAt&&x.expiresAt>Date.now());const u=t&&mem.users.find(x=>x.id===t.userId);res.json(u?{valid:true,username:u.username}:{valid:false});
});
app.post('/api/password-reset/complete', rateLimit('reset-complete',8,10*60_000), async (req,res)=>{
  const hash=tokenHash(req.body?.token||''),password=String(req.body?.password||''); if(password.length<8)return res.status(400).json({error:'Пароль должен быть не короче 8 символов.'});
  const passwordHash=await hashPassword(password);
  if(pool){const client=await pool.connect();try{await client.query('BEGIN');const q=await client.query(`SELECT * FROM password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW() LIMIT 1 FOR UPDATE`,[hash]);if(!q.rowCount){await client.query('ROLLBACK');return res.status(400).json({error:'Ссылка сброса недействительна или истекла.'});}const t=q.rows[0];await client.query('UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2',[passwordHash,t.user_id]);await client.query('UPDATE password_reset_tokens SET used_at=NOW() WHERE id=$1',[t.id]);await client.query(`UPDATE password_reset_requests SET status='resolved',resolved_at=NOW() WHERE user_id=$1 AND status IN ('pending','link_issued')`,[t.user_id]);await client.query('DELETE FROM sessions WHERE user_id=$1',[t.user_id]);await client.query('COMMIT');await audit(t.user_id,'password_reset_complete',t.user_id);}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}
  else {const t=mem.resetTokens.find(x=>x.tokenHash===hash&&!x.usedAt&&x.expiresAt>Date.now());if(!t)return res.status(400).json({error:'Ссылка сброса недействительна или истекла.'});const u=mem.users.find(x=>x.id===t.userId);u.password_hash=passwordHash;t.usedAt=Date.now();mem.resetRequests.filter(r=>r.userId===u.id&&r.status==='pending').forEach(r=>r.status='resolved');for(const [k,s] of mem.sessions)if(s.userId===u.id)mem.sessions.delete(k);}
  res.json({ok:true,message:'Пароль изменён. Теперь можно войти.'});
});

// ----- Authenticated profile -----
app.patch('/api/profile', requireAuth, async (req,res)=>{const name=cleanShort(req.body?.name,80);if(!name)return res.status(400).json({error:'Имя не может быть пустым.'});if(pool){const q=await pool.query('UPDATE users SET name=$1,updated_at=NOW() WHERE id=$2 RETURNING *',[name,req.user.id]);res.json({user:safeUser(q.rows[0])});}else{req.user.name=name;res.json({user:safeUser(req.user)});}});

// ----- User-owned wishlist -----
app.get('/api/items', requireAuth, async (req,res)=>{
  if(!pool)return res.json(mem.items.filter(x=>x.userId===req.user.id));
  const q=await pool.query(`SELECT * FROM wishlist_items WHERE user_id=$1 ORDER BY CASE WHEN status='bought' THEN 1 ELSE 0 END,priority DESC,created_at DESC`,[req.user.id]);res.json(q.rows.map(mapRow));
});
app.post('/api/items', requireAuth, async (req,res)=>{
  const x=cleanItem(req.body);if(!x.title)return res.status(400).json({error:'Укажи название товара.'});const id=crypto.randomUUID();
  if(!pool){const now=new Date().toISOString();const item={id,userId:req.user.id,...x,createdAt:now,updatedAt:now,purchasedAt:x.status==='bought'?now:null};mem.items.unshift(item);return res.status(201).json(item);}
  const q=await pool.query(`INSERT INTO wishlist_items(id,user_id,title,url,image,store,store_domain,variant,price,saved,category,priority,status,note,purchased_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CASE WHEN $13='bought' THEN NOW() ELSE NULL END) RETURNING *`,[id,req.user.id,x.title,x.url,x.image,x.store,x.storeDomain,x.variant,x.price,x.saved,x.category,x.priority,x.status,x.note]);res.status(201).json(mapRow(q.rows[0]));
});
app.put('/api/items/:id', requireAuth, async (req,res)=>{
  const x=cleanItem(req.body);if(!x.title)return res.status(400).json({error:'Укажи название товара.'});
  if(!pool){const i=mem.items.findIndex(v=>v.id===req.params.id&&v.userId===req.user.id);if(i<0)return res.status(404).json({error:'Не найдено'});const was=mem.items[i].status==='bought';mem.items[i]={...mem.items[i],...x,updatedAt:new Date().toISOString(),purchasedAt:x.status==='bought'?(was?mem.items[i].purchasedAt:new Date().toISOString()):null};return res.json(mem.items[i]);}
  const q=await pool.query(`UPDATE wishlist_items SET title=$3,url=$4,image=$5,store=$6,store_domain=$7,variant=$8,price=$9,saved=$10,category=$11,priority=$12,status=$13,note=$14,updated_at=NOW(),purchased_at=CASE WHEN $13='bought' THEN COALESCE(purchased_at,NOW()) ELSE NULL END WHERE id=$1 AND user_id=$2 RETURNING *`,[req.params.id,req.user.id,x.title,x.url,x.image,x.store,x.storeDomain,x.variant,x.price,x.saved,x.category,x.priority,x.status,x.note]);if(!q.rowCount)return res.status(404).json({error:'Не найдено'});res.json(mapRow(q.rows[0]));
});
app.delete('/api/items/:id', requireAuth, async (req,res)=>{if(!pool){const i=mem.items.findIndex(v=>v.id===req.params.id&&v.userId===req.user.id);if(i<0)return res.status(404).json({error:'Не найдено'});mem.items.splice(i,1);return res.json({ok:true});}const q=await pool.query('DELETE FROM wishlist_items WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(!q.rowCount)return res.status(404).json({error:'Не найдено'});res.json({ok:true});});

// ----- Admin -----
app.get('/api/admin/overview', requireAuth, requireAdmin, async (req,res)=>{
  if(pool){const [u,a,r,w]=await Promise.all([pool.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE status='active')::int active,COUNT(*) FILTER(WHERE status='blocked')::int blocked FROM users`),pool.query(`SELECT COUNT(*)::int c FROM access_requests WHERE status='pending'`),pool.query(`SELECT COUNT(*)::int c FROM password_reset_requests WHERE status='pending'`),pool.query(`SELECT COUNT(*)::int items,COALESCE(SUM(price),0) total_price,COALESCE(SUM(saved),0) total_saved FROM wishlist_items`)]);return res.json({users:u.rows[0],pendingAccess:a.rows[0].c,pendingResets:r.rows[0].c,wishlist:{items:w.rows[0].items,totalPrice:Number(w.rows[0].total_price),totalSaved:Number(w.rows[0].total_saved)}});}
  res.json({users:{total:mem.users.length,active:mem.users.filter(x=>x.status==='active').length,blocked:mem.users.filter(x=>x.status==='blocked').length},pendingAccess:mem.accessRequests.filter(x=>x.status==='pending').length,pendingResets:mem.resetRequests.filter(x=>x.status==='pending').length,wishlist:{items:mem.items.length,totalPrice:mem.items.reduce((s,x)=>s+x.price,0),totalSaved:mem.items.reduce((s,x)=>s+x.saved,0)}});
});
app.get('/api/admin/users', requireAuth, requireAdmin, async (req,res)=>{
  if(pool){const q=await pool.query(`SELECT u.id,u.name,u.username,u.email,u.role,u.status,u.created_at,u.last_login_at,COUNT(w.id)::int item_count,COALESCE(SUM(w.price),0) total_price,COALESCE(SUM(w.saved),0) total_saved FROM users u LEFT JOIN wishlist_items w ON w.user_id=u.id GROUP BY u.id ORDER BY CASE WHEN u.role='admin' THEN 0 ELSE 1 END,u.created_at`);return res.json(q.rows.map(x=>({...safeUser(x),itemCount:x.item_count,totalPrice:Number(x.total_price),totalSaved:Number(x.total_saved)})));}
  res.json(mem.users.map(u=>{const arr=mem.items.filter(i=>i.userId===u.id);return{...safeUser(u),itemCount:arr.length,totalPrice:arr.reduce((s,x)=>s+x.price,0),totalSaved:arr.reduce((s,x)=>s+x.saved,0)}}));
});
app.get('/api/admin/access-requests', requireAuth, requireAdmin, async (req,res)=>{if(pool){const q=await pool.query(`SELECT r.id,r.name,r.username,r.email,r.message,r.status,r.created_at,i.label invite_label FROM access_requests r LEFT JOIN invitations i ON i.id=r.invitation_id WHERE r.status='pending' ORDER BY r.created_at`);return res.json(q.rows);}res.json(mem.accessRequests.filter(x=>x.status==='pending'));});
app.post('/api/admin/access-requests/:id/approve', requireAuth, requireAdmin, async (req,res)=>{
  if(pool){const client=await pool.connect();try{await client.query('BEGIN');const q=await client.query(`SELECT * FROM access_requests WHERE id=$1 AND status='pending' FOR UPDATE`,[req.params.id]);if(!q.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Заявка не найдена.'});}const r=q.rows[0];const dup=await client.query('SELECT 1 FROM users WHERE LOWER(email)=LOWER($1) OR LOWER(username)=LOWER($2) LIMIT 1',[r.email,r.username]);if(dup.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'Пользователь с таким логином или email уже существует.'});}const id=crypto.randomUUID();await client.query(`INSERT INTO users(id,name,username,email,password_hash,role,status) VALUES($1,$2,$3,$4,$5,'user','active')`,[id,r.name,r.username,r.email,r.password_hash]);await client.query(`UPDATE access_requests SET status='approved',reviewed_at=NOW(),reviewed_by=$2 WHERE id=$1`,[r.id,req.user.id]);if(r.invitation_id)await client.query(`UPDATE invitations SET uses=uses+1,active=CASE WHEN uses+1>=max_uses THEN FALSE ELSE active END WHERE id=$1`,[r.invitation_id]);await client.query('COMMIT');await audit(req.user.id,'access_approved',id,{requestId:r.id});return res.json({ok:true});}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}
  const r=mem.accessRequests.find(x=>x.id===req.params.id&&x.status==='pending');if(!r)return res.status(404).json({error:'Заявка не найдена.'});const id=crypto.randomUUID();mem.users.push({id,name:r.name,username:r.username,email:r.email,password_hash:r.passwordHash,role:'user',status:'active',createdAt:new Date().toISOString()});r.status='approved';const inv=mem.invitations.find(i=>i.id===r.invitationId);if(inv){inv.uses++;if(inv.uses>=inv.maxUses)inv.active=false;}await audit(req.user.id,'access_approved',id);res.json({ok:true});
});
app.post('/api/admin/access-requests/:id/decline', requireAuth, requireAdmin, async (req,res)=>{if(pool){const q=await pool.query(`UPDATE access_requests SET status='declined',reviewed_at=NOW(),reviewed_by=$2 WHERE id=$1 AND status='pending' RETURNING id`,[req.params.id,req.user.id]);if(!q.rowCount)return res.status(404).json({error:'Заявка не найдена.'});}else{const r=mem.accessRequests.find(x=>x.id===req.params.id&&x.status==='pending');if(!r)return res.status(404).json({error:'Заявка не найдена.'});r.status='declined';}await audit(req.user.id,'access_declined',null,{requestId:req.params.id});res.json({ok:true});});
app.get('/api/admin/reset-requests', requireAuth, requireAdmin, async (req,res)=>{if(pool){const q=await pool.query(`SELECT r.id,r.email,r.created_at,u.id user_id,u.name,u.username FROM password_reset_requests r JOIN users u ON u.id=r.user_id WHERE r.status='pending' ORDER BY r.created_at`);return res.json(q.rows);}res.json(mem.resetRequests.filter(x=>x.status==='pending').map(r=>({...r,user:mem.users.find(u=>u.id===r.userId)})));});
app.post('/api/admin/users/:id/reset-link', requireAuth, requireAdmin, async (req,res)=>{
  const raw=newRawToken();const hash=tokenHash(raw);const expires=new Date(Date.now()+RESET_TTL_MS);let exists=false;
  if(pool){const q=await pool.query('SELECT id FROM users WHERE id=$1 LIMIT 1',[req.params.id]);exists=Boolean(q.rowCount);if(exists){await pool.query(`UPDATE password_reset_tokens SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL`,[req.params.id]);await pool.query(`INSERT INTO password_reset_tokens(id,user_id,token_hash,expires_at,created_by) VALUES($1,$2,$3,$4,$5)`,[crypto.randomUUID(),req.params.id,hash,expires,req.user.id]);await pool.query(`UPDATE password_reset_requests SET status='link_issued',resolved_at=NOW() WHERE user_id=$1 AND status='pending'`,[req.params.id]);}}
  else{exists=mem.users.some(u=>u.id===req.params.id);if(exists){mem.resetTokens.filter(t=>t.userId===req.params.id&&!t.usedAt).forEach(t=>t.usedAt=Date.now());mem.resetTokens.push({id:crypto.randomUUID(),userId:req.params.id,tokenHash:hash,expiresAt:expires.getTime(),createdBy:req.user.id});mem.resetRequests.filter(r=>r.userId===req.params.id&&r.status==='pending').forEach(r=>r.status='link_issued');}}
  if(!exists)return res.status(404).json({error:'Пользователь не найден.'});await audit(req.user.id,'password_reset_link_created',req.params.id);res.json({ok:true,url:`${appOrigin(req)}/?reset=${encodeURIComponent(raw)}`,expiresAt:expires.toISOString()});
});
app.patch('/api/admin/users/:id/status', requireAuth, requireAdmin, async (req,res)=>{if(req.params.id===req.user.id)return res.status(400).json({error:'Нельзя заблокировать самого себя.'});const status=req.body?.status==='blocked'?'blocked':'active';if(pool){const q=await pool.query(`UPDATE users SET status=$2,updated_at=NOW() WHERE id=$1 AND role<>'admin' RETURNING id`,[req.params.id,status]);if(!q.rowCount)return res.status(404).json({error:'Пользователь не найден.'});if(status==='blocked')await pool.query('DELETE FROM sessions WHERE user_id=$1',[req.params.id]);}else{const u=mem.users.find(x=>x.id===req.params.id&&x.role!=='admin');if(!u)return res.status(404).json({error:'Пользователь не найден.'});u.status=status;if(status==='blocked')for(const [k,s] of mem.sessions)if(s.userId===u.id)mem.sessions.delete(k);}await audit(req.user.id,status==='blocked'?'user_blocked':'user_unblocked',req.params.id);res.json({ok:true});});
app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req,res)=>{if(req.params.id===req.user.id)return res.status(400).json({error:'Нельзя удалить самого себя.'});if(pool){const q=await pool.query(`DELETE FROM users WHERE id=$1 AND role<>'admin' RETURNING id`,[req.params.id]);if(!q.rowCount)return res.status(404).json({error:'Пользователь не найден.'});}else{const i=mem.users.findIndex(x=>x.id===req.params.id&&x.role!=='admin');if(i<0)return res.status(404).json({error:'Пользователь не найден.'});mem.users.splice(i,1);mem.items=mem.items.filter(x=>x.userId!==req.params.id);}await audit(req.user.id,'user_deleted',req.params.id);res.json({ok:true});});
app.post('/api/admin/invitations', requireAuth, requireAdmin, async (req,res)=>{const label=cleanShort(req.body?.label||'Друг',100),days=Math.min(30,Math.max(1,Number(req.body?.days||7))),maxUses=Math.min(20,Math.max(1,Number(req.body?.maxUses||1)));const raw=newRawToken();const hash=tokenHash(raw);const expires=new Date(Date.now()+days*86400000);if(pool)await pool.query(`INSERT INTO invitations(id,token_hash,label,max_uses,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6)`,[crypto.randomUUID(),hash,label,maxUses,expires,req.user.id]);else mem.invitations.push({id:crypto.randomUUID(),tokenHash:hash,label,maxUses,uses:0,active:true,expiresAt:expires.getTime(),createdBy:req.user.id});await audit(req.user.id,'invite_created',null,{label,maxUses});res.json({ok:true,url:`${appOrigin(req)}/?invite=${encodeURIComponent(raw)}`,expiresAt:expires.toISOString(),maxUses});});

function findProductJsonLd($) {
  const roots = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try { roots.push(JSON.parse($(el).contents().text())); } catch {}
  });
  const queue = [...roots];
  while (queue.length) {
    const x = queue.shift();
    if (!x) continue;
    if (Array.isArray(x)) { queue.push(...x); continue; }
    if (typeof x === 'object') {
      const type = x['@type'];
      if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) return x;
      if (x['@graph']) queue.push(x['@graph']);
    }
  }
  return null;
}

const STORE_CONFIG = {
  'rozetka.com.ua': { name: 'Rozetka', category: null },
  'makeup.com.ua': { name: 'Makeup', category: 'Красота' },
  'converse.org.ua': { name: 'Converse', category: 'Одежда и обувь' },
  'allo.ua': { name: 'ALLO', category: 'Техника' },
  'comfy.ua': { name: 'COMFY', category: 'Техника' },
  'foxtrot.com.ua': { name: 'Фокстрот', category: 'Техника' },
  'epicentrk.ua': { name: 'Епіцентр', category: null }
};

function first(...vals) { return vals.find(v => v !== undefined && v !== null && String(v).trim() !== ''); }
function cleanText(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
function numericPrice(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  const s = String(v).replace(/\u00a0/g,' ').replace(/[^\d.,\s]/g,'').trim();
  if (!s) return null;
  let n = s.replace(/\s/g,'');
  if (n.includes(',') && n.includes('.')) {
    n = n.lastIndexOf(',') > n.lastIndexOf('.') ? n.replace(/\./g,'').replace(',','.') : n.replace(/,/g,'');
  } else n = n.replace(',','.');
  const parsed = Number(n);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function parsePrice(text) {
  const s = String(text || '').replace(/\u00a0/g,' ');
  const patterns = [
    /(\d[\d\s.,]{1,18})\s*(?:₴|грн|UAH|uah)/,
    /(?:ціна|цена|price)\s*[:\-]?\s*(\d[\d\s.,]{1,18})/i
  ];
  for (const rx of patterns) {
    const m = s.match(rx); if (!m) continue;
    const n = numericPrice(m[1]); if (n) return n;
  }
  return null;
}
function normalizeImage(value, baseUrl='', depth=0) {
  if (depth > 8 || value === undefined || value === null) return '';

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = normalizeImage(entry, baseUrl, depth + 1);
      if (found) return found;
    }
    return '';
  }

  if (typeof value === 'object') {
    const preferredKeys = [
      'original','base_action','big_tile','big','large','full','zoom',
      'preview','medium','small','url','src','href','contentUrl','image','photo','picture'
    ];
    for (const key of preferredKeys) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const found = normalizeImage(value[key], baseUrl, depth + 1);
        if (found) return found;
      }
    }
    for (const nested of Object.values(value)) {
      if (nested && typeof nested === 'object') {
        const found = normalizeImage(nested, baseUrl, depth + 1);
        if (found) return found;
      }
    }
    return '';
  }

  const v = cleanText(value);
  if (!v || v.startsWith('data:') || /\[object(?:%20|\s)+Object\]/i.test(v)) return '';
  try {
    const u = new URL(v, baseUrl);
    if (!['http:','https:'].includes(u.protocol)) return '';
    return u.href;
  } catch { return ''; }
}
function domainInfo(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const domain = u.hostname.toLowerCase().replace(/^www\./,'');
    const cfg = STORE_CONFIG[domain];
    return { domain, store: cfg?.name || domain.split('.')[0].replace(/^./, c => c.toUpperCase()), category: cfg?.category || null };
  } catch { return { domain:'', store:'Магазин', category:null }; }
}
function isAllowedUrl(raw) {
  try {
    const u = new URL(raw);
    if (!['http:','https:'].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || /^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) return false;
    return true;
  } catch { return false; }
}
function looksLikeChallenge(html='') {
  const s = String(html).toLowerCase();
  return s.includes('verify that you') || s.includes('not a robot') || s.includes('enable javascript') ||
    s.includes('access denied') || s.includes('captcha') || s.includes('cf-chl-') || s.includes('cloudflare');
}
function usableTitle(title='') {
  const t = cleanText(title);
  if (t.length < 3) return '';
  if (/javascript is disabled|access denied|just a moment|makeup\s*[-–—]\s*(інтернет|интернет)/i.test(t)) return '';
  return t.slice(0,250);
}
function mergeProduct(base={}, next={}) {
  return {
    ...base,
    title: usableTitle(base.title) || usableTitle(next.title),
    image: base.image || next.image || '',
    price: numericPrice(base.price) || numericPrice(next.price),
    variant: cleanText(base.variant) || cleanText(next.variant) || '',
    canonicalUrl: base.canonicalUrl || next.canonicalUrl || '',
    source: [...new Set([...(base.source||[]), ...(next.source||[])])]
  };
}
function qualityOf(data={}) {
  const title = Boolean(usableTitle(data.title));
  const price = Boolean(numericPrice(data.price));
  const image = Boolean(data.image);
  if (title && (price || image)) return 'complete';
  if (title || price || image) return 'partial';
  return 'none';
}
function pickProductLike(root, baseUrl='') {
  if (!root || typeof root !== 'object') return {};
  const queue = [root];
  let best = {}, bestScore = -1, seen = 0;
  while (queue.length && seen++ < 8000) {
    const x = queue.shift();
    if (!x || typeof x !== 'object') continue;
    if (Array.isArray(x)) { queue.push(...x.slice(0,100)); continue; }
    const title = usableTitle(first(x.title, x.name, x.productName, x.goods_name, x.goodsName));
    const price = numericPrice(first(x.price, x.currentPrice, x.salePrice, x.price_value, x.finalPrice, x.priceFormatted));
    const image = normalizeImage(first(x.image, x.images, x.photo, x.photos, x.imageUrl, x.mainImage, x.picture), baseUrl);
    const score = (title?3:0)+(price?3:0)+(image?2:0)+(x['@type']==='Product'?3:0);
    if (score > bestScore) { bestScore=score; best={ title, price, image }; }
    for (const v of Object.values(x)) if (v && typeof v === 'object') queue.push(v);
  }
  return bestScore > 0 ? best : {};
}

function extractMakeupProductId(url='') {
  const m=String(url).match(/\/product\/(\d+)\/?(?:[?#].*)?$/i);
  return m ? m[1] : '';
}
function normalizeVariant(value='') {
  const t=cleanText(value)
    .replace(/(\d)\s*(?:ml|мл)\b/ig,'$1 ml')
    .replace(/(\d)\s*(?:kg|кг)\b/ig,'$1 kg')
    .replace(/(\d)\s*(?:g|г)\b/ig,'$1 g');
  return t.slice(0,80);
}
function priceCandidates(text='') {
  const out=[]; const s=String(text||'');
  const rx=/(\d[\d\s.,]{0,14})\s*(?:₴|грн|UAH)/gi;
  let m;
  while((m=rx.exec(s))){ const value=numericPrice(m[1]); if(value) out.push({value,index:m.index,raw:m[0]}); }
  return out;
}
function pickCurrentPriceFromNearby(candidates=[], anchor=0) {
  if(!candidates.length) return null;
  const sorted=[...candidates].sort((a,b)=>Math.abs(a.index-anchor)-Math.abs(b.index-anchor));
  const nearest=sorted[0];
  // MAKEUP usually prints the active price and an optional crossed-out old price almost together.
  // If the nearest candidate has a sibling within ~140 chars, the lower value is the live price.
  const sibling=candidates.find(x=>x!==nearest && Math.abs(x.index-nearest.index)<=140);
  if(sibling) return Math.min(nearest.value,sibling.value);
  return nearest.value;
}
function makeupPriceAroundAnchor(text='', anchor=-1, before=1800, after=900) {
  if(anchor<0) return null;
  const s=String(text||'');
  const start=Math.max(0,anchor-before), end=Math.min(s.length,anchor+after);
  const window=s.slice(start,end); const all=priceCandidates(window);
  if(!all.length) return null;
  const absolute=all.map(x=>({...x,index:x.index+start}));
  return pickCurrentPriceFromNearby(absolute,anchor);
}
function makeupPriceBeforeAnchor(text='', anchor=-1) {
  if(anchor<0) return null;
  const start=Math.max(0,anchor-2200), window=String(text).slice(start,anchor);
  const all=priceCandidates(window); if(!all.length) return null;
  const absolute=all.map(x=>({...x,index:x.index+start}));
  const close=absolute.filter(x=>x.index>=Math.max(start,anchor-800));
  return pickCurrentPriceFromNearby(close.length?close:absolute.slice(-4),anchor);
}
function makeupPriceNearTitle(text='', title='') {
  const s=String(text||''); const t=cleanText(title);
  if(!t) return null;
  const idx=s.toLowerCase().indexOf(t.toLowerCase());
  if(idx<0) return null;
  // Product price is normally shortly after the product heading and before the volume selector.
  const volumeRel=s.slice(idx,idx+9000).search(/(?:\+\s*)?(?:(?:усі|всі)\s+об['’ʼ]?єми|все\s+объ[её]мы)/i);
  const end=volumeRel>=0 ? idx+volumeRel : Math.min(s.length,idx+5200);
  const candidates=priceCandidates(s.slice(idx,end)).map(x=>({...x,index:x.index+idx}));
  if(!candidates.length) return null;
  // Prefer the first adjacent current/old pair in the product block; otherwise the first price.
  for(let i=0;i<candidates.length-1;i++) {
    if(candidates[i+1].index-candidates[i].index<=160) return Math.min(candidates[i].value,candidates[i+1].value);
  }
  return candidates[0].value;
}
function makeupVariantNear(text='', anchor=-1) {
  if(anchor<0) return '';
  const window=String(text).slice(anchor,anchor+1800);
  const m=window.match(/\b(\d{1,4}(?:[.,]\d+)?\s*(?:ml|мл|g|г|kg|кг|шт\.?|pcs?))\b/i);
  return m ? normalizeVariant(m[1]) : '';
}
function makeupPromoIdentity(text='') {
  return /(?:banner|promo|action|sale|discount|reward|sprite|favicon|logo|icon|heart|gift|pixel|tracking|google|подар(?:унок|ок)?|акц(?:і|и)|зниж|скид|безкоштов|розіграш|розыгрыш|дермакосмет|dermocosmet|special\s+offer)/i.test(String(text||''));
}
function makeupTitleWords(title='') {
  return cleanText(title).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(x=>x.length>2).slice(0,10);
}
function makeupImageScore(candidate={}, title='', productId='') {
  const url=normalizeImage(candidate.url||candidate.src||'', 'https://makeup.com.ua/');
  if(!url) return -999;
  const alt=cleanText(candidate.alt||'').toLowerCase();
  const identity=`${url} ${alt}`.toLowerCase();
  const context=cleanText(candidate.context||'').toLowerCase();
  if(makeupPromoIdentity(identity)) return -120;
  let score=0;
  if(/\.(?:jpe?g|webp|png)(?:[?#]|$)/i.test(url)) score+=3;
  if(/(?:^|\.)u\.makeup\.com\.ua|makeup\.com\.ua/i.test(url)) score+=2;
  if(productId && identity.includes(productId)) score+=22;

  const words=makeupTitleWords(title);
  const idMatches=words.filter(w=>identity.includes(w)).length;
  const ctxMatches=words.filter(w=>context.includes(w)).length;
  score+=Math.min(30,idMatches*8);
  score+=Math.min(10,ctxMatches*2);
  const normalizedTitle=cleanText(title).toLowerCase();
  if(normalizedTitle && alt && (alt.includes(normalizedTitle)||normalizedTitle.includes(alt))) score+=32;
  if(alt && words.length && idMatches===0 && alt.length>3) score-=10;
  if(makeupPromoIdentity(context)) score-=22;

  const w=Number(candidate.width||0), h=Number(candidate.height||0);
  if(w>0&&h>0){
    const ratio=w/h;
    if(ratio>2.25||ratio<0.30) return -90;
    if(w>=300&&h>=300) score+=5;
  } else if(w>=300||h>=300) score+=2;

  const distance=Number(candidate.distanceToTitle);
  if(Number.isFinite(distance)) {
    if(distance<=700) score+=18;
    else if(distance<=1600) score+=12;
    else if(distance<=3200) score+=7;
    else if(distance<=6000) score+=2;
    else if(distance>10000) score-=8;
  }
  if(candidate.beforeTitle) score+=8;
  if(candidate.nearestBeforeTitle) score+=38;
  if(candidate.nearProduct) score+=6;
  if(candidate.fromGallery) score+=28;
  if(candidate.fromJsonLd) score+=32;
  if(candidate.fromExactSearch) score+=48;
  if(candidate.fromOg) score-=4;
  return score;
}
function rankMakeupImages(candidates=[], title='', pageUrl='') {
  const productId=extractMakeupProductId(pageUrl); const seen=new Set(); const ranked=[];
  for(const c of candidates){
    const item=typeof c==='string'?{url:c}:c;
    const url=normalizeImage(item.url||item.src||'',pageUrl); if(!url||seen.has(url)) continue;
    seen.add(url);
    const score=makeupImageScore({...item,url},title,productId);
    if(score>=3) ranked.push({...item,url,score});
  }
  ranked.sort((a,b)=>b.score-a.score);
  return ranked;
}
function chooseMakeupImage(candidates=[], title='', pageUrl='') {
  return rankMakeupImages(candidates,title,pageUrl)[0]?.url || '';
}
function imageDimensionsFromBuffer(buf) {
  try {
    if(!Buffer.isBuffer(buf)||buf.length<24) return null;
    // PNG
    if(buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
      return {width:buf.readUInt32BE(16),height:buf.readUInt32BE(20)};
    }
    // GIF
    if(buf.subarray(0,6).toString('ascii').match(/^GIF8[79]a$/)) {
      return {width:buf.readUInt16LE(6),height:buf.readUInt16LE(8)};
    }
    // JPEG: scan for a Start Of Frame marker.
    if(buf[0]===0xff&&buf[1]===0xd8) {
      let pos=2;
      const sof=new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
      while(pos+9<buf.length) {
        if(buf[pos]!==0xff){pos++;continue;}
        while(pos<buf.length&&buf[pos]===0xff) pos++;
        const marker=buf[pos++];
        if(marker===0xd8||marker===0xd9||marker===0x01||(marker>=0xd0&&marker<=0xd7)) continue;
        if(pos+2>buf.length) break;
        const len=buf.readUInt16BE(pos); if(len<2||pos+len>buf.length) break;
        if(sof.has(marker)&&pos+7<buf.length) return {height:buf.readUInt16BE(pos+3),width:buf.readUInt16BE(pos+5)};
        pos+=len;
      }
    }
    // WebP VP8X (common modern CDN output)
    if(buf.subarray(0,4).toString('ascii')==='RIFF'&&buf.subarray(8,12).toString('ascii')==='WEBP') {
      const kind=buf.subarray(12,16).toString('ascii');
      if(kind==='VP8X'&&buf.length>=30) {
        return {width:1+buf.readUIntLE(24,3),height:1+buf.readUIntLE(27,3)};
      }
    }
  } catch {}
  return null;
}
async function probeMakeupImage(url='') {
  try {
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept':'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8','range':'bytes=0-262143','referer':'https://makeup.com.ua/'},signal:AbortSignal.timeout(6500)});
    if(!r.ok&&r.status!==206) return null;
    const buf=Buffer.from(await r.arrayBuffer());
    return imageDimensionsFromBuffer(buf);
  } catch { return null; }
}
async function pickValidatedMakeupImage(urls=[], pageUrl='') {
  const unique=[...new Set(urls.map(x=>normalizeImage(x,pageUrl)).filter(Boolean))].slice(0,12);
  if(!unique.length) return '';
  const checked=await Promise.all(unique.map(async (url,index)=>({url,index,dims:await probeMakeupImage(url)})));
  const valid=checked.filter(x=>{
    if(!x.dims) return false;
    const {width:w,height:h}=x.dims; if(!w||!h||w<180||h<180) return false;
    const ratio=w/h;
    return ratio>=0.38&&ratio<=1.85;
  }).sort((a,b)=>a.index-b.index);
  if(valid.length) return valid[0].url;
  const unknown=checked.filter(x=>!x.dims).sort((a,b)=>a.index-b.index);
  if(unknown.length) return unknown[0].url;
  return '';
}
async function resolveMakeupProductImage(result={}, pageUrl='') {
  // Exact MAKEUP search cards and structured Product gallery data are much safer than generic page images.
  const trusted=[...(result.trustedImageCandidates||[])].filter(Boolean);
  const trustedChoice=await pickValidatedMakeupImage(trusted,pageUrl);
  if(trustedChoice) return trustedChoice;

  const ranked=rankMakeupImages([
    ...(result.imageCandidateDetails||[]),
    ...(result.imageCandidates||[]).map(url=>({url})),
    ...(result.image?[{url:result.image}]:[])
  ],result.title,pageUrl);
  return await pickValidatedMakeupImage(ranked.map(x=>x.url),pageUrl);
}
function parseMakeupText(text='', pageUrl='', fallbackTitle='') {
  const s=String(text||''); const productId=extractMakeupProductId(pageUrl);
  const volumeRx=/(?:\+\s*)?(?:(?:усі|всі)\s+об['’ʼ]?єми|все\s+объ[её]мы)\s*\(\s*\d+\s*\)/i;
  const volumeMatch=volumeRx.exec(s); const volumeIndex=volumeMatch?.index ?? -1;
  let codeIndex=-1;
  if(productId){ const m=new RegExp(`(?:код\s+товару|код\s+товара|product\s+code)\s*:?\s*${productId}`,'i').exec(s); codeIndex=m?.index ?? -1; }
  const heading=s.match(/^#\s+(.+)$/m)?.[1] || s.match(/^Title:\s*(.+)$/mi)?.[1] || fallbackTitle;
  let price=makeupPriceBeforeAnchor(s,volumeIndex);
  if(!price) price=makeupPriceAroundAnchor(s,volumeIndex);
  if(!price) price=makeupPriceBeforeAnchor(s,codeIndex);
  if(!price) price=makeupPriceAroundAnchor(s,codeIndex);
  const variant=makeupVariantNear(s,volumeIndex>=0?volumeIndex:codeIndex);
  // If we already know the selected variant, try the exact occurrence as one more local price anchor.
  if(!price && variant) {
    const vi=s.toLowerCase().indexOf(variant.toLowerCase(),Math.max(0,volumeIndex));
    if(vi>=0) price=makeupPriceAroundAnchor(s,vi,700,900);
  }
  return {title:usableTitle(heading),price,variant,canonicalUrl:pageUrl,source:['makeup-text']};
}

function parseMakeupHtml(html, pageUrl) {
  const $=cheerio.load(html); const title=usableTitle(first($('h1').first().text(),$('meta[property="og:title"]').attr('content'),$('title').text()));
  const text=$('body').text(); const textData=parseMakeupText(text,pageUrl,title);
  const candidates=[]; const trusted=[];
  $('img').each((_,el)=>{
    const node=$(el);
    const gallery=node.closest('[class*="gallery"],[class*="slider"],[class*="carousel"],[class*="product-image"],[class*="product__image"],[class*="product-photo"],[class*="product__photo"],[class*="product-gallery"],[class*="product__gallery"]');
    const product=node.closest('.product,.product-item,.product-card,.product-page,[class*="product__"]');
    const local=gallery.length?gallery:(product.length?product:node.parent());
    const context=`${local.attr('class')||''} ${cleanText(local.text()).slice(0,500)}`;
    const item={
      url:first(node.attr('src'),node.attr('data-src'),node.attr('data-original'),node.attr('data-lazy'),node.attr('content')),
      alt:node.attr('alt')||'',context,width:node.attr('width'),height:node.attr('height'),
      nearProduct:Boolean(product.length||gallery.length),fromGallery:Boolean(gallery.length)
    };
    candidates.push(item);
    if(gallery.length && !makeupPromoIdentity(`${item.alt} ${item.context}`)) trusted.push(item.url);
  });
  const ogImage=$('meta[property="og:image"]').attr('content');
  if(ogImage) candidates.push({url:ogImage,alt:title,context:'og image',fromOg:true});
  const productJson=findProductJsonLd($);
  if(productJson?.image) {
    const arr=Array.isArray(productJson.image)?productJson.image:[productJson.image];
    for(const im of arr) {
      const url=typeof im==='string'?im:(im?.url||im?.contentUrl);
      candidates.push({url,alt:productJson.name||title,context:'jsonld product image',nearProduct:true,fromGallery:true,fromJsonLd:true});
      if(url) trusted.push(url);
    }
  }
  const ranked=rankMakeupImages(candidates,title,pageUrl); const image=ranked[0]?.url||'';
  return {...textData,title:title||textData.title,image,imageCandidates:ranked.map(x=>x.url).slice(0,12),imageCandidateDetails:ranked.slice(0,12),trustedImageCandidates:[...new Set(trusted.filter(Boolean))],canonicalUrl:first($('link[rel="canonical"]').attr('href'),pageUrl),source:['makeup-html',...(textData.source||[])]};
}
function parseMakeupReaderMarkdown(text, pageUrl) {
  const s=String(text||''); const textData=parseMakeupText(s,pageUrl,''); const candidates=[];
  const rx=/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g; let m;
  const volumesIndex=s.search(/(?:\+\s*)?(?:(?:усі|всі)\s+об['’ʼ]?єми|все\s+объ[её]мы)/i);
  const codeIndex=s.search(/код\s+товар/i);
  const lower=s.toLowerCase();
  const headingNeedle=textData.title?`\n# ${textData.title.toLowerCase()}`:'';
  let titleIndex=headingNeedle?lower.indexOf(headingNeedle):-1;
  if(titleIndex>=0) titleIndex+=1;
  else titleIndex=textData.title?lower.indexOf(textData.title.toLowerCase()):-1;
  const anchor=titleIndex>=0?titleIndex:(volumesIndex>=0?volumesIndex:codeIndex);
  const raw=[];
  while((m=rx.exec(s))){
    const distance=anchor>=0?Math.abs(m.index-anchor):Number.NaN;
    raw.push({position:m.index,url:m[2],alt:m[1],context:s.slice(Math.max(0,m.index-220),Math.min(s.length,m.index+320)),nearProduct:Number.isFinite(distance)&&distance<6000,distanceToTitle:distance,beforeTitle:titleIndex>=0&&m.index<titleIndex});
  }
  let nearestBefore=-1, nearestDistance=Infinity;
  if(titleIndex>=0){
    raw.forEach((c,i)=>{
      if(!c.beforeTitle||makeupPromoIdentity(`${c.url} ${c.alt}`)) return;
      const d=titleIndex-c.position;
      if(d>=0&&d<nearestDistance&&d<=5500){nearestDistance=d;nearestBefore=i;}
    });
  }
  raw.forEach((c,i)=>candidates.push({...c,nearestBeforeTitle:i===nearestBefore,fromGallery:i===nearestBefore}));
  const ranked=rankMakeupImages(candidates,textData.title,pageUrl); const image=ranked[0]?.url||'';
  const trusted=[];
  if(nearestBefore>=0) trusted.push(raw[nearestBefore].url);
  for(const r of ranked){
    const words=makeupTitleWords(textData.title); const alt=cleanText(r.alt||'').toLowerCase();
    if(words.length&&words.some(w=>alt.includes(w))&&!makeupPromoIdentity(`${r.url} ${r.alt}`)) trusted.push(r.url);
  }
  return {...textData,image,imageCandidates:ranked.map(x=>x.url).slice(0,12),imageCandidateDetails:ranked.slice(0,12),trustedImageCandidates:[...new Set(trusted.filter(Boolean))].slice(0,5),source:['makeup-reader',...(textData.source||[])]};
}
function trustedMerge(base={}, next={}) {
  const imageCandidates=[...new Set([
    ...(next.imageCandidates||[]), next.image,
    ...(base.imageCandidates||[]), base.image
  ].filter(Boolean))];
  const imageCandidateDetails=[...(next.imageCandidateDetails||[]),...(base.imageCandidateDetails||[])];
  const trustedImageCandidates=[...new Set([
    ...(next.trustedImageCandidates||[]),
    ...(base.trustedImageCandidates||[])
  ].filter(Boolean))];
  return {
    ...base,
    title: usableTitle(next.title) || usableTitle(base.title),
    image: next.image || base.image || '',
    imageCandidates,
    imageCandidateDetails,
    trustedImageCandidates,
    price: numericPrice(next.price) || numericPrice(base.price),
    variant: cleanText(next.variant) || cleanText(base.variant) || '',
    canonicalUrl: next.canonicalUrl || base.canonicalUrl || '',
    source:[...new Set([...(base.source||[]),...(next.source||[])])]
  };
}

function parseHtmlProduct(html, pageUrl) {
  const $ = cheerio.load(html);
  const p = findProductJsonLd($);
  const offer = p?.offers ? (Array.isArray(p.offers) ? p.offers[0] : p.offers) : null;
  let data = {
    title: usableTitle(first(
      p?.name,
      $('meta[property="og:title"]').attr('content'),
      $('meta[name="twitter:title"]').attr('content'),
      $('h1').first().text(),
      $('[itemprop="name"]').first().text(),
      $('.product-item__name,.product-title,.product__title,.product-name').first().text(),
      $('title').text()
    )),
    image: normalizeImage(first(
      Array.isArray(p?.image) ? p.image[0] : p?.image,
      $('meta[property="og:image"]').attr('content'),
      $('meta[name="twitter:image"]').attr('content'),
      $('[itemprop="image"]').first().attr('content'),
      $('.product-item__img img,.product-slider img,.product__image img,.product-image img').first().attr('src'),
      $('main img').first().attr('src')
    ), pageUrl),
    price: numericPrice(first(
      offer?.price,
      $('meta[property="product:price:amount"]').attr('content'),
      $('[itemprop="price"]').first().attr('content'),
      $('[itemprop="price"]').first().text(),
      $('[data-price]').first().attr('data-price'),
      $('.product-item__price,.product-price,.product__price,.price').first().text()
    )),
    canonicalUrl: first($('link[rel="canonical"]').attr('href'), pageUrl),
    source: ['html']
  };
  if (!data.price) data.price = parsePrice($('body').text().slice(0,240000));

  // Modern shops often keep the real product object inside application JSON.
  $('script').each((_, el) => {
    if (qualityOf(data)==='complete') return;
    const raw = $(el).contents().text().trim();
    if (!raw || raw.length > 3_000_000) return;
    let parsed = null;
    if (raw.startsWith('{') || raw.startsWith('[')) {
      try { parsed = JSON.parse(raw); } catch {}
    }
    if (!parsed) {
      const m = raw.match(/(?:__NEXT_DATA__|__NUXT__|productData|product)\s*=\s*({[\s\S]*?})\s*;?$/i);
      if (m) { try { parsed = JSON.parse(m[1]); } catch {} }
    }
    if (parsed) data = mergeProduct(data, {...pickProductLike(parsed,pageUrl), source:['embedded-json']});
  });
  return data;
}
function extractRozetkaGoodsId(url='') {
  const m = String(url).match(/\/p(\d{5,})\/?(?:[?#].*)?$/i) || String(url).match(/\/(\d{5,})\/p\1\/?/i);
  return m ? m[1] : '';
}
async function fetchJson(url, headers={}) {
  const r = await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept':'application/json,text/plain,*/*',...headers},signal:AbortSignal.timeout(12000)});
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
}
async function rozetkaApiFallback(productUrl) {
  const id = extractRozetkaGoodsId(productUrl);
  if (!id) return {};
  const endpoints = [
    `https://rozetka.com.ua/api/product-api/v4/goods/get-main?front-type=xl&country=UA&lang=ua&goodsId=${id}`,
    `https://product-api.rozetka.com.ua/v4/goods/get-main?front-type=xl&country=UA&lang=ua&goodsId=${id}`,
    `https://product-api.rozetka.company/v4/goods/get-main?front-type=xl&country=UA&lang=ua&goodsId=${id}`
  ];
  for (const endpoint of endpoints) {
    try {
      const json = await fetchJson(endpoint, { referer:'https://rozetka.com.ua/' });
      const root = json?.data || json;
      const best = pickProductLike(root, productUrl);
      // Known Rozetka response keys get priority.
      const schema = root?.seo?.schema || root?.schema || root?.seo?.schema_org || {};
      const productSchema = schema?.Product || schema?.product || schema;
      const result = mergeProduct({
        title: usableTitle(first(root?.title, root?.name, productSchema?.name)),
        price: numericPrice(first(root?.price, root?.price_value, root?.price_pcs, productSchema?.offers?.price)),
        image: normalizeImage(first(
          root?.images,
          root?.docket?.images,
          root?.image,
          root?.photo,
          root?.photo_preview,
          productSchema?.image
        ), productUrl),
        canonicalUrl: productUrl,
        source:['rozetka-api']
      }, {...best, source:['rozetka-api-scan']});
      if (qualityOf(result)!=='none') return result;
    } catch {}
  }
  return {};
}
function makeupAlternateProductUrls(productUrl='') {
  try {
    const u=new URL(productUrl); const id=extractMakeupProductId(productUrl); if(!id) return [productUrl];
    const origin=u.origin; return [...new Set([
      productUrl,
      `${origin}/ua/product/${id}/`,
      `${origin}/product/${id}/`
    ])];
  } catch { return [productUrl]; }
}
function parseMakeupSearchHtml(html='', searchUrl='', productUrl='', fallbackTitle='') {
  const $=cheerio.load(html); const id=extractMakeupProductId(productUrl); if(!id) return {};
  let best={}; let bestScore=-1;
  $(`a[href*="/product/${id}/"]`).each((_,el)=>{
    const a=$(el); let node=a;
    for(let depth=0;depth<8;depth++) {
      if(depth>0){node=node.parent(); if(!node.length) break;}
      const text=cleanText(node.text()); const prices=priceCandidates(text);
      const title=usableTitle(first(a.attr('title'),a.text(),node.find(`a[href*="/product/${id}/"]`).first().attr('title'),node.find(`a[href*="/product/${id}/"]`).first().text(),fallbackTitle));
      const current=prices.length?pickCurrentPriceFromNearby(prices,0):null;
      const imgNode=(a.is('img')?a:a.find('img').first()).length?(a.is('img')?a:a.find('img').first()):node.find('img').first();
      const image=normalizeImage(first(imgNode.attr('src'),imgNode.attr('data-src'),imgNode.attr('data-original'),imgNode.attr('data-lazy')),searchUrl);
      if(!current&&!image&&!title) continue;
      const titleNeedle=cleanText(fallbackTitle).toLowerCase();
      const score=(current?5:0)+(title?3:0)+(image?8:0)+(titleNeedle&&text.toLowerCase().includes(titleNeedle)?5:0)+(image&&!makeupPromoIdentity(`${imgNode.attr('alt')||''} ${text}`)?8:-8);
      if(score>bestScore){
        bestScore=score;
        best={title,price:current,image,imageCandidates:image?[image]:[],imageCandidateDetails:image?[{url:image,alt:imgNode.attr('alt')||title,context:text,fromExactSearch:true}]:[],trustedImageCandidates:image?[image]:[],canonicalUrl:productUrl,source:['makeup-search-html']};
      }
      if(image&&current) break;
    }
  });
  return bestScore>0?best:{};
}
function parseMakeupSearchText(text='', productUrl='', fallbackTitle='') {
  const s=String(text||''); const id=extractMakeupProductId(productUrl); if(!id) return {};
  const markers=[`/ua/product/${id}/`,`/product/${id}/`,`product/${id}`];
  let idx=-1; for(const marker of markers){ idx=s.indexOf(marker); if(idx>=0) break; }
  if(idx<0 && fallbackTitle) idx=s.toLowerCase().indexOf(cleanText(fallbackTitle).toLowerCase());
  if(idx<0) return {};
  const start=Math.max(0,idx-2600), end=Math.min(s.length,idx+6000); const window=s.slice(start,end);
  const prices=priceCandidates(window).map(x=>({...x,index:x.index+start}));
  let price=null;
  if(prices.length) {
    const after=prices.filter(x=>x.index>=idx).slice(0,5);
    const before=prices.filter(x=>x.index<idx).slice(-5);
    price=pickCurrentPriceFromNearby(after.length?after:before,idx);
  }
  const imageMatches=[]; const rx=/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g; let m;
  while((m=rx.exec(window))) {
    const absolute=start+m.index; const distance=Math.abs(absolute-idx);
    const context=window.slice(Math.max(0,m.index-180),Math.min(window.length,m.index+300));
    imageMatches.push({url:m[2],alt:m[1],context,nearProduct:distance<3200,distanceToTitle:distance,fromExactSearch:distance<1800});
  }
  const ranked=rankMakeupImages(imageMatches,fallbackTitle,productUrl); const image=ranked[0]?.url||'';
  const exact=ranked.filter(x=>x.fromExactSearch&&!makeupPromoIdentity(`${x.alt||''} ${x.context||''}`));
  const trusted=exact.length?[exact[0].url]:(image?[image]:[]);
  return {title:usableTitle(fallbackTitle),price,image,imageCandidates:ranked.map(x=>x.url).slice(0,10),imageCandidateDetails:ranked.slice(0,10),trustedImageCandidates:trusted,canonicalUrl:productUrl,source:['makeup-search-reader']};
}
async function makeupSearchFallback(productUrl='', title='') {
  const id=extractMakeupProductId(productUrl); if(!id) return {};
  const queries=[id,cleanText(title)].filter(Boolean);
  const searchUrls=[];
  for(const q of [...new Set(queries)]) {
    searchUrls.push(`https://makeup.com.ua/ua/search/?q=${encodeURIComponent(q)}`);
    searchUrls.push(`https://makeup.com.ua/search/?q=${encodeURIComponent(q)}`);
  }
  let out={};
  for(const searchUrl of searchUrls) {
    try {
      const r=await fetch(searchUrl,{headers:{'user-agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/150 Safari/537.36','accept-language':'uk-UA,uk;q=0.9,ru;q=0.8','accept':'text/html,application/xhtml+xml'},signal:AbortSignal.timeout(12000)});
      if(r.ok){ const html=await r.text(); if(!looksLikeChallenge(html)) out=trustedMerge(out,parseMakeupSearchHtml(html,r.url,productUrl,title)); }
    } catch {}
    if(numericPrice(out.price)&&(out.trustedImageCandidates||[]).length) break;
    try {
      const proxy=`https://r.jina.ai/${searchUrl}`;
      const r=await fetch(proxy,{headers:{'user-agent':'Mozilla/5.0','accept':'text/plain'},signal:AbortSignal.timeout(18000)});
      if(r.ok){ const text=await r.text(); out=trustedMerge(out,parseMakeupSearchText(text,productUrl,title)); }
    } catch {}
    if(numericPrice(out.price)&&(out.trustedImageCandidates||[]).length) break;
  }
  return out;
}
async function makeupProductReaderFallback(productUrl='', title='') {
  let out={};
  for(const candidate of makeupAlternateProductUrls(productUrl)) {
    const r=await readerFallback(candidate,'makeup.com.ua');
    if(qualityOf(r)!=='none') out=trustedMerge(out,{...r,canonicalUrl:productUrl});
    if(numericPrice(out.price)&&(out.trustedImageCandidates||[]).length&&out.variant) break;
  }
  // Exact MAKEUP search cards are the safest image fallback: the product link contains the same product ID,
  // so unrelated page banners cannot win merely because they are square or use the same CDN.
  const search=await makeupSearchFallback(productUrl,usableTitle(out.title)||title);
  if(qualityOf(search)!=='none'||(search.trustedImageCandidates||[]).length) {
    out=trustedMerge(out,{
      ...search,
      title:usableTitle(out.title)||usableTitle(search.title),
      price:numericPrice(out.price)||numericPrice(search.price),
      variant:cleanText(out.variant)||cleanText(search.variant)
    });
  }
  return out;
}

function parseReaderMarkdown(text, pageUrl) {
  const s = String(text || '');
  const heading = s.match(/^#\s+(.+)$/m)?.[1] || s.match(/^Title:\s*(.+)$/mi)?.[1] || '';
  const image = s.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/)?.[1] || '';
  return { title: usableTitle(heading), price: parsePrice(s.slice(0,220000)), image: normalizeImage(image,pageUrl), canonicalUrl:pageUrl, source:['reader'] };
}
async function readerFallback(productUrl, domain='') {
  try {
    const proxy = `https://r.jina.ai/${productUrl}`;
    const r = await fetch(proxy,{headers:{'user-agent':'Mozilla/5.0','accept':'text/plain'},signal:AbortSignal.timeout(18000)});
    if (!r.ok) return {};
    const text=await r.text();
    return domain==='makeup.com.ua' ? parseMakeupReaderMarkdown(text,productUrl) : parseReaderMarkdown(text, productUrl);
  } catch { return {}; }
}
async function microlinkFallback(productUrl) {
  try {
    const endpoint = `https://api.microlink.io/?url=${encodeURIComponent(productUrl)}`;
    const r = await fetch(endpoint,{headers:{'user-agent':'Mozilla/5.0','accept':'application/json'},signal:AbortSignal.timeout(16000)});
    if (!r.ok) return {};
    const j = await r.json(); const d=j?.data||{};
    return { title:usableTitle(d.title), image:normalizeImage(d.image?.url||d.image,productUrl), price:null, canonicalUrl:d.url||productUrl, source:['microlink'] };
  } catch { return {}; }
}
function inferCategoryFromTitle(title='', domain='') {
  if (STORE_CONFIG[domain]?.category) return STORE_CONFIG[domain].category;
  // Rozetka is a marketplace: infer only when the title is obvious.
  const t = String(title).toLowerCase();
  if (/викрут|отв[её]ртк|шурупов|дрел|перфорат|набір\s+інструмент|набор\s+инструмент|tool\s*kit|screwdriver|dremel|паяльн/.test(t)) return 'Инструменты';
  if (/iphone|macbook|ноутбук|смартфон|телефон|навушник|наушник|зарядн|bluetti|power station|камера|фотоапарат|телевізор|телевизор/.test(t)) return 'Техника';
  if (/кросів|кроссов|черевик|ботин|converse|одяг|одежд|футболк|куртк/.test(t)) return 'Одежда и обувь';
  if (/парфум|духи|космет|крем|шампун|помад|туш|makeup/.test(t)) return 'Красота';
  return null;
}

app.post('/api/product-preview', requireAuth, async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!isAllowedUrl(url)) return res.status(400).json({ error: 'Некорректная или локальная ссылка.' });

  const info = domainInfo(url);
  let result = { title:'', image:'', price:null, canonicalUrl:url, source:[] };
  let directStatus = null;

  // Rozetka's public product endpoint is considerably more reliable than loading the storefront page from Railway.
  if (info.domain === 'rozetka.com.ua') result = mergeProduct(result, await rozetkaApiFallback(url));

  if (qualityOf(result) !== 'complete') {
    try {
      const r = await fetch(url, {
        redirect: 'follow',
        headers: {
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36',
          'accept-language': 'uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.7',
          accept: 'text/html,application/xhtml+xml',
          'cache-control':'no-cache',
          pragma:'no-cache'
        },
        signal: AbortSignal.timeout(15000)
      });
      directStatus = r.status;
      if (r.ok) {
        const html = await r.text();
        if (info.domain === 'makeup.com.ua') { const mk=parseMakeupHtml(html,r.url); if(qualityOf(mk)!=='none') result=trustedMerge(result,mk); }
        else if (!looksLikeChallenge(html)) result = mergeProduct(result, parseHtmlProduct(html, r.url));
      }
    } catch {}
  }

  // Anti-bot / JS challenge fallback. MAKEUP needs SKU-aware parsing because its generic
  // structured data may expose the lowest price across all volumes instead of the selected variant.
  if (info.domain === 'makeup.com.ua') {
    const makeupReader=await makeupProductReaderFallback(url,result.title);
    if (qualityOf(makeupReader)!=='none') result=trustedMerge(result,makeupReader);
    // Microlink may still help with the title/image only; its generic price is intentionally ignored for MAKEUP.
    if (!usableTitle(result.title) || !result.image) {
      const micro=await microlinkFallback(url);
      if(!usableTitle(result.title)&&usableTitle(micro.title)) result.title=micro.title;
      if(!result.image&&micro.image&&makeupImageScore({url:micro.image,alt:micro.title||''},result.title,extractMakeupProductId(url))>=3) result.image=micro.image;
      result.source=[...new Set([...(result.source||[]),...(micro.source||[])])];
    }
  } else {
    if (qualityOf(result) !== 'complete') result = mergeProduct(result, await readerFallback(url,info.domain));
    if (qualityOf(result) !== 'complete') result = mergeProduct(result, await microlinkFallback(url));
  }

  if (info.domain === 'makeup.com.ua') {
    result.image = await resolveMakeupProductImage(result, url);
  }

  const quality = qualityOf(result);
  const category = inferCategoryFromTitle(result.title, info.domain);
  let message;
  if (quality === 'complete') message = 'Готово. Проверь данные перед сохранением.';
  else if (quality === 'partial') message = 'Получены не все данные — проверь и при необходимости дополни поля.';
  else message = 'Магазин не дал прочитать карточку автоматически. Ссылка сохранена — заполни недостающие поля вручную.';

  res.json({
    title: usableTitle(result.title),
    image: result.image || '',
    price: numericPrice(result.price),
    variant: cleanText(result.variant),
    store: info.store,
    storeDomain: info.domain,
    category,
    canonicalUrl: result.canonicalUrl || url,
    quality,
    message,
    blocked: directStatus === 403 || directStatus === 429,
    sources: result.source || []
  });
});



app.get('*', (req, res) => res.sendFile(`${process.cwd()}/public/index.html`));

export { parseMakeupReaderMarkdown, parseMakeupSearchHtml, parseMakeupSearchText, rankMakeupImages, makeupImageScore };

if (process.env.HOCHU_TEST !== '1') {
  initDb().then(() => {
    app.listen(PORT, () => console.log(`Хочу v${VERSION} started on :${PORT}${pool ? ' + PostgreSQL' : ' + memory DB'}`));
  }).catch(err => {
    console.error('Database initialization failed:', err);
    process.exit(1);
  });
}
