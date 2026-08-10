function clean(v=''){return String(v??'').replace(/\s+/g,' ').trim();}
function normalizeVariant(v=''){
  return clean(v)
    .replace(/(\d)\s*(?:ml|мл)(?=$|[^\p{L}\p{N}])/igu,'$1 ml')
    .replace(/(\d)\s*(?:gb|гб)(?=$|[^\p{L}\p{N}])/igu,'$1 GB')
    .replace(/(\d)\s*(?:tb|тб)(?=$|[^\p{L}\p{N}])/igu,'$1 TB')
    .replace(/(\d)\s*(?:kg|кг)(?=$|[^\p{L}\p{N}])/igu,'$1 kg')
    .replace(/(\d)\s*(?:mm|мм)(?=$|[^\p{L}\p{N}])/igu,'$1 mm')
    .replace(/(\d)\s*(?:cm|см)(?=$|[^\p{L}\p{N}])/igu,'$1 cm');
}

export function extractInspectorVariantCandidates(texts=[], preferred=''){
  const out=[];
  const add=(value,context='')=>{
    const normalized=normalizeVariant(value);
    if(!normalized||normalized.length>80)return;
    const key=normalized.toLowerCase();
    if(out.some(x=>x.value.toLowerCase()===key))return;
    out.push({value:normalized,context:clean(context).slice(0,220)});
  };
  if(preferred)add(preferred,'parser result');
  const rx=/\d+(?:[.,]\d+)?\s*(?:ml|мл|l|л|g|г|kg|кг|gb|гб|tb|тб|mm|мм|cm|см|inch|inches|дюйм(?:а|ов)?|шт|pcs?)(?=$|[^\p{L}\p{N}])/igu;
  for(const raw of texts){
    const s=String(raw||''); let m;
    while((m=rx.exec(s))&&out.length<24){
      add(m[0],s.slice(Math.max(0,m.index-90),Math.min(s.length,m.index+m[0].length+130)));
    }
    if(out.length>=24)break;
  }
  return out.slice(0,16);
}

export function applyInspectorDecision(base={}, evidence={}, decision={}, minConfidence=.55){
  const confidence=Number(decision?.confidence||0);
  const next={...base};
  if(!Number.isFinite(confidence)||confidence<minConfidence)return {result:next,applied:false,confidence:Number.isFinite(confidence)?confidence:0};
  let applied=false;
  const imageIndex=Number(decision.image_index);
  if(Number.isInteger(imageIndex)&&imageIndex>=0&&evidence.images?.[imageIndex]?.url){next.image=evidence.images[imageIndex].url;applied=true;}
  const priceIndex=Number(decision.price_index);
  const priceCandidate=Number.isInteger(priceIndex)&&priceIndex>=0?evidence.prices?.[priceIndex]:null;
  const priceRole=String(priceCandidate?.role||'unknown').toLowerCase();
  if(priceCandidate&&Number(priceCandidate.value)>0&&!['old','discount'].includes(priceRole)){next.price=Number(priceCandidate.value);applied=true;}
  const variantIndex=Number(decision.variant_index);
  if(Number.isInteger(variantIndex)&&variantIndex>=0&&evidence.variants?.[variantIndex]?.value){next.variant=evidence.variants[variantIndex].value;applied=true;}
  return {result:next,applied,confidence};
}

export function inspectorEnum(count=0){
  return [-1,...Array.from({length:Math.max(0,Number(count)||0)},(_,i)=>i)];
}
