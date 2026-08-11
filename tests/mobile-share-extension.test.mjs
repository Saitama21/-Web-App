import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('PWA exposes a GET share target without file access', async () => {
  const manifest = JSON.parse(await read('public/manifest.webmanifest'));
  assert.equal(manifest.id, '/');
  assert.deepEqual(manifest.share_target, {
    action: '/share-target',
    method: 'GET',
    params: { title: 'title', text: 'text', url: 'url' }
  });
  assert.equal(manifest.share_target.params.files, undefined);
});

test('browser extension stays least-privilege and Safari-compatible', async () => {
  const manifest = JSON.parse(await read('browser-extension/manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'scripting', 'storage'].sort());
  assert.equal(manifest.host_permissions, undefined);
  const background = await read('browser-extension/background.js');
  assert.match(background, /globalThis\.browser \|\| globalThis\.chrome/);
  assert.match(background, /hochu-safari-extension/);
  assert.match(background, /web-app-production-22f3\.up\.railway\.app/);
});

test('mobile imports are one-shot and survive authentication', async () => {
  const app = await read('public/app.js');
  assert.match(app, /location\.pathname==='\/add'/);
  assert.match(app, /location\.pathname==='\/share-target'/);
  assert.match(app, /history\.replaceState\(\{\},'', '\/'\)/);
  assert.match(app, /sessionStorage\.setItem\(PRODUCT_IMPORT_SESSION/);
  assert.match(app, /sessionStorage\.removeItem\(PRODUCT_IMPORT_SESSION/);
  assert.match(app, /if\(fromSharedUrl\)setTimeout/);
});
