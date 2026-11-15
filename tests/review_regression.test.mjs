import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultTraits} from '../traits.mjs';
import {evaluateIdentity,evaluateTriangle,nearestToZero,allAnswers} from '../model.mjs';
import {validateNonzeroIdentity} from '../weight_validation.mjs';

const traits=weights=>weights.map((weight,i)=>({id:`t${i}`,question:`Вопрос ${i}`,weight,enabled:true}));
const approx=(actual,expected,tolerance=1e-12)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);

test('independent exhaustive enumeration of all 8,388,608 default vectors finds no zero',()=>{
  // Literal integer coefficients from the documented 0.05 grid, not the production validator.
  const units=[60,36,30,28,18,16,7,11,5,11,11,9,10,9,11,12,17,20,20,20,20,20,20];
  assert.equal(defaultTraits.length,units.length);
  for(let i=0;i<units.length;i++)assert.equal(defaultTraits[i].weight,units[i]/20);
  const total=units.reduce((sum,w)=>sum+w,0);
  assert.equal(total,421);
  let signed=-total,previous=0,zeros=0,minimum=total;
  for(let i=1;i<2**units.length;i++){
    const gray=i^(i>>1),changed=gray^previous,bit=31-Math.clz32(changed);
    signed+=(gray&changed?2:-2)*units[bit];
    if(signed===0)zeros++;
    minimum=Math.min(minimum,Math.abs(signed));previous=gray;
  }
  assert.equal(zeros,0);assert.equal(minimum,1);
});

test('validator and identity match an independent exhaustive oracle for 1,296 integer configurations',()=>{
  for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)for(let d=1;d<=6;d++){
    const weights=[a,b,c,d],ts=traits(weights),total=a+b+c+d;
    let hasZero=false;
    for(let mask=0;mask<16;mask++){
      const answers=Object.fromEntries(weights.map((_,i)=>[`t${i}`,mask>>i&1]));
      const signed=weights.reduce((sum,w,i)=>sum+((mask>>i&1)?w:-w),0);
      hasZero ||= signed===0;
      const r=evaluateIdentity(answers,ts);
      assert.equal(r.ok,signed!==0);
      if(r.ok)approx(r.value,signed/total);else assert.equal(r.tie,true);
    }
    const result=validateNonzeroIdentity(ts);
    assert.equal(result.status,hasZero?'invalid':'valid',String(weights));
    if(result.witness)assert.equal(weights.reduce((sum,w,i)=>sum+w*(2*result.witness[`t${i}`]-1),0),0);
  }
});

test('exact decimal and exponent cases exercise both partition algorithms without changing weights',()=>{
  for(const weights of [[.1,.2,.3],[1e-7,2e-7,3e-7],[.1234567891234567,.2345678912345678,.3580246803580245]]){
    const ts=traits(weights),before=structuredClone(ts);
    assert.equal(validateNonzeroIdentity(ts).status,'invalid');
    const r=evaluateIdentity({t0:1,t1:1,t2:0},ts);
    assert.equal(r.ok,false);assert.equal(r.tie,true);
    assert.deepEqual(ts,before);
  }
});

test('androgynous search must not skip legitimate nonzero scores below EPS',()=>{
  for(const [weights,expected] of [
    [[.5,.5000000001],1e-10/1.0000000001],
    [[.05,.05000000000000001],1e-17/.10000000000000001]
  ])for(const sign of [-1,1]){
    const ts=traits(weights),r=evaluateIdentity(nearestToZero(ts,sign),ts);
    assert.equal(r.ok,true);assert.equal(Math.sign(r.value),sign);
    approx(Math.abs(r.value)/expected,1,1e-12);
  }
});

test('normalization is invariant to scaling all positive preference weights, including subnormal numbers',()=>{
  const ts=traits([1]),own={t0:1};
  for(const scale of [1,1e-10,1e-15,1e-200,Number.MIN_VALUE]){
    const partners=[{id:'f',name:'F',answers:{t0:0},weight:scale},{id:'m',name:'M',answers:own,weight:2*scale}];
    const r=evaluateTriangle(own,partners,ts);
    assert.equal(r.ok,true,`positive weights at scale ${scale} must be normalizable`);
    approx(r.mu,1/3);approx(r.both,2/3);approx(r.homo,1/3);approx(r.hetero,0);
    approx(r.homo+r.hetero+r.both,1);approx(r.homo-r.hetero,r.a*r.mu);
    assert.deepEqual(evaluateTriangle(own,[...partners,{...partners[0],id:'copy',weight:100}],ts),r);
  }
});

test('triangle agrees with an independent rational oracle for all three-trait nonzero vectors',()=>{
  const ts=traits([1,2,4]);
  for(let ownMask=0;ownMask<8;ownMask++)for(let a=0;a<8;a++)for(let b=0;b<8;b++){
    const answers=mask=>Object.fromEntries(ts.map((t,i)=>[t.id,mask>>i&1]));
    const numerator=mask=>ts.reduce((sum,t,i)=>sum+t.weight*((mask>>i&1)?1:-1),0);
    const own=answers(ownMask),partners=[{id:'a',name:'A',answers:answers(a),weight:2},{id:'b',name:'B',answers:answers(b),weight:3}];
    const r=evaluateTriangle(own,partners,ts);
    assert.equal(r.ok,true);
    const x=numerator(ownMask)/7;
    const mu=a===b?numerator(a)/7:(2*numerator(a)+3*numerator(b))/35;
    const absolute=a===b?Math.abs(numerator(a))/7:(2*Math.abs(numerator(a))+3*Math.abs(numerator(b)))/35;
    const both=absolute-Math.abs(mu);
    approx(r.a,x);approx(r.mu,mu);approx(r.r,absolute);approx(r.both,both);
    approx(r.hetero,(1-both-x*mu)/2);approx(r.homo,(1-both+x*mu)/2);
    assert.ok([r.hetero,r.homo,r.both].every(v=>v>=-1e-12));
    approx(r.hetero+r.homo+r.both,1);approx(r.homo-r.hetero,x*mu);
  }
});
