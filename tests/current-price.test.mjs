import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const start=server.indexOf('function first(');
const end=server.indexOf('function normalizeImage',start);
assert.ok(start>=0&&end>start,'price helpers present');
const ctx={};vm.createContext(ctx);
vm.runInContext(server.slice(start,end)+'\nthis.h={promotionalCurrentPrice,priceIsOldIdentity,priceIsCurrentIdentity};',ctx);
const {promotionalCurrentPrice,priceIsOldIdentity,priceIsCurrentIdentity}=ctx.h;

test('Touch-style old/discount/current triplet chooses live price',()=>{
  assert.equal(promotionalCurrentPrice('21599 ₴ -7100 ₴ 14 499 ₴'),14499);
});
test('sale triplet works with spaced prices',()=>{
  assert.equal(promotionalCurrentPrice('43 999 ₴ -17 410 ₴ 26 589 ₴'),26589);
});
test('old-price classes are identified',()=>{
  assert.equal(priceIsOldIdentity('product price_old line-through'),true);
  assert.equal(priceIsOldIdentity('old__price'),true);
});
test('current-price classes are identified',()=>{
  assert.equal(priceIsCurrentIdentity('product price__current'),true);
  assert.equal(priceIsCurrentIdentity('sale_price'),true);
});
