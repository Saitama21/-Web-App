const BADGE_TIMEOUT = 2600;

function setBadge(text, color, title) {
  chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
  chrome.action.setBadgeText({ text }).catch(() => {});
  if (title) chrome.action.setTitle({ title }).catch(() => {});
  setTimeout(() => chrome.action.setBadgeText({ text: '' }).catch(() => {}), BADGE_TIMEOUT);
}

function normalizedAppUrl(value = '') {
  try {
    const url = new URL(String(value).trim());
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function encodePayload(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function configuredAppUrl() {
  const stored = await chrome.storage.sync.get({ appUrl: '' });
  return normalizedAppUrl(stored.appUrl);
}

chrome.runtime.onInstalled.addListener(async details => {
  if (details.reason === 'install') await chrome.runtime.openOptionsPage();
});

chrome.action.onClicked.addListener(async tab => {
  const appUrl = await configuredAppUrl();
  if (!appUrl) {
    setBadge('!', '#d97706', 'Сначала укажи адрес приложения «Хочу»');
    await chrome.runtime.openOptionsPage();
    return;
  }
  if (!tab?.id || !/^https?:/i.test(tab.url || '')) {
    setBadge('!', '#dc2626', 'Эту вкладку нельзя прочитать');
    return;
  }

  try {
    const execution = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['extractor.js']
    });
    const product = execution?.[0]?.result;
    if (!product?.url || !product?.title) throw new Error('Карточка товара не распознана');
    const payload = {
      version: 1,
      origin: 'hochu-chrome-extension',
      extensionVersion: chrome.runtime.getManifest().version,
      extractedAt: new Date().toISOString(),
      ...product
    };
    const target = new URL(appUrl);
    target.hash = `import=${encodePayload(payload)}`;
    await chrome.tabs.create({ url: target.href });
    setBadge(product.price ? '✓' : '?', product.price ? '#059669' : '#d97706', product.price ? `Цена ${product.price} ₴ передана в «Хочу»` : 'Карточка передана без цены');
  } catch (error) {
    setBadge('!', '#dc2626', error?.message || 'Не удалось прочитать карточку');
  }
});
