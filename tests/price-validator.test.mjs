import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePriceArithmetic,pickBestPriceFact,candidatePriceRole} from '../lib/price-validator.js';

test('verifies Touch-style sale arithmetic for free',()=>{
  assert.deepEqual(validatePriceArithmetic({originalPrice:21599,discountAmount:7100,currentPrice:14499}),{
    status:'VERIFIED',verified:true,currentPrice:14499,originalPrice:21599,discountAmount:7100,reason:'Старая цена − скидка = текущая цена'
  });
});

test('derives discount from current and old pair without AI',()=>{
  const x=validatePriceArithmetic({originalPrice:21599,currentPrice:14499});
  assert.equal(x.status,'SALE_PAIR');
  assert.equal(x.discountAmount,7100);
});

test('blocks impossible old/current relationship',()=>{
  assert.equal(validatePriceArithmetic({originalPrice:100,currentPrice:120}).status,'CONFLICT');
});

test('prefers verified arithmetic fact over weaker parser price',()=>{
  const x=pickBestPriceFact([
    {currentPrice:21599,source:'parser'},
    {originalPrice:21599,discountAmount:7100,currentPrice:14499,source:'dom-sale-triplet'}
  ],21599);
  assert.equal(x.currentPrice,14499);
  assert.equal(x.status,'VERIFIED');
});

test('labels old and discount candidates so AI cannot apply them as current price',()=>{
  const facts={currentPrice:14499,originalPrice:21599,discountAmount:7100};
  assert.equal(candidatePriceRole({value:14499},facts),'current');
  assert.equal(candidatePriceRole({value:21599},facts),'old');
  assert.equal(candidatePriceRole({value:7100},facts),'discount');
});
