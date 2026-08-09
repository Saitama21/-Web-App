import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import pg from 'pg';
import * as cheerio from 'cheerio';

const { Pool } = pg;
const app = express();
const PORT = Number(process.env.PORT || 3000);
const VERSION = '1.0.1';
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
      offer?.lowPrice,
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
function parseReaderMarkdown(text, pageUrl) {
  const s = String(text || '');
  const heading = s.match(/^#\s+(.+)$/m)?.[1] || s.match(/^Title:\s*(.+)$/mi)?.[1] || '';
  const image = s.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/)?.[1] || '';
  return { title: usableTitle(heading), price: parsePrice(s.slice(0,220000)), image: normalizeImage(image,pageUrl), canonicalUrl:pageUrl, source:['reader'] };
}
async function readerFallback(productUrl) {
  try {
    const proxy = `https://r.jina.ai/${productUrl}`;
    const r = await fetch(proxy,{headers:{'user-agent':'Mozilla/5.0','accept':'text/plain'},signal:AbortSignal.timeout(18000)});
    if (!r.ok) return {};
    return parseReaderMarkdown(await r.text(), productUrl);
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
        if (!looksLikeChallenge(html)) result = mergeProduct(result, parseHtmlProduct(html, r.url));
      }
    } catch {}
  }

  // Anti-bot / JS challenge fallback. No API key is required; if unavailable we simply continue to manual mode.
  if (qualityOf(result) !== 'complete') result = mergeProduct(result, await readerFallback(url));
  if (qualityOf(result) !== 'complete') result = mergeProduct(result, await microlinkFallback(url));

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

initDb().then(() => {
  app.listen(PORT, () => console.log(`Хочу v${VERSION} started on :${PORT}${pool ? ' + PostgreSQL' : ' + memory DB'}`));
}).catch(err => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});
