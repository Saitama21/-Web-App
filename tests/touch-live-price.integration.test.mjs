import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.HOCHU_TEST='1';

const {
  parseHtmlProduct,
  parseReaderMarkdown,
  reconcileDeterministicPrice,
  buildAiInspectorEvidence,
  shouldRunAiProductInspector,
  productPriceReliable,
  touchAlternateProductUrls,
  touchFreshProductUrls,
  mergeProduct,
  classifyOpenAiFailure,
  validateWebPriceDecision,
  sourceMatchesTargetProduct
}=await import('../server.js');

const TOUCH_URL='https://touch.com.ua/ua/item/huion-kamvas-13-gen3-black-graficheskiy-monitor-118636-graficheskie-monitory-grafichni-monitori/';
const TOUCH_LIVE_HTML=fs.readFileSync(new URL('./fixtures/touch-118636-live-2026-08-11.html',import.meta.url),'utf8');
const TOUCH_HTML=`<!doctype html><html><head>
<title>Графічний монітор Huion Kamvas 13 Gen3 Black</title>
<link rel="canonical" href="${TOUCH_URL}">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Графічний монітор Huion Kamvas 13 Gen3 Black","image":"https://touch.com.ua/upload/huion-kamvas-13-gen3-black.jpg","offers":{"@type":"Offer","price":"21599","priceCurrency":"UAH"}}</script>
</head><body><main class="product-card">
<h1>Графічний монітор Huion Kamvas 13 Gen3 Black</h1>
<div class="product-price"><del>21599 ₴</del><span class="discount">-7100 ₴</span><strong class="current-price">14 499 ₴</strong></div>
<img class="product-gallery-image" src="https://touch.com.ua/upload/huion-kamvas-13-gen3-black.jpg" width="900" height="900" alt="Графічний монітор Huion Kamvas 13 Gen3 Black">
</main></body></html>`;

test('captured live Touch page verifies the payable price from real DOM evidence without AI',()=>{
  const parsed=parseHtmlProduct(TOUCH_LIVE_HTML,TOUCH_URL);
  const result=reconcileDeterministicPrice(parsed);
  assert.equal(result.price,14549);
  assert.equal(result.originalPrice,21599);
  assert.equal(result.discountAmount,7050);
  assert.equal(result.priceVerification.status,'VERIFIED');
  assert.equal(productPriceReliable(result,'touch.com.ua'),true);
  const evidence=buildAiInspectorEvidence(result,TOUCH_URL,'touch.com.ua');
  assert.equal(shouldRunAiProductInspector(result,evidence,'touch.com.ua'),false,'trusted live evidence must spend zero AI calls');
});

test('captured Touch Product/Offer data remains trustworthy when the response body is incomplete',()=>{
  const headOnly=TOUCH_LIVE_HTML.replace(/<body>[\s\S]*<\/body>/i,'<body></body>');
  const parsed=parseHtmlProduct(headOnly,TOUCH_URL);
  const result=reconcileDeterministicPrice(parsed);
  assert.equal(result.price,14549);
  assert.equal(result.priceVerification.status,'STRUCTURED');
  assert.equal(result.priceVerification.authoritative,true);
  assert.equal(result.priceVerification.evidenceCount,2);
  assert.equal(productPriceReliable(result,'touch.com.ua'),true);
  const evidence=buildAiInspectorEvidence(result,TOUCH_URL,'touch.com.ua');
  assert.equal(shouldRunAiProductInspector(result,evidence,'touch.com.ua'),false,'two exact structured sources must spend zero AI calls');
});

