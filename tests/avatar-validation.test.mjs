import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const start=server.indexOf('function validateAvatarDataUrl(');
const end=server.indexOf("app.patch('/api/profile'",start);
assert.ok(start>=0&&end>start,'avatar validator present');
const ctx={Buffer};vm.createContext(ctx);vm.runInContext(server.slice(start,end)+'\nthis.validate=validateAvatarDataUrl;',ctx);
const validate=ctx.validate;

test('valid PNG data URL is accepted',()=>{
  const b=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(64)]);
  const out=validate(`data:image/png;base64,${b.toString('base64')}`);
  assert.equal(out.ok,true);
});
test('non-image data URL is rejected',()=>{
  assert.equal(validate('data:text/plain;base64,SGVsbG8=').ok,false);
});
test('oversized avatar is rejected',()=>{
  const b=Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(370*1024)]);
  const out=validate(`data:image/jpeg;base64,${b.toString('base64')}`);
  assert.equal(out.ok,false);
});
