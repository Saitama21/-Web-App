(() => {
  const clean = (value = '', max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const host = location.hostname.replace(/^www\./, '').toLowerCase();
  const isTouch = host === 'touch.com.ua';

  const numberFrom = value => {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
    const matches = String(value ?? '').replace(/\u00a0/g, ' ').match(/\d[\d\s.,]{0,18}/g) || [];
    for (const raw of matches) {
      let normalized = raw.trim().replace(/\s/g, '');
      if (!normalized) continue;
      if (normalized.includes(',') && normalized.includes('.')) {
        normalized = normalized.lastIndexOf(',') > normalized.lastIndexOf('.')
          ? normalized.replace(/\./g, '').replace(',', '.')
          : normalized.replace(/,/g, '');
      } else {
        normalized = normalized.replace(',', '.');
      }
      const result = Number(normalized);
      if (Number.isFinite(result) && result > 0 && result <= 100000000) return Math.round(result * 100) / 100;
    }
    return null;
  };

  const visible = node => {
    if (!node || node.tagName === 'META') return Boolean(node);
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0 && (rect.width > 0 || rect.height > 0);
  };

  const valueOf = node => {
    if (!node) return null;
    for (const attr of ['data-nowprice', 'data-current-price', 'data-sale-price', 'data-final-price', 'data-price', 'content', 'value']) {
      const parsed = numberFrom(node.getAttribute?.(attr));
      if (parsed) return parsed;
    }
    return numberFrom(node.textContent);
  };

  const firstPrice = (selectors, requireVisible = true) => {
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (requireVisible && !visible(node)) continue;
        const identity = `${node.tagName || ''} ${node.id || ''} ${node.className || ''}`;
        if (/old|previous|regular|original|cross|strike|line-through/i.test(identity)) continue;
        const parsed = valueOf(node);
        if (parsed) return { value: parsed, selector };
      }
    }
    return null;
  };

  const firstAnyPrice = selectors => {
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        const parsed = valueOf(node);
        if (parsed) return { value: parsed, selector };
      }
    }
    return null;
  };

  const jsonProducts = [];
  const visitJson = value => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.slice(0, 100).forEach(visitJson); return; }
    const type = value['@type'];
    if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) jsonProducts.push(value);
    if (value['@graph']) visitJson(value['@graph']);
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { visitJson(JSON.parse(script.textContent)); } catch {}
  }
  const productJson = jsonProducts[0] || null;
  const offers = productJson?.offers ? (Array.isArray(productJson.offers) ? productJson.offers : [productJson.offers]) : [];

  const title = clean(
    document.querySelector('h1.changeName, h1')?.textContent ||
    productJson?.name ||
    document.querySelector('meta[property="og:title"]')?.content ||
    document.title,
    250
  );

  const touchCurrent = isTouch ? firstPrice([
    'a.price.changePrice', '#new_price',
    '.h2o_trackprod_popup_link.changeID[data-nowprice]',
    '.banks_list[data-price]'
  ]) : null;
  const genericCurrent = firstPrice([
    '[data-current-price]', '[data-sale-price]', '[data-final-price]',
    '[class*="current"][class*="price"]', '[class*="sale"][class*="price"]',
    '[class*="special"][class*="price"]', '[itemprop="price"]'
  ]);
  const metaCurrent = firstAnyPrice(['meta[property="product:price:amount"]', 'meta[itemprop="price"]']);
  const offerPrice = numberFrom(offers[0]?.price ?? offers[0]?.lowPrice ?? offers[0]?.priceSpecification?.price);
  const current = touchCurrent || genericCurrent || metaCurrent || (offerPrice ? { value: offerPrice, selector: 'jsonld:Product.Offer' } : null);

  const old = firstAnyPrice(isTouch
    ? ['.old_new_price .pr', '#old_price', '.old_price', 'del', 's', 'strike']
    : ['del', 's', 'strike', '[class*="old"][class*="price"]', '[class*="price"][class*="old"]', '[class*="original"][class*="price"]']);
  const discount = firstAnyPrice(isTouch
    ? ['.economy', '[class*="discount"]']
    : ['[class*="discount-amount"]', '[class*="saving"]', '[class*="economy"]']);

  const price = current?.value || null;
  const originalPrice = old?.value && price && old.value > price ? old.value : null;
  const explicitDiscount = discount?.value || null;
  let discountAmount = explicitDiscount;
  if (originalPrice && price && (!discountAmount || Math.abs(originalPrice - discountAmount - price) > 0.01)) {
    discountAmount = Math.round((originalPrice - price) * 100) / 100;
  }
  const arithmeticVerified = Boolean(originalPrice && explicitDiscount && price && Math.abs(originalPrice - explicitDiscount - price) <= 0.01);

  const imageValue = productJson?.image;
  const jsonImage = Array.isArray(imageValue) ? imageValue[0] : (typeof imageValue === 'object' ? imageValue?.url || imageValue?.contentUrl : imageValue);
  const rawImage = clean(
    document.querySelector('meta[property="og:image"]')?.content ||
    jsonImage ||
    document.querySelector('main img[src], [class*="gallery"] img[src], [class*="product"] img[src]')?.currentSrc ||
    document.querySelector('main img[src], [class*="gallery"] img[src], [class*="product"] img[src]')?.src,
    3000
  );
  let image = '';
  try { image = rawImage ? new URL(rawImage, location.href).href : ''; } catch {}

  const selectedVariant = clean(
    document.querySelector('select option:checked')?.textContent ||
    document.querySelector('[aria-checked="true"], [aria-selected="true"], .selected.current, .active.selected')?.textContent ||
    '',
    80
  );
  const store = isTouch ? 'Touch' : clean(document.querySelector('meta[property="og:site_name"]')?.content || host.split('.')[0], 120);
  const evidence = [
    current?.selector ? `current:${current.selector}` : '',
    old?.selector ? `old:${old.selector}` : '',
    discount?.selector ? `discount:${discount.selector}` : '',
    arithmeticVerified ? 'arithmetic:verified' : ''
  ].filter(Boolean);

  const result = {
    url: location.href,
    canonicalUrl: document.querySelector('link[rel="canonical"]')?.href || location.href,
    title,
    price,
    originalPrice,
    discountAmount,
    arithmeticVerified,
    image,
    store,
    storeDomain: host,
    variant: selectedVariant,
    adapter: isTouch ? 'touch-dom' : 'generic-dom',
    evidence
  };
  globalThis.__hochuExtractedProduct = result;
  return result;
})();
