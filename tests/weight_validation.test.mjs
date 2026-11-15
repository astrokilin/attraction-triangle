import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultTraits,BEHAVIOR_GROUP} from '../traits.mjs';
import {validateNonzeroIdentity} from '../weight_validation.mjs';
import {evaluateIdentity,evaluateTriangle,allAnswers,nearestToZero} from '../model.mjs';

const approx=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
const enabled=(weights)=>weights.map((weight,i)=>({id:`t${i}`,weight,enabled:true,question:`Trait ${i}`}));

test('default 23 traits have odd total in units of 0.05: A0 holds for all 2^23 vectors',()=>{
  assert.equal(defaultTraits.length,23);
  assert.equal(defaultTraits.find(t=>t.id==='height').weight,0.85);
  assert.ok(defaultTraits.filter(t=>t.group===BEHAVIOR_GROUP).every(t=>t.weight===1));
  const units=defaultTraits.reduce((s,t)=>s+Math.round(t.weight*20),0);
  assert.equal(units,421);
  assert.equal(units%2,1);
  assert.equal(validateNonzeroIdentity(defaultTraits).status,'valid');
});

test('unified identity uses every trait without grouping: relative weights have uniform interpretation',()=>{
  const all=allAnswers(defaultTraits,1),total=defaultTraits.reduce((s,t)=>s+t.weight,0);
  approx(total,21.05);
  for(const t of defaultTraits){
    const result=evaluateIdentity({...all,[t.id]:0},defaultTraits);
    assert.equal(result.ok,true);
    approx(1-result.value,2*t.weight/total);
  }
  const mixed=Object.fromEntries(defaultTraits.map(t=>[t.id,t.group===BEHAVIOR_GROUP?0:1]));
  approx(evaluateIdentity(mixed,defaultTraits).value,9.05/21.05);
});

test('simple valid and invalid subset-sum examples',()=>{
  const invalid=validateNonzeroIdentity(enabled([1,1]));
  assert.equal(invalid.status,'invalid');
  assert.ok(invalid.witness);
  assert.equal(evaluateIdentity(invalid.witness,enabled([1,1])).tie,true);
  assert.equal(validateNonzeroIdentity(enabled([1,2,4])).status,'valid');
  assert.equal(validateNonzeroIdentity(enabled([1,1,4])).status,'valid', 'even total does not imply a zero is reachable');
  assert.equal(validateNonzeroIdentity(enabled([0.1,0.2,0.3])).status,'invalid');
  assert.equal(validateNonzeroIdentity(enabled([0.1,0.2,0.4])).status,'valid');
});

test('disabled traits do not affect validation; custom weights are never changed',()=>{
  const traits=enabled([1,1]);traits[1].enabled=false;
  assert.equal(validateNonzeroIdentity(traits).status,'valid');
  traits[1].enabled=true;
  const before=structuredClone(traits);
  assert.equal(validateNonzeroIdentity(traits).status,'invalid');
  assert.deepEqual(traits,before);
  assert.equal(validateNonzeroIdentity([]).status,'empty');
});

test('invalid configuration is warned even when selected answer is nonzero',()=>{
  const traits=enabled([1,1]);
  assert.equal(validateNonzeroIdentity(traits).status,'invalid');
  const valid=evaluateIdentity({t0:1,t1:1},traits);
  assert.equal(valid.ok,true);approx(valid.value,1);
  const zero=evaluateIdentity({t0:1,t1:0},traits);
  assert.equal(zero.ok,false);assert.equal(zero.tie,true);assert.match(zero.reason,/I = 0/);
  const tri=evaluateTriangle({t0:1,t1:0},[{id:'p',name:'P',answers:{t0:1,t1:1},weight:50}],traits);
  assert.equal(tri.ok,false);
});

test('precise decimal test is exact; do not classify nonzero tiny values as ties',()=>{
  const traits=enabled([0.5,0.5000000001]);
  assert.equal(validateNonzeroIdentity(traits).status,'valid');
  const r=evaluateIdentity({t0:1,t1:0},traits);
  assert.equal(r.ok,true);
  assert.ok(r.value<0&&Math.abs(r.value)<1e-9);
  // Do not certify resource-intensive cases without exhaustive validation.
  const complex=Array.from({length:38},(_,i)=>({id:`t${i}`,weight:i<2?0.3333333333333333:1,enabled:true}));
  assert.equal(validateNonzeroIdentity(complex).status,'unknown');
});

test('nearest-androgynous example remains nonzero and obeys new uniform weights',()=>{
  for(const sign of [-1,1]){
    const r=evaluateIdentity(nearestToZero(defaultTraits,sign),defaultTraits);
    assert.equal(r.ok,true);assert.ok(r.value*sign>0);approx(Math.abs(r.value),1/421);
  }
});

test('triangle and duplicate behavior unchanged with unified identity',()=>{
  const own=allAnswers(defaultTraits,1),f=allAnswers(defaultTraits,0);
  const partners=[{id:'a',name:'A',weight:40,answers:f},{id:'b',name:'B',weight:60,answers:own}];
  const result=evaluateTriangle(own,partners,defaultTraits);
  approx(result.a,1);approx(result.mu,.2);approx(result.both,.8);
  approx(result.homo-result.hetero,result.a*result.mu);
  approx(result.homo+result.hetero+result.both,1);
  assert.deepEqual(evaluateTriangle(own,[...partners,{...partners[1],id:'dup',weight:99}],defaultTraits),result);
});
