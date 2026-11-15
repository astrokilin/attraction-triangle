import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTraits } from '../traits.mjs';
import { evaluateIdentity, evaluateTriangle, allAnswers, nearestToZero } from '../model.mjs';

const traits = structuredClone(defaultTraits);
const female = allAnswers(traits, 0);
const male = allAnswers(traits, 1);
const profile = (id, answers, weight = 50) => ({ id, name: id, answers, weight });
const approx = (a, b, tol=1e-10) => assert.ok(Math.abs(a-b) < tol, `Expected ${a} ~ ${b}`);

test('extreme binary vectors map to ±1', () => {
  approx(evaluateIdentity(female, traits).value, -1);
  approx(evaluateIdentity(male, traits).value, 1);
});

test('one preferred masculine pole with masculine identity -> homo vertex', () => {
  const x = evaluateTriangle(male, [profile('male', male)], traits);
  assert.equal(x.ok, true);
  approx(x.homo, 1); approx(x.hetero, 0); approx(x.both, 0);
});

test('one preferred feminine pole with masculine identity -> hetero vertex', () => {
  const x = evaluateTriangle(male, [profile('female', female)], traits);
  assert.equal(x.ok, true);
  approx(x.homo, 0); approx(x.hetero, 1); approx(x.both, 0);
});

test('equally weighted opposite poles -> both vertex independently of identity', () => {
  for (const own of [male, female]) {
    const x = evaluateTriangle(own, [profile('f', female), profile('m', male)], traits);
    assert.equal(x.ok, true);
    approx(x.mu, 0); approx(x.r, 1); approx(x.both, 1);
    approx(x.hetero, 0); approx(x.homo, 0);
  }
});

test('near-androgynous preferences can lie near the bottom midpoint', () => {
  const nearF = nearestToZero(traits, -1);
  const nearM = nearestToZero(traits, 1);
  const vF = evaluateIdentity(nearF, traits).value;
  const vM = evaluateIdentity(nearM, traits).value;
  assert.ok(vF < 0 && vM > 0);
  const x = evaluateTriangle(male, [profile('nf', nearF), profile('nm', nearM)], traits);
  assert.equal(x.ok, true);
  assert.ok(x.both < 0.1);
  approx(x.homo + x.hetero + x.both, 1);
});

test('old model is exactly the horizontal triangle projection', () => {
  const nearF = nearestToZero(traits, -1);
  for (const own of [female, male, nearF]) {
    for (const pairs of [[profile('f',female,40),profile('m',male,60)], [profile('f',nearF,100)]]) {
      const x = evaluateTriangle(own, pairs, traits);
      assert.equal(x.ok, true);
      approx(x.homo-x.hetero, x.a*x.mu);
    }
  }
});

test('swap feminine and masculine answers globally: triangle is unchanged', () => {
  const invert = ans => Object.fromEntries(Object.entries(ans).map(([k,v]) => [k, 1-v]));
  const a = nearestToZero(traits, 1);
  const p = [profile('f', female, 27), profile('m', male, 73)];
  const x1 = evaluateTriangle(a, p, traits);
  const x2 = evaluateTriangle(invert(a), p.map(i => ({...i, answers: invert(i.answers)})), traits);
  assert.equal(x1.ok, true); assert.equal(x2.ok, true);
  approx(x1.homo,x2.homo); approx(x1.hetero,x2.hetero); approx(x1.both,x2.both);
});

test('exact balanced identity violates A0 instead of becoming zero', () => {
  const two = [{ id: 'a', question:'A', weight:1, enabled:true }, { id:'b', question:'B', weight:1, enabled:true }];
  const id = evaluateIdentity({a:1,b:0}, two);
  assert.equal(id.ok, false); assert.equal(id.tie,true);
});

test('zero total preference weight is invalid', () => {
  const x = evaluateTriangle(male, [profile('m',male,0)], traits);
  assert.equal(x.ok,false);
});

test('randomized weighted profiles remain in the triangle', () => {
  let seed = 123456789;
  const rng = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  for (let rep=0; rep<500; rep++) {
    const own = Object.fromEntries(traits.map(t=>[t.id,rng()<.5?0:1]));
    const prefs=Array.from({length:5},(_,i)=>profile(`p${i}`,Object.fromEntries(traits.map(t=>[t.id,rng()<.5?0:1])),1+Math.floor(rng()*100)));
    const x = evaluateTriangle(own,prefs,traits);
    if(!x.ok) { assert.match(x.reason,/I = 0/); continue; }
    assert.ok(x.homo>=-1e-10 && x.hetero>=-1e-10 && x.both>=-1e-10);
    approx(x.homo+x.hetero+x.both,1);
    approx(x.homo-x.hetero,x.a*x.mu);
  }
});
