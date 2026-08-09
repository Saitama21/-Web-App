import test from 'node:test';
import assert from 'node:assert/strict';

process.env.HOCHU_TEST='1';
const { parseMakeupReaderMarkdown, parseMakeupSearchHtml, parseMakeupSearchText, rankMakeupImages } = await import('../server.js');

const cases = [
  {id:'191575', title:'Dior Sauvage', price:3790, variant:'60 ml', product:'https://u.makeup.com.ua/product/dior-sauvage-191575.jpg'},
  {id:'35179', title:'Creed Aventus', price:12919, variant:'100 ml', product:'https://u.makeup.com.ua/product/creed-aventus-35179.jpg'},
  {id:'15154', title:'Chanel Bleu de Chanel', price:4281, variant:'50 ml', product:'https://u.makeup.com.ua/product/chanel-bleu-15154.jpg'}
];

for (const c of cases) {
  test(`reader chooses product gallery image for ${c.title}, not a square promo`, () => {
    const md = `Title: ${c.title}\n\n![Дермакосметика](https://u.makeup.com.ua/promo/square-ad-${c.id}.jpg)\n\nMAKEUP Rewards Подарунок Акція\n\n![${c.title}](${c.product})\n\n# ${c.title}\n\n${c.price} ₴\n\n+Усі об'єми (6)\n\n${c.variant}\n\nКод товару: ${c.id}\n`;
    const out = parseMakeupReaderMarkdown(md, `https://makeup.com.ua/ua/product/${c.id}/`);
    assert.equal(out.title, c.title);
    assert.equal(out.image, c.product);
    assert.equal(out.trustedImageCandidates[0], c.product);
    assert.equal(out.variant, c.variant);
  });

  test(`exact MAKEUP search card is trusted for ${c.title}`, () => {
    const html = `<!doctype html><html><body>
      <div class="promo"><img src="https://u.makeup.com.ua/promo/dermocosmetics.jpg" alt="Дермакосметика"></div>
      <article class="product-card">
        <a href="/ua/product/${c.id}/" title="${c.title}"><img src="${c.product}" alt="${c.title}"></a>
        <a href="/ua/product/${c.id}/">${c.title}</a><span>${c.price} ₴</span>
      </article>
    </body></html>`;
    const out = parseMakeupSearchHtml(html, 'https://makeup.com.ua/ua/search/?q='+c.id, `https://makeup.com.ua/ua/product/${c.id}/`, c.title);
    assert.equal(out.image, c.product);
    assert.equal(out.trustedImageCandidates[0], c.product);
    assert.equal(out.price, c.price);
  });

  test(`reader search result rejects nearby promo for ${c.title}`, () => {
    const md = `![Подарунок](https://u.makeup.com.ua/promo/gift-${c.id}.jpg)\n
[${c.title}](https://makeup.com.ua/ua/product/${c.id}/)\n
![${c.title}](${c.product})\n
${c.price} ₴\n`;
    const out = parseMakeupSearchText(md, `https://makeup.com.ua/ua/product/${c.id}/`, c.title);
    assert.equal(out.image, c.product);
    assert.equal(out.trustedImageCandidates[0], c.product);
  });
}

test('gallery and exact-search sources outrank generic square CDN ads', () => {
  const title='Dior Sauvage';
  const page='https://makeup.com.ua/ua/product/191575/';
  const ranked=rankMakeupImages([
    {url:'https://u.makeup.com.ua/random-square.jpg',alt:'',context:'beauty article'},
    {url:'https://u.makeup.com.ua/product.jpg',alt:'Dior Sauvage',context:'product gallery',fromGallery:true},
    {url:'https://u.makeup.com.ua/exact.jpg',alt:'Dior Sauvage',context:'search card',fromExactSearch:true}
  ],title,page);
  assert.equal(ranked[0].url,'https://u.makeup.com.ua/exact.jpg');
  assert.equal(ranked[1].url,'https://u.makeup.com.ua/product.jpg');
});