test('Touch exact-SKU inline systems agree on the current price and ignore one stale analytics block',()=>{
  const html=`<!doctype html><html><head><title>Huion Kamvas 13 Gen3 Black</title>
    <link rel="canonical" href="${TOUCH_URL}">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Huion Kamvas 13 Gen3 Black","sku":"118636","mpn":"132933","offers":{"@type":"Offer","price":21599,"priceCurrency":"UAH","url":"${TOUCH_URL}"}}</script>
    </head><body><main class="product-card"><h1>Huion Kamvas 13 Gen3 Black</h1><span class="old_price">21 599 ₴</span>
    <script>fbq('track','ViewContent',{content_id:'118636',price:14549,value:14549,currency:'UAH'});</script>
    <script>window.ad_product={id:'132933',price:'14549',url:'${TOUCH_URL}'};</script>
    <script>eS('ProductPage',{productKey:'118636',price:'14549',isInStock:1});</script>
    <script>initBanksInItem = function(sum = "14 549 ₴") { return sum; };</script>
    <script>window.agec_detail_base={id:'118636',price:14499,currency:'UAH'};</script>
    <img src="https://touch.com.ua/upload/huion.jpg"></main></body></html>`;
  const result=reconcileDeterministicPrice(parseHtmlProduct(html,TOUCH_URL));
  assert.equal(result.price,14549);
  assert.equal(result.priceVerification.status,'STRUCTURED');
  assert.match(result.priceVerification.source,/touch-inline/);
  assert.equal(result.priceVerification.evidenceCount,4);
  assert.equal(result.priceConflict,false);
  assert.equal(productPriceReliable(result,'touch.com.ua'),true);
});

test('a verified fresh Touch sale clears a stale conflict inherited from the first response',()=>{
  const stale={
    title:'Huion Kamvas 13 Gen3 Black',price:21599,priceConflict:true,
    priceFacts:[
      {currentPrice:21599,source:'structured:jsonld-offer',confidence:.91,authoritative:true,evidenceCount:1},
      {currentPrice:14499,source:'structured:meta-price',confidence:.88,authoritative:true,evidenceCount:1}
    ],source:['html']
  };
  const fresh={
    price:14549,
    priceFacts:[{currentPrice:14549,originalPrice:21599,discountAmount:7050,source:'html:sale-triplet'}],
    source:['touch-fresh-html']
  };
  const merged=mergeProduct(stale,fresh);
  assert.equal(merged.priceConflict,true,'merge preserves the warning until evidence is reconciled');
  const result=reconcileDeterministicPrice(merged);
  assert.equal(result.price,14549);
  assert.equal(result.priceVerification.status,'VERIFIED');
  assert.equal(result.priceConflict,false);
  assert.equal(productPriceReliable(result,'touch.com.ua'),true);
});

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

test('Touch blocks a lone stale price and routes the ambiguity to exact-page web verification',()=>{
  const stale={title:'Графічний монітор Huion Kamvas 13 Gen3 Black',image:'https://touch.com.ua/upload/huion.jpg',price:21599,priceVerification:{status:'CURRENT_ONLY'},inspectorTexts:['21599 ₴']};
  const evidence=buildAiInspectorEvidence(stale,TOUCH_URL,'touch.com.ua');
  assert.equal(productPriceReliable(stale,'touch.com.ua'),false);
  assert.equal(shouldRunAiProductInspector(stale,evidence,'touch.com.ua'),true);
});

test('a JSON-LD value marked as old in the DOM cannot become the current Touch price',()=>{
  const staleHtml=`<!doctype html><html><head><title>Huion Kamvas 13 Gen3 Black</title>
    <link rel="canonical" href="${TOUCH_URL}">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Huion Kamvas 13 Gen3 Black","image":"https://touch.com.ua/upload/huion.jpg","offers":{"@type":"Offer","price":21599,"priceCurrency":"UAH","url":"${TOUCH_URL}"}}</script>
    </head><body><main class="product-card"><h1>Huion Kamvas 13 Gen3 Black</h1><span class="old_price">21 599 ₴</span><img src="https://touch.com.ua/upload/huion.jpg"></main></body></html>`;
  const result=reconcileDeterministicPrice(parseHtmlProduct(staleHtml,TOUCH_URL));
  assert.equal(result.price,21599);
  assert.equal(productPriceReliable(result,'touch.com.ua'),false);
  assert.equal(shouldRunAiProductInspector(result,buildAiInspectorEvidence(result,TOUCH_URL,'touch.com.ua'),'touch.com.ua'),true);
});

