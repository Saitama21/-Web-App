export function priceHistorySummary(entries=[],currentPrice=0){
  const prices=entries.map(x=>Number(x.price||0)).filter(x=>x>0);
  const current=Number(currentPrice||prices.at(-1)||0);
  const first=prices[0]||current||0;
  const min=prices.length?Math.min(...prices):current;
  const max=prices.length?Math.max(...prices):current;
  const previous=[...prices].reverse().find(v=>Math.abs(v-current)>=0.01);
  return {
    currentPrice:current,
    firstPrice:first,
    minPrice:min,
    maxPrice:max,
    previousPrice:previous??null,
    historyCount:prices.length,
    changeFromFirst:first?((current-first)/first)*100:0
  };
}
