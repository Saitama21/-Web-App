import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const start=server.indexOf('function first(');
const end=server.indexOf('function domainInfo(',start);
const dimStart=server.indexOf('function imageDimensionsFromBuffer(');
const dimEnd=server.indexOf('async function probeMakeupImage(',dimStart);
assert.ok(start>=0&&end>start&&dimStart>=0&&dimEnd>dimStart,'helper functions present');
const ctx={URL,Buffer,console}; vm.createContext(ctx);
vm.runInContext(server.slice(start,end)+'\n'+server.slice(dimStart,dimEnd)+`\nthis.h={rankGenericProductImages,genericProductImageScore,largestSrcsetUrl,imageDimensionsFromBuffer};`,ctx);
const {rankGenericProductImages,genericProductImageScore,largestSrcsetUrl,imageDimensionsFromBuffer}=ctx.h;

const title='Графічний монітор Huion Kamvas 13 Gen3 Black';
const page='https://touch.com.ua/ua/item/huion-kamvas-13-gen3-black-graficheskiy-monitor-118636-graficheskie-monitory-grafichni-monitori/';

test('Product JSON-LD image outranks og promo/banner',()=>{
  const ranked=rankGenericProductImages([
    {url:'https://touch.com.ua/upload/rk/promo-square.jpg',fromOg:true,context:'Акція банер подарунок'},
    {url:'https://touch.com.ua/upload/iblock/76b/product.jpg',fromJsonLd:true,alt:title}
  ],title,page);
  assert.equal(ranked[0].url,'https://touch.com.ua/upload/iblock/76b/product.jpg');
});

test('gallery product photo outranks a square advertising image',()=>{
  const ranked=rankGenericProductImages([
    {url:'https://shop.example/promo.jpg',width:800,height:800,context:'promo sale banner'},
    {url:'https://shop.example/item.jpg',width:800,height:800,fromGallery:true,fromProductScope:true,alt:title,context:'product gallery'}
  ],title,page);
  assert.equal(ranked[0].url,'https://shop.example/item.jpg');
});

test('largest srcset candidate is selected',()=>{
  const url=largestSrcsetUrl('/small.jpg 320w, /medium.jpg 800w, /large.jpg 1600w',page);
  assert.equal(url,'https://touch.com.ua/large.jpg');
});

test('very wide banner receives a strong penalty',()=>{
  const banner=genericProductImageScore({url:'https://x.test/banner.jpg',width:1200,height:120,fromMain:true,context:'main'},title);
  const product=genericProductImageScore({url:'https://x.test/product.jpg',width:1000,height:1000,fromGallery:true,alt:title},title);
  assert.ok(product>banner+100);
});

test('image dimension validator reads a normal square product image',()=>{
  const buf=Buffer.alloc(24);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(buf,0);
  buf.writeUInt32BE(640,16); buf.writeUInt32BE(640,20);
  const dims=imageDimensionsFromBuffer(buf);
  assert.deepEqual({...dims},{width:640,height:640});
});

test('Touch Huion official product image beats a generic rk promo candidate',()=>{
  const ranked=rankGenericProductImages([
    {url:'https://touch.com.ua/upload/rk/a3a/promo.jpg',fromOg:true,context:'promo banner'},
    {url:'https://touch.com.ua/upload/iblock/76b/jnmx050ctkzqqygqfukldguy8yz64zir.jpg',fromGallery:true,fromProductScope:true,alt:title,context:'product gallery'}
  ],title,page);
  assert.equal(ranked[0].url,'https://touch.com.ua/upload/iblock/76b/jnmx050ctkzqqygqfukldguy8yz64zir.jpg');
});