test('conflicting authoritative current-price sources are never silently accepted',()=>{
  const conflictHtml=`<!doctype html><html><head><title>Huion Kamvas 13 Gen3 Black</title>
    <link rel="canonical" href="${TOUCH_URL}">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Huion Kamvas 13 Gen3 Black","image":"https://touch.com.ua/upload/huion.jpg","offers":{"@type":"Offer","price":14999,"priceCurrency":"UAH","url":"${TOUCH_URL}"}}</script>
    </head><body><main class="product-card"><h1>Huion Kamvas 13 Gen3 Black</h1><span class="current-price">14 549 ₴</span><img src="https://touch.com.ua/upload/huion.jpg"></main></body></html>`;
  const result=reconcileDeterministicPrice(parseHtmlProduct(conflictHtml,TOUCH_URL));
  assert.equal(result.priceConflict,true);
  assert.equal(productPriceReliable(result,'touch.com.ua'),false);
  assert.equal(shouldRunAiProductInspector(result,buildAiInspectorEvidence(result,TOUCH_URL,'touch.com.ua'),'touch.com.ua'),true);
});

test('a lone unlabelled price is never trusted on an unknown store',()=>{
  const result={title:'Example product',image:'https://shop.example/product.jpg',price:999,priceVerification:{status:'CURRENT_ONLY',source:'parser-current'}};
  assert.equal(productPriceReliable(result,'shop.example'),false);
  assert.equal(shouldRunAiProductInspector(result,buildAiInspectorEvidence(result,'https://shop.example/product/42','shop.example'),'shop.example'),true);
});

test('foreign-currency Product/Offer data is not autofilled into a hryvnia card',()=>{
  const foreignUrl='https://shop.example/product/camera-123456/';
  const html=`<!doctype html><html><head><title>Camera</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Camera","image":"https://shop.example/camera.jpg","offers":{"@type":"Offer","price":399,"priceCurrency":"USD","url":"${foreignUrl}","availability":"https://schema.org/InStock"}}</script></head><body><main><h1>Camera</h1><img src="https://shop.example/camera.jpg"></main></body></html>`;
  const result=reconcileDeterministicPrice(parseHtmlProduct(html,foreignUrl));
  assert.equal(productPriceReliable(result,'shop.example'),false);
});

test('AI web price is accepted only from the exact product URL and never from an old-price value',()=>{
  const decision={page_opened:true,product_match:true,observed_current_price:14549,observed_original_price:21599,observed_discount_amount:7050,currency:'UAH',web_price_confidence:.97,source_url:TOUCH_URL,reason:'Exact product page'};
  assert.equal(sourceMatchesTargetProduct(TOUCH_URL,TOUCH_URL),true);
  assert.equal(sourceMatchesTargetProduct('https://touch.com.ua/ua/catalog/graficheskie-monitory/',TOUCH_URL),false);
  assert.equal(validateWebPriceDecision(decision,[TOUCH_URL],TOUCH_URL,{}).accepted,true);
  assert.equal(validateWebPriceDecision(decision,[],TOUCH_URL,{}).accepted,false,'model-declared URL is not a substitute for API-provided sources');
  assert.equal(validateWebPriceDecision({...decision,source_url:'https://touch.com.ua/ua/catalog/graficheskie-monitory/'},[],TOUCH_URL,{}).accepted,false);
  assert.equal(validateWebPriceDecision({...decision,observed_current_price:21599},[TOUCH_URL],TOUCH_URL,{originalPrice:21599,discountAmount:7050}).accepted,false);
});

test('Touch retries the same SKU through its second locale route',()=>{
  const urls=touchAlternateProductUrls(TOUCH_URL);
  assert.equal(urls.length,2);
  assert.equal(urls[0],TOUCH_URL);
  assert.equal(urls[1],TOUCH_URL.replace('/ua/item/','/item/'));
});

test('Touch fresh probe uses a safe five-minute cache key for both locale routes',()=>{
  const now=Date.UTC(2026,7,12,0,30,0);
  const urls=touchFreshProductUrls(TOUCH_URL,now);
  assert.equal(urls.length,2);
  assert.equal(new URL(urls[0]).searchParams.get('__hochu_price_probe'),String(Math.floor(now/300_000)));
  assert.equal(new URL(urls[1]).searchParams.get('__hochu_price_probe'),String(Math.floor(now/300_000)));
  assert.equal(new URL(urls[0]).pathname,new URL(TOUCH_URL).pathname);
  assert.equal(new URL(urls[1]).pathname,new URL(TOUCH_URL.replace('/ua/item/','/item/')).pathname);
  assert.deepEqual(touchFreshProductUrls(TOUCH_URL,now+299_999),urls);
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
