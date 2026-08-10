function amount(value){
  const n=Number(value);
  return Number.isFinite(n)&&n>0?Math.round(n*100)/100:null;
}

export function validatePriceArithmetic(input={}){
  const currentPrice=amount(input.currentPrice);
  const originalPrice=amount(input.originalPrice);
  const explicitDiscount=amount(input.discountAmount);
  if(!currentPrice){
    return {status:'BLOCK',verified:false,currentPrice:null,originalPrice,discountAmount:explicitDiscount,reason:'Нет корректной текущей цены'};
  }
  if(originalPrice&&originalPrice<currentPrice-0.01){
    return {status:'CONFLICT',verified:false,currentPrice,originalPrice,discountAmount:explicitDiscount,reason:'Старая цена меньше текущей'};
  }
  if(originalPrice&&explicitDiscount){
    const expected=Math.round((originalPrice-explicitDiscount)*100)/100;
    if(Math.abs(expected-currentPrice)<=0.01){
      return {status:'VERIFIED',verified:true,currentPrice,originalPrice,discountAmount:explicitDiscount,reason:'Старая цена − скидка = текущая цена'};
    }
    return {status:'CONFLICT',verified:false,currentPrice,originalPrice,discountAmount:explicitDiscount,reason:`${originalPrice} − ${explicitDiscount} ≠ ${currentPrice}`};
  }
  if(originalPrice&&originalPrice>currentPrice){
    return {status:'SALE_PAIR',verified:false,currentPrice,originalPrice,discountAmount:Math.round((originalPrice-currentPrice)*100)/100,reason:'Найдены текущая и старая цены; скидка рассчитана бесплатно'};
  }
  return {status:'CURRENT_ONLY',verified:false,currentPrice,originalPrice:null,discountAmount:null,reason:'Найдена только текущая цена'};
}

export function pickBestPriceFact(facts=[],fallbackCurrentPrice=null){
  const normalized=(Array.isArray(facts)?facts:[]).map((fact,index)=>{
    const checked=validatePriceArithmetic(fact);
    const source=String(fact?.source||'page');
    let score=0;
    if(checked.status==='VERIFIED')score+=300;
    else if(checked.status==='SALE_PAIR')score+=180;
    else if(checked.status==='CURRENT_ONLY')score+=80;
    else if(checked.status==='CONFLICT')score-=250;
    if(/dom|html|jsonld|meta|api/i.test(source))score+=40;
    if(/reader/i.test(source))score+=20;
    if(checked.originalPrice)score+=10;
    if(checked.discountAmount)score+=10;
    const fallback=amount(fallbackCurrentPrice);
    if(fallback&&checked.currentPrice&&Math.abs(fallback-checked.currentPrice)<=0.01)score+=12;
    return {...checked,source,score,index};
  }).filter(x=>x.currentPrice);
  normalized.sort((a,b)=>b.score-a.score||a.index-b.index);
  if(normalized.length)return normalized[0];
  return validatePriceArithmetic({currentPrice:fallbackCurrentPrice,source:'parser'});
}

export function candidatePriceRole(candidate={},facts={}){
  const value=amount(candidate.value);
  if(!value)return 'unknown';
  if(facts?.currentPrice&&Math.abs(value-Number(facts.currentPrice))<=0.01)return 'current';
  if(facts?.originalPrice&&Math.abs(value-Number(facts.originalPrice))<=0.01)return 'old';
  if(facts?.discountAmount&&Math.abs(value-Number(facts.discountAmount))<=0.01)return 'discount';
  const hint=String(candidate.roleHint||candidate.role||'').toLowerCase();
  if(['current','old','discount'].includes(hint))return hint;
  return 'unknown';
}
