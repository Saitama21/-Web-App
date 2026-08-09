import test from 'node:test';
import assert from 'node:assert/strict';
import {extractInspectorVariantCandidates,applyInspectorDecision,inspectorEnum} from '../lib/product-inspector.js';

test('extracts and normalizes volume candidates',()=>{
  const out=extractInspectorVariantCandidates(['Versace Pour Homme 30ml 50 ml 100мл'],'');
  assert.deepEqual(out.map(x=>x.value).slice(0,3),['30 ml','50 ml','100 ml']);
});

test('applies only enumerated evidence selections at sufficient confidence',()=>{
  const evidence={images:[{url:'https://shop.test/product.jpg'}],prices:[{value:2190}],variants:[{value:'30 ml'}]};
  const {result,applied}=applyInspectorDecision({image:'bad',price:3324,variant:''},evidence,{image_index:0,price_index:0,variant_index:0,confidence:.91});
  assert.equal(applied,true); assert.equal(result.image,evidence.images[0].url); assert.equal(result.price,2190); assert.equal(result.variant,'30 ml');
});

test('ignores low-confidence decisions',()=>{
  const {result,applied}=applyInspectorDecision({price:100},{prices:[{value:50}]},{price_index:0,image_index:-1,variant_index:-1,confidence:.2});
  assert.equal(applied,false); assert.equal(result.price,100);
});

test('schema enums include -1 sentinel',()=>assert.deepEqual(inspectorEnum(3),[-1,0,1,2]));
