/**
 * Sexual Representation Triangle — pure mathematical model.
 * Это условная система классификации, а не клинический или эмпирический тест.
 * Answer convention: 0 = feminine-coded option, 1 = masculine-coded option.
 */

import { exactIdentityNumerator, integerWeights } from './weight_validation.mjs';

export const EPS = 1e-9;

/** Full questionnaire vector, including disabled traits; independent of answer key order. */
export function partnerVectorKey(answers, traits) {
  return JSON.stringify(traits.map(t => answers?.[t.id]));
}

/** First saved profile owns the vector's explicit weight. Never sum duplicate weights. */
export function uniquePartnerProfiles(ideals, traits) {
  const seen = new Set();
  return ideals.filter(p => {
    const key = partnerVectorKey(p.answers, traits);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A single weighted sum for all enabled traits; groups only organize the UI. */
export function evaluateIdentity(answers, traits) {
  const active=traits.filter(t=>t.enabled && Number(t.weight)>0);
  if(!active.length)return {ok:false,reason:'Нет активных вопросов с положительными весами.'};
  let numerator=0,denominator=0;
  for(const trait of active){
    const answer=answers?.[trait.id];
    if(answer!==0&&answer!==1)return {ok:false,reason:`Не выбран бинарный ответ на вопрос “${trait.question}”.`};
    const w=Number(trait.weight);
    numerator+=w*(2*answer-1);denominator+=w;
  }
  let value=numerator/denominator;
  if(Math.abs(value)<EPS){
    const exact=exactIdentityNumerator(answers,traits);
    if(exact?.signed===0n) return {ok:false,tie:true,reason:'I = 0 для этих ответов: результат не определён аксиомой модели. Измените ответы или вручную настройте веса.'};
    if(exact&&exact.total>0n)value=Number(exact.signed)/Number(exact.total);
    else return {ok:false,reason:'Значение I слишком близко к нулю для надёжного вычисления; проверьте точность весов.'};
  }
  return {ok:true,value,numerator,denominator};
}

export function evaluateTriangle(ownAnswers, ideals, traits) {
  const own = evaluateIdentity(ownAnswers, traits);
  if (!own.ok) return { ok: false, context: 'Мои характеристики', reason: own.reason };

  const relevant = uniquePartnerProfiles(ideals, traits).filter(p => Number(p.weight) > 0);
  const totalWeight = relevant.reduce((sum, p) => sum + Number(p.weight), 0);
  if (!relevant.length || totalWeight <= 0) {
    return { ok: false, context: 'Мои предпочтения', reason: 'Хотя бы один партнер должен иметь положительный вес предпочтения.' };
  }
  let mu = 0;
  let r = 0;
  const evaluated = [];
  for (const p of relevant) {
    const result = evaluateIdentity(p.answers, traits);
    if (!result.ok) return { ok: false, context: `Партнер “${p.name}”`, reason: result.reason };
    const probability = Number(p.weight) / totalWeight;
    mu += probability * result.value;
    r += probability * Math.abs(result.value);
    evaluated.push({ id: p.id, name: p.name, identity: result.value, probability });
  }

  // Math: 0 <= |mu| <= r <= 1. b measures opposing preference polarization.
  const both = Math.max(0, Math.min(1, r - Math.abs(mu)));
  const signed = own.value * mu;
  const homo = (1 - both + signed) / 2;
  const hetero = (1 - both - signed) / 2;
  return {
    ok: true,
    a: own.value,
    mu,
    r,
    both,
    signed,
    homo,
    hetero,
    evaluated
  };
}

export function allAnswers(traits, value) {
  return Object.fromEntries(traits.map(t => [t.id, value]));
}

/** Closest nonzero representation of a requested sign, with original trait weights. */
export function nearestToZero(traits, sign=1) {
  const active=traits.filter(t=>t.enabled && Number(t.weight)>0);
  const defaultAnswer=sign>0?1:0;
  if(!active.length)return allAnswers(traits,defaultAnswer);
  const total=active.reduce((sum,t)=>sum+Number(t.weight),0);
  const parsed=integerWeights(traits),exact=!parsed.error;
  const weighted=active.map((t,i)=>({...t,effective:Number(t.weight)/total,searchWeight:exact?parsed.weights[i]:Number(t.weight)/total}));
  let best=allAnswers(traits,defaultAnswer),bestAbs=Infinity;
  if(weighted.length<=30){
    const mid=Math.floor(weighted.length/2),left=weighted.slice(0,mid),right=weighted.slice(mid);
    const subsets=items=>{
      const sums=[{sum:exact?0n:0,mask:0}];
      items.forEach((t,i)=>{const length=sums.length;for(let j=0;j<length;j++)sums.push({sum:sums[j].sum+t.searchWeight,mask:sums[j].mask+2**i});});
      return sums;
    };
    const rightSums=subsets(right).sort((a,b)=>a.sum<b.sum?-1:a.sum>b.sum?1:0);
    // Strictly above the exact half excludes zero without excluding small valid identities.
    const target=exact?parsed.weights.reduce((sum,w)=>sum+w,0n)/2n:.5;
    for(const l of subsets(left)){
      let low=0,high=rightSums.length;
      while(low<high){const m=Math.floor((low+high)/2);if(l.sum+rightSums[m].sum<=target)low=m+1;else high=m;}
      if(low===rightSums.length)continue;
      const r=rightSums[low],candidate=allAnswers(traits,defaultAnswer);
      for(const [items,mask] of [[left,l.mask],[right,r.mask]])items.forEach((t,i)=>{const bit=Math.floor(mask/2**i)%2;candidate[t.id]=sign>0?bit:1-bit;});
      const result=evaluateIdentity(candidate,traits);
      if(result.ok&&result.value*sign>0&&Math.abs(result.value)<bestAbs){bestAbs=Math.abs(result.value);best=candidate;}
    }
  }else{
    const sorted=[...weighted].sort((a,b)=>b.effective-a.effective);
    let signedSum=sign;
    for(const t of sorted){
      const next=signedSum-2*sign*t.effective;
      if(next*sign>0&&Math.abs(next)<Math.abs(signedSum)){
        signedSum=next;best[t.id]=1-defaultAnswer;
      }
    }
  }
  const check=evaluateIdentity(best,traits);
  return check.ok&&check.value*sign>0?best:allAnswers(traits,defaultAnswer);
}
