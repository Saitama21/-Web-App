import test from 'node:test';
import assert from 'node:assert/strict';
import { priceHistorySummary } from '../lib/price-history.js';

test('summarises falling price history',()=>{
  const out=priceHistorySummary([{price:12919},{price:12100},{price:11870}],11870);
  assert.equal(out.currentPrice,11870);
  assert.equal(out.firstPrice,12919);
  assert.equal(out.minPrice,11870);
  assert.equal(out.maxPrice,12919);
  assert.equal(out.previousPrice,12100);
  assert.equal(out.historyCount,3);
  assert.ok(out.changeFromFirst<0);
});

test('uses previous distinct price when price returns to an old value',()=>{
  const out=priceHistorySummary([{price:3790},{price:3490},{price:3790}],3790);
  assert.equal(out.previousPrice,3490);
  assert.equal(out.minPrice,3490);
  assert.equal(out.maxPrice,3790);
});

test('single baseline has no previous price',()=>{
  const out=priceHistorySummary([{price:4281}],4281);
  assert.equal(out.previousPrice,null);
  assert.equal(out.historyCount,1);
  assert.equal(out.changeFromFirst,0);
});
