import test from 'node:test';
import assert from 'node:assert/strict';

process.env.HOCHU_TEST='1';

const {
  parseHtmlProduct,
  parseReaderMarkdown,
  reconcileDeterministicPrice,
  buildAiInspectorEvidence,
  shouldRunAiProductInspector,
  productPriceReliable,
  touchAlternateProductUrls,
  classifyOpenAiFailure
}=await import('../server.js');

const TOUCH_URL='https://touch.com.ua/ua/item/huion-kamvas-13-gen3-black-graficheskiy-monitor-118636-graficheskie-monitory-grafichni-monitori/';
const TOUCH_HTML=`<!doctype html><html><head>
<title>Графічний монітор Huion Kamvas 13 Gen3 Black</title>
<link rel="canonical" href="${TOUCH_URL}">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Графічний монітор Huion Kamvas 13 Gen3 Black","image":"https://touch.com.ua/upload/huion-kamvas-13-gen3-black.jpg","offers":{"@type":"Offer","price":"21599","priceCurrency":"UAH"}}</script>
</head><body><main class="product-card">
<h1>Графічний монітор Huion Kamvas 13 Gen3 Black</h1>
<div class="product-price"><del>21599 ₴</del><span class="discount">-7100 ₴</span><strong class="current-price">14 499 ₴</strong></div>
<img class="product-gallery-image" src="https://touch.com.ua/upload/huion-kamvas-13-gen3-black.jpg" width="900" height="900" alt="Графічний монітор Huion Kamvas 13 Gen3 Black">
</main></body></html>`;

test('real Touch sale layout overrides stale Product/Offer price without AI',()=>{
  const parsed=parseHtmlProduct(TOUCH_HTML,TOUCH_URL);
  const result=reconcileDeterministicPrice(parsed);
  assert.equal(result.price,14499);
  assert.equal(result.originalPrice,21599);
  assert.equal(result.discountAmount,7100);
  assert.equal(result.priceVerification.status,'VERIFIED');
  assert.equal(productPriceReliable(result,'touch.com.ua'),true);
  const evidence=buildAiInspectorEvidence(result,TOUCH_URL,'touch.com.ua');
  assert.equal(shouldRunAiProductInspector(result,evidence,'touch.com.ua'),false,'Touch must spend zero AI calls');
});

test('Touch blocks a lone stale price instead of asking AI to guess',()=>{
  const stale={title:'Графічний монітор Huion Kamvas 13 Gen3 Black',image:'https://touch.com.ua/upload/huion.jpg',price:21599,priceVerification:{status:'CURRENT_ONLY'},inspectorTexts:['21599 ₴']};
  const evidence=buildAiInspectorEvidence(stale,TOUCH_URL,'touch.com.ua');
  assert.equal(productPriceReliable(stale,'touch.com.ua'),false);
  assert.equal(shouldRunAiProductInspector(stale,evidence,'touch.com.ua'),false);
});

test('Touch retries the same SKU through its second locale route',()=>{
  const urls=touchAlternateProductUrls(TOUCH_URL);
  assert.equal(urls.length,2);
  assert.equal(urls[0],TOUCH_URL);
  assert.equal(urls[1],TOUCH_URL.replace('/ua/item/','/item/'));
});

test('Touch reader format with line breaks still verifies the current sale price',()=>{
  const markdown=`# Графічний монітор Huion Kamvas 13 Gen3 Black\n* * 21599 ₴ -7100 ₴\n\n14 499 ₴`;
  const result=reconcileDeterministicPrice(parseReaderMarkdown(markdown,TOUCH_URL));
  assert.equal(result.price,14499);
  assert.equal(result.originalPrice,21599);
  assert.equal(result.discountAmount,7100);
  assert.equal(result.priceVerification.status,'VERIFIED');
});

test('OpenAI errors are classified for honest UI status',()=>{
  assert.equal(classifyOpenAiFailure(429,JSON.stringify({error:{code:'insufficient_quota',message:'You exceeded your current quota'}})).state,'quota_exhausted');
  assert.equal(classifyOpenAiFailure(429,JSON.stringify({error:{code:'rate_limit_exceeded'}})).state,'rate_limited');
  assert.equal(classifyOpenAiFailure(401,JSON.stringify({error:{code:'invalid_api_key'}})).state,'invalid_key');
  assert.equal(classifyOpenAiFailure(404,JSON.stringify({error:{code:'model_not_found'}})).state,'model_unavailable');
});
