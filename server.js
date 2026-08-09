import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import pg from 'pg';
import * as cheerio from 'cheerio';

const { Pool } = pg;
const app = express();
const PORT = Number(process.env.PORT || 3000);
const VERSION = '1.0.0';
const APP_PASSWORD = String(process.env.APP_PASSWORD || '');
const SESSION_SECRET = String(process.env.SESSION_SECRET || APP_PASSWORD || 'local-dev-secret');
const DATABASE_URL = String(process.env.DATABASE_URL || '');

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static('public', { extensions: ['html'], maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false }
}) : null;

// Local development fallback. Railway should use PostgreSQL.
const memory = [];

function sign(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
}
function newSession() {
  const raw = `hochu:${Date.now()}:${crypto.randomBytes(12).toString('hex')}`;
  return `${Buffer.from(raw).toString('base64url')}.${sign(raw)}`;
}
function sessionValid(token) {
  try {
    const [encoded, signature] = String(token || '').split('.');
    if (!encoded || !signature) return false;
    const raw = Buffer.from(encoded, 'base64url').toString('utf8');
    const expected = sign(raw);
    if (signature.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch { return false; }
}
function requireAuth(req, res, next) {
  if (sessionValid(req.cookies?.hochu_session)) return next();
  res.status(401).json({ error: 'unauthorized' });
}
function passwordEqual(input) {
  if (!APP_PASSWORD) return false;
  const a = Buffer.from(String(input || ''));
  const b = Buffer.from(APP_PASSWORD);
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wishlist_items (
      id UUID PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '',
      store TEXT NOT NULL DEFAULT '',
      store_domain TEXT NOT NULL DEFAULT '',
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
  await pool.query(`CREATE INDEX IF NOT EXISTS wishlist_status_idx ON wishlist_items(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS wishlist_store_idx ON wishlist_items(store_domain)`);
}

function mapRow(r) {
  return {
    id: r.id,
    title: r.title,
    url: r.url || '',
    image: r.image || '',
    store: r.store || '',
    storeDomain: r.store_domain || '',
    price: Number(r.price || 0),
    saved: Number(r.saved || 0),
    category: r.category || 'Другое',
    priority: Number(r.priority || 2),
    status: r.status || 'want',
    note: r.note || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    purchasedAt: r.purchased_at
  };
}
function cleanItem(x = {}) {
  const allowedStatus = new Set(['want','plan','ordered','bought','paused']);
  const price = Math.max(0, Number(x.price || 0));
  const saved = Math.max(0, Number(x.saved || 0));
  return {
    title: String(x.title || '').trim().slice(0, 250),
    url: String(x.url || '').trim().slice(0, 2000),
    image: String(x.image || '').trim().slice(0, 4000),
    store: String(x.store || '').trim().slice(0, 120),
    storeDomain: String(x.storeDomain || '').trim().slice(0, 250),
    price,
    saved,
    category: String(x.category || 'Другое').trim().slice(0, 80),
    priority: Math.min(4, Math.max(1, Number(x.priority || 2))),
    status: allowedStatus.has(String(x.status)) ? String(x.status) : 'want',
    note: String(x.note || '').trim().slice(0, 2000)
  };
}

app.get('/api/health', async (req, res) => {
  let db = 'memory';
  if (pool) {
    try { await pool.query('SELECT 1'); db = 'postgresql'; }
    catch { db = 'error'; }
  }
  res.json({ ok: true, app: 'Хочу', version: VERSION, database: db });
});

app.get('/api/me', (req, res) => {
  res.json({ authenticated: sessionValid(req.cookies?.hochu_session), passwordConfigured: Boolean(APP_PASSWORD) });
});
app.post('/api/login', (req, res) => {
  if (!APP_PASSWORD) return res.status(503).json({ error: 'APP_PASSWORD не задан в Railway Variables.' });
  if (!passwordEqual(req.body?.password)) return res.status(401).json({ error: 'Неверный пароль' });
  res.cookie('hochu_session', newSession(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production'),
    maxAge: 1000 * 60 * 60 * 24 * 30
  });
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  res.clearCookie('hochu_session');
  res.json({ ok: true });
});

app.get('/api/items', requireAuth, async (req, res) => {
  if (!pool) return res.json(memory);
  const q = await pool.query(`
    SELECT * FROM wishlist_items
    ORDER BY CASE WHEN status='bought' THEN 1 ELSE 0 END, priority DESC, created_at DESC
  `);
  res.json(q.rows.map(mapRow));
});
app.post('/api/items', requireAuth, async (req, res) => {
  const x = cleanItem(req.body);
  if (!x.title) return res.status(400).json({ error: 'Укажи название товара.' });
  const id = crypto.randomUUID();
  if (!pool) {
    const now = new Date().toISOString();
    const item = { id, ...x, createdAt: now, updatedAt: now, purchasedAt: x.status === 'bought' ? now : null };
    memory.unshift(item); return res.status(201).json(item);
  }
  const q = await pool.query(`
    INSERT INTO wishlist_items
      (id,title,url,image,store,store_domain,price,saved,category,priority,status,note,purchased_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CASE WHEN $11='bought' THEN NOW() ELSE NULL END)
    RETURNING *
  `,[id,x.title,x.url,x.image,x.store,x.storeDomain,x.price,x.saved,x.category,x.priority,x.status,x.note]);
  res.status(201).json(mapRow(q.rows[0]));
});
app.put('/api/items/:id', requireAuth, async (req, res) => {
  const x = cleanItem(req.body);
  if (!x.title) return res.status(400).json({ error: 'Укажи название товара.' });
  if (!pool) {
    const i = memory.findIndex(v => v.id === req.params.id);
    if (i < 0) return res.status(404).json({ error: 'Не найдено' });
    const wasBought = memory[i].status === 'bought';
    memory[i] = { ...memory[i], ...x, updatedAt: new Date().toISOString(), purchasedAt: x.status === 'bought' ? (wasBought ? memory[i].purchasedAt : new Date().toISOString()) : null };
    return res.json(memory[i]);
  }
  const q = await pool.query(`
    UPDATE wishlist_items SET
      title=$2,url=$3,image=$4,store=$5,store_domain=$6,price=$7,saved=$8,
      category=$9,priority=$10,status=$11,note=$12,updated_at=NOW(),
      purchased_at=CASE WHEN $11='bought' THEN COALESCE(purchased_at,NOW()) ELSE NULL END
    WHERE id=$1 RETURNING *
  `,[req.params.id,x.title,x.url,x.image,x.store,x.storeDomain,x.price,x.saved,x.category,x.priority,x.status,x.note]);
  if (!q.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json(mapRow(q.rows[0]));
});
app.delete('/api/items/:id', requireAuth, async (req, res) => {
  if (!pool) {
    const i = memory.findIndex(v => v.id === req.params.id);
    if (i < 0) return res.status(404).json({ error: 'Не найдено' });
    memory.splice(i,1); return res.json({ ok: true });
  }
  const q = await pool.query('DELETE FROM wishlist_items WHERE id=$1',[req.params.id]);
  if (!q.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

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
function first(...vals) { return vals.find(v => v !== undefined && v !== null && String(v).trim() !== ''); }
function parsePrice(text) {
  const m = String(text || '').replace(/\u00a0/g,' ').match(/(\d[\d\s.,]{1,18})\s*(₴|грн|UAH|uah)/);
  if (!m) return null;
  const n = Number(m[1].replace(/\s/g,'').replace(',','.'));
  return Number.isFinite(n) ? n : null;
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
app.post('/api/product-preview', requireAuth, async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!isAllowedUrl(url)) return res.status(400).json({ error: 'Некорректная или локальная ссылка.' });
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/150 Safari/537.36',
        'accept-language': 'uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.7',
        accept: 'text/html,application/xhtml+xml'
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) return res.status(502).json({ error: `Магазин ответил HTTP ${r.status}. Заполни карточку вручную.` });
    const html = await r.text();
    const $ = cheerio.load(html);
    const p = findProductJsonLd($);
    const offer = p?.offers ? (Array.isArray(p.offers) ? p.offers[0] : p.offers) : null;
    let title = first(p?.name, $('meta[property="og:title"]').attr('content'), $('meta[name="twitter:title"]').attr('content'), $('title').text()) || '';
    let image = first(Array.isArray(p?.image) ? p.image[0] : p?.image, $('meta[property="og:image"]').attr('content'), $('meta[name="twitter:image"]').attr('content')) || '';
    let price = first(offer?.price, offer?.lowPrice, $('meta[property="product:price:amount"]').attr('content'), $('[itemprop="price"]').first().attr('content'));
    price = price != null ? Number(String(price).replace(/\s/g,'').replace(',','.')) : null;
    if (!Number.isFinite(price)) price = parsePrice($('body').text().slice(0,180000));
    try { if (image) image = new URL(image, r.url).href; } catch {}
    const finalUrl = new URL(r.url);
    const storeDomain = finalUrl.hostname.replace(/^www\./,'');
    const store = ({
      'rozetka.com.ua':'Rozetka','makeup.com.ua':'Makeup','converse.org.ua':'Converse',
      'allo.ua':'ALLO','comfy.ua':'COMFY','foxtrot.com.ua':'Фокстрот','epicentrk.ua':'Епіцентр'
    })[storeDomain] || storeDomain.split('.')[0].replace(/^./, c => c.toUpperCase());
    res.json({
      title: String(title).trim().replace(/\s+/g,' ').slice(0,250), image,
      price: Number.isFinite(price) ? price : null, store, storeDomain, canonicalUrl: r.url
    });
  } catch {
    res.status(502).json({ error: 'Не удалось прочитать страницу. Некоторые магазины блокируют автоматический разбор — заполни данные вручную.' });
  }
});

app.get('*', (req, res) => res.sendFile(`${process.cwd()}/public/index.html`));

initDb().then(() => {
  app.listen(PORT, () => console.log(`Хочу v${VERSION} started on :${PORT}${pool ? ' + PostgreSQL' : ' + memory DB'}`));
}).catch(err => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});
