import {test} from 'node:test';
import assert from 'node:assert/strict';
import {computeSocial,DEFAULT_SCORING,resolveScoringConfig,validateScoringConfig} from '../scoring.mjs';
import {ValidationError} from '../validation.mjs';
import {frontendScore,frontendDefault,publicFixture} from './frontend-reference.mjs';
const data=await publicFixture();
const json=value=>JSON.parse(JSON.stringify(value));
const config=()=>structuredClone(DEFAULT_SCORING);
test('Default benchmark data matches real frontend constants',()=>assert.deepEqual(DEFAULT_SCORING,frontendDefault()));
test('Full scoring output matches frontend at every follower-band boundary',()=>{
 for(const followers of [0,1,999,1000,1001,4999,5000,5001,19999,20000,20001,99999,100000,100001,1e12]) {
  for(const metrics of [
   {views:0,interactions:0,accountsReached:0,netFollowers:0},
   {views:24800,interactions:1120,accountsReached:18400,netFollowers:260},
   {views:10,interactions:1,accountsReached:10,netFollowers:-10},
   {views:1e12,interactions:1e12,accountsReached:1,netFollowers:1e12}
  ]) {
   const d={...data,...metrics,followers};
   assert.deepEqual(json(computeSocial(d)),frontendScore(d),`followers=${followers}, ${JSON.stringify(metrics)}`);
  }
 }
});
test('Formula uses reached not views, negative growth is displayed but score is clamped',()=>{
 const d={...data,followers:1000,accountsReached:2000,interactions:100,netFollowers:-10};
 const s=computeSocial(d);assert.equal(s.er,5);assert.equal(s.reach,200);assert.equal(s.growth,-1);assert.equal(s.growthScore,0);
 assert.equal(s.socialScore,computeSocial({...d,views:999999}).socialScore);
});
test('Interpolation matches frontend around avg/good/excellent and saturation',()=>{
 for(const percentage of [0,0.1,2.99,3,3.01,5.99,6,6.01,9.99,10,10.01,20,100]) {
  const d={...data,followers:1000,accountsReached:10000,interactions:percentage*100,netFollowers:1};
  assert.deepEqual(json(computeSocial(d)),frontendScore(d));
 }
});
test('Legacy metrics and strings retain frontend fallback behavior',()=>{
 for(const d of [
  {followers:'8500',views:'24800',interactions:'1120',newFollowers:'260'},
  {followers:0,views:10,interactions:0,accountsReached:'',netFollowers:null,newFollowers:-1},
  {followers:'invalid',views:'invalid',interactions:null,newFollowers:''}
 ]) assert.deepEqual(json(computeSocial(d)),frontendScore(d));
});
test('Weights not totaling 100 normalize exactly like frontend',()=>{
 const c=config();c.weights={er:1,reach:2,growth:3};
 assert.deepEqual(json(computeSocial(data,c)),frontendScore(data,c));
});
test('Legacy version and supported partial v2 configs preserve frontend normalization',()=>{
 for(const c of [null,{version:1,tiers:[]},{version:2,weights:{er:20}},
  {version:2,bands:DEFAULT_SCORING.bands.map(b=>({label:b.label,max:b.max,er:{avg:b.er.avg}}))},
  {version:2,tiers:[{min:80},{min:60},{min:40},{min:0}]}
 ]) assert.deepEqual(json(computeSocial(data,c)),frontendScore(data,c));
});
for(const [name,mutate,code] of [
 ['unknown root',c=>{c.secret='forbidden';},'UNKNOWN_FIELD'],
 ['unknown weight',c=>{c.weights.extra=1;},'UNKNOWN_FIELD'],
 ['missing field',c=>{delete c.weights.er;},'MISSING_FIELD'],
 ['zero weights',c=>{c.weights={er:0,reach:0,growth:0};},'RANGE'],
 ['negative weight',c=>{c.weights.er=-1;},'RANGE'],
 ['NaN weight',c=>{c.weights.er=NaN;},'TYPE'],['Infinity weight',c=>{c.weights.er=Infinity;},'TYPE'],
 ['string weight',c=>{c.weights.er='45';},'TYPE'],
 ['level count',c=>{c.levels.pop();},'LENGTH'],['level order',c=>{c.levels[1].min=90;},'ORDER'],
 ['level enum',c=>{c.levels[0].v='ADMIN';},'ENUM'],['last min',c=>{c.levels[3].min=1;},'RANGE'],
 ['color',c=>{c.levels[0].c='red';},'FORMAT'],['label',c=>{c.levels[0].l='';},'REQUIRED'],
 ['bands count',c=>{c.bands.pop();},'LENGTH'],['bands order',c=>{c.bands[1].max=1;},'ORDER'],
 ['last max',c=>{c.bands[4].max=1e12;},'RANGE'],['threshold order',c=>{c.bands[0].er.good=1;},'ORDER'],
 ['threshold negative',c=>{c.bands[0].er.avg=-1;},'RANGE'],
 ['threshold unknown',c=>{c.bands[0].er.extra=1;},'UNKNOWN_FIELD'],
 ['sparse bands',c=>{delete c.bands[2];},'TYPE']
]) test(`Strict scoring config rejects ${name}`,()=>{
 const c=config();assert.doesNotThrow(()=>validateScoringConfig(c));mutate(c);
 assert.throws(()=>validateScoringConfig(c),e=>e instanceof ValidationError&&e.code===code);
});
test('Invalid v2 server config fails closed instead of silently changing score',()=>{
 const c=config();c.weights.er=NaN;
 assert.throws(()=>computeSocial(data,c),e=>e.code==='TYPE');
 const cyclic={version:2};cyclic.weights=cyclic;
 assert.throws(()=>resolveScoringConfig(cyclic),ValidationError);
});
test('Config validation and scoring never mutate callers or shared defaults',()=>{
 const c=config(),before=structuredClone(c);computeSocial(data,c);assert.deepEqual(c,before);
 const validated=validateScoringConfig(c);validated.weights.er=1;assert.deepEqual(c,before);
 assert.ok(Object.isFrozen(DEFAULT_SCORING.bands[0].er));
});
test('Legacy versions with old-only keys are ignored exactly as in frontend',()=>{
 const old={version:1,oldOnlyField:'ignored'};
 assert.deepEqual(json(computeSocial(data,old)),frontendScore(data,old));
});
test('Malformed partial v2 structures cannot silently fall back to defaults',()=>{
 for(const c of [{version:2,weights:0},{version:2,weights:null},{version:2,bands:[{} , null]},
  {version:2,bands:[{er:5}]},{version:2,levels:{}},{version:2,tiers:{}}]) {
  assert.throws(()=>resolveScoringConfig(c),ValidationError);
 }
});
test('Scoring parity on deterministic combinations of custom configs and legacy inputs',()=>{
 let seed=12345;
 const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<120;i++) {
  const c=config();c.weights={er:1+Math.floor(random()*99),reach:1+Math.floor(random()*99),growth:1+Math.floor(random()*99)};
  for(const b of c.bands)for(const key of ['er','reach','growth']) {
   const scale=0.1+random()*2;b[key]={avg:b[key].avg*scale,good:b[key].good*scale,excellent:b[key].excellent*scale};
  }
  const d={followers:Math.floor(random()*150000),views:Math.floor(random()*1e6),interactions:Math.floor(random()*10000),accountsReached:Math.floor(random()*100000),netFollowers:Math.floor(random()*1000)-100};
  assert.deepEqual(json(computeSocial(d,c)),frontendScore(d,c),`combination ${i}`);
 }
});
