const input = document.getElementById('appUrl');
const save = document.getElementById('save');
const status = document.getElementById('status');

function validate(value) {
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

chrome.storage.sync.get({ appUrl: '' }).then(({ appUrl }) => { input.value = appUrl || ''; });

save.addEventListener('click', async () => {
  const appUrl = validate(input.value);
  if (!appUrl) {
    status.textContent = 'Нужен полный HTTPS-адрес приложения.';
    status.className = 'error';
    return;
  }
  await chrome.storage.sync.set({ appUrl });
  input.value = appUrl;
  status.textContent = 'Адрес сохранён ✓ Теперь открой товар и нажми значок «В Хочу».';
  status.className = 'success';
});
