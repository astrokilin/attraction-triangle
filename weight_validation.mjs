/**
 * Exact validation of A0 for the finite set of enabled binary traits.
 * Treat JS numbers as their shortest decimal string (the value the UI stored),
 * scale to positive BigInt integers and solve the equal-partition problem.
 * No weights are ever rounded or modified by this validator.
 */
export function integerWeights(traits) {
  const active = traits.filter(t => t.enabled && Number(t.weight) > 0);
  if (!active.length) return { active, weights: [] };
  const parts = active.map(t => {
    const s = String(t.weight);
    const m = /^([0-9]+)(?:\.([0-9]+))?(?:e([+-]?\d+))?$/i.exec(s);
    if (!m) return null;
    const fraction = m[2] ?? '';
    const exp = Number(m[3] ?? 0);
    if (!Number.isSafeInteger(exp)) return null;
    const decimalPlaces = fraction.length - exp;
    return { mantissa: BigInt(m[1] + fraction), decimalPlaces };
  });
  if (parts.some(x=>!x)) return { active, error: 'Некорректные числовые веса.' };
  const scale = Math.max(0, ...parts.map(p=>p.decimalPlaces));
  // Decimal inputs more precise than 18 places may be difficult to partition
  // within the resource budget. Return unknown rather than a false guarantee.
  if (scale > 18) return { active, error: 'Слишком высокая точность весов для проверки.' };
  const weights = parts.map(p => p.mantissa * 10n ** BigInt(scale - p.decimalPlaces));
  return { active, weights };
}

/**
 * @returns {{status:'valid'|'invalid'|'unknown'|'empty',reason:string,witness?:Object}}
 * 'unknown' intentionally does NOT certify A0. UI must show it as a warning.
 */
export function validateNonzeroIdentity(traits) {
  const parsed=integerWeights(traits);
  if (!parsed.active.length) return {status:'empty',reason:'В анкете нет активных вопросов с положительными весами.'};
  if (parsed.error) return {status:'unknown',reason:parsed.error};
  const {active,weights}=parsed;
  const total=weights.reduce((a,b)=>a+b,0n);
  if(total%2n!==0n) return {status:'valid',reason:'Для любых бинарных ответов I ≠ 0 (точная проверка весов).'};
  const target=total/2n;
  // Reachability for ordinary questionnaires, including the full default one.
  // The cap bounds memory and CPU use for user-specified precision.
  const MAX_TARGET=250_000n;
  if(target<=MAX_TARGET){
    const t=Number(target);
    const reachable=new Uint8Array(t+1);
    const parent=new Int32Array(t+1).fill(-1);
    const previous=new Int32Array(t+1).fill(-1);
    reachable[0]=1;
    weights.forEach((weight,i)=>{
      if(weight>target)return;
      const w=Number(weight);
      for(let s=t;s>=w;s--)if(!reachable[s]&&reachable[s-w]){
        reachable[s]=1;parent[s]=i;previous[s]=s-w;
      }
    });
    if(!reachable[t])return {status:'valid',reason:'Ни одна комбинация бинарных ответов не даёт I = 0.'};
    const witness=Object.fromEntries(active.map(t=>[t.id,0]));
    for(let s=t;s>0;){const i=parent[s];if(i<0)break;witness[active[i].id]=1;s=previous[s];}
    return {status:'invalid',reason:'Существует комбинация бинарных ответов с I = 0.',witness};
  }
  // Exact meet-in-the-middle fallback for weights with many decimal places.
  // Keep upper limit to avoid exponential UI freezes on large custom surveys.
  if(weights.length<=30){
    const midpoint=Math.floor(weights.length/2),left=weights.slice(0,midpoint),right=weights.slice(midpoint);
    const sums=items=>{let arr=[0n];for(const w of items)arr=arr.concat(arr.map(s=>s+w));return arr;};
    const rightSet=new Set(sums(right));
    if(sums(left).some(s=>rightSet.has(target-s)))return {status:'invalid',reason:'Существует комбинация бинарных ответов с I = 0.'};
    return {status:'valid',reason:'Точная проверка подтвердила: I ≠ 0 для всех комбинаций.'};
  }
  return {status:'unknown',reason:'Не удалось проверить все комбинации для указанного количества и точности весов. Это не означает, что аксиома выполняется.'};
}

/** Compute exact signed sum only near numerical cancellation. */
export function exactIdentityNumerator(answers, traits){
  const parsed=integerWeights(traits);
  if(parsed.error||!parsed.active.length)return null;
  let signed=0n;
  for(let i=0;i<parsed.active.length;i++){
    const answer=answers?.[parsed.active[i].id];
    if(answer!==0&&answer!==1)return null;
    signed+=(answer===1?1n:-1n)*parsed.weights[i];
  }
  return {signed,total:parsed.weights.reduce((a,b)=>a+b,0n)};
}
