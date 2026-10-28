import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {computeScore,scoreDocumentFields,DEFAULT_SCORING,SCORING_VERSION,resolveScoringConfig,validateScoringConfig} from '../scoring.mjs';
import {ValidationError} from '../validation.mjs';
import {frontendScore,frontendScoreFields,frontendDefault,frontendScoringSource,legacyScore,publicFixture} from './frontend-reference.mjs';
import {admin} from '../../../test/frontend/app-source.mjs';
const data=await publicFixture();
const json=value=>JSON.parse(JSON.stringify(value));
const config=()=>structuredClone(DEFAULT_SCORING);
const base={followers:8500,views:30000,interactions:600,netFollowers:12,accountsReached:9000};
const core=src=>src.slice(src.indexOf('/* scoring-core:start'),src.indexOf('/* scoring-core:end */'));

/* ---------- Stesso calcolo nel Worker e nell'Admin ---------- */
test('Scoring core text is identical in server module and Admin',async()=>{
 const server=await readFile(new URL('../scoring.mjs',import.meta.url),'utf8');
 assert.ok(core(server).length>500);
 assert.equal(core(admin),core(server));
});
test('Default configuration matches the Admin constants and the approved model',()=>{
 assert.deepEqual(DEFAULT_SCORING,frontendDefault());
 assert.equal(SCORING_VERSION,3);
 assert.deepEqual(DEFAULT_SCORING.weights,{engagement:65,visibility:35});
 assert.deepEqual(DEFAULT_SCORING.references,{engagementRate:2,views:30000});
});
test('Full output matches the Admin on deterministic combinations of data and configs',()=>{
 let seed=12345;
 const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<200;i++) {
  const c=config();
  c.weights={engagement:Math.floor(random()*101),visibility:1+Math.floor(random()*100)};
  c.references={engagementRate:0.1+random()*10,views:1+Math.floor(random()*1e6)};
  c.lowBase={views:Math.floor(random()*5000),interactions:Math.floor(random()*100)};
  const d={followers:Math.floor(random()*2e6),views:Math.floor(random()*3e6),interactions:Math.floor(random()*1e5),
   netFollowers:Math.floor(random()*2000)-1000,accountsReached:random()<0.3?null:Math.floor(random()*1e6)};
  assert.deepEqual(json(computeScore(d,c)),frontendScore(d,c),`combination ${i}`);
  assert.deepEqual(scoreDocumentFields(computeScore(d,c)),frontendScoreFields(d,c),`fields ${i}`);
 }
});

/* ---------- Formula e normalizzazione continua ---------- */
test('Reference values score 50, zero scores 0, weights 65/35',()=>{
 const s=computeScore(base);
 assert.equal(s.engagementRate,2);assert.equal(s.engagementScore,50);assert.equal(s.visibilityScore,50);assert.equal(s.socialScore,50);
 const onlyViews=computeScore({...base,interactions:0});
 assert.equal(onlyViews.engagementRate,0);assert.equal(onlyViews.engagementScore,0);
 assert.equal(onlyViews.socialScore,Math.round(50*35/100));
 const e=computeScore({...base,interactions:6000,views:30000});   // 20% → 100·20/22
 assert.ok(Math.abs(e.engagementScore-100*20/22)<1e-9);
});
test('Normalization is continuous and increasing, never reaching 100',()=>{
 let previous=-1;
 for(let views=1;views<=1e9;views=Math.ceil(views*1.37)) {
  const v=computeScore({...base,views,interactions:Math.round(views*0.02)}).visibilityScore;
  assert.ok(v>previous && v<100,`views=${views}`);previous=v;
 }
 // Nessun salto vicino al riferimento: due valori adiacenti danno punteggi adiacenti.
 const a=computeScore({...base,views:29999}).visibilityScore,b=computeScore({...base,views:30001}).visibilityScore;
 assert.ok(Math.abs(a-b)<0.01);
});
test('Engagement weighs more than visibility at equal normalized gain',()=>{
 const low=computeScore({...base,views:30000,interactions:600});
 const moreEngagement=computeScore({...base,views:30000,interactions:1800});   // coinvolgimento 6% → 75
 const moreViews=computeScore({...base,views:90000,interactions:1800});        // 2% e visibilità 75
 assert.ok(moreEngagement.socialScore-low.socialScore > moreViews.socialScore-low.socialScore);
});
test('No follower bands: followers do not change the score and there is no discontinuity at old band limits',()=>{
 const ref=computeScore(base).socialScore;
 for(const followers of [0,1,999,1000,1001,4999,5000,5001,19999,20000,20001,99999,100000,100001,1e12])
  assert.equal(computeScore({...base,followers}).socialScore,ref,`followers=${followers}`);
});
test('Indicator B is secondary: shown when available, never in the main score',()=>{
 const s=computeScore(base);
 assert.ok(Math.abs(s.reachEngagementRate-600/9000*100)<1e-12);
 for(const accountsReached of [null,undefined,'',0,1,100,1e12]) {
  const t=computeScore({...base,accountsReached});
  assert.equal(t.socialScore,s.socialScore,`accountsReached=${accountsReached}`);
 }
 assert.equal(computeScore({...base,accountsReached:null}).reachEngagementRate,null);
 assert.equal(computeScore({...base,accountsReached:0}).reachEngagementRate,null,'divisione per zero non definita');
 // Gli account raggiunti non sostituiscono mai le visualizzazioni, né il contrario.
 assert.equal(computeScore({...base,views:null,accountsReached:30000}).available,false);
});
test('Net followers (negative, zero, missing) never change the main score',()=>{
 const ref=computeScore(base).socialScore;
 for(const netFollowers of [-1e12,-1,0,1,1e12,null]) assert.equal(computeScore({...base,netFollowers}).socialScore,ref);
 assert.equal(computeScore({...base,netFollowers:-5}).netFollowers,-5);
 assert.equal(computeScore({...base,netFollowers:0}).netFollowers,0);
});

/* ---------- Valori mancanti, zero e non validi ---------- */
test('Missing or invalid views/interactions make the score unavailable instead of zero',()=>{
 for(const [name,patch,missing] of [
  ['views missing',{views:undefined},['views']],['views null',{views:null},['views']],['views empty',{views:''},['views']],
  ['views text',{views:'—'},['views']],['views negative',{views:-1},['views']],['views NaN',{views:NaN},['views']],
  ['views decimal string',{views:'12.5'},['views']],['interactions missing',{interactions:undefined},['interactions']],
  ['both missing',{views:null,interactions:null},['views','interactions']]
 ]) {
  const s=computeScore({...base,...patch});
  assert.equal(s.available,false,name);assert.equal(s.socialScore,null,name);assert.deepEqual(s.missing,missing,name);
  assert.equal(s.engagementRate,null,name);assert.equal(s.engagementScore,null,name);assert.equal(s.visibilityScore,null,name);
 }
});
test('Zero views is a real observation: engagement undefined, score 0, flagged as low base',()=>{
 const s=computeScore({...base,views:0,interactions:0});
 assert.equal(s.available,true);assert.equal(s.engagementRate,null);assert.equal(s.socialScore,0);
 assert.equal(s.lowBase,true);assert.deepEqual(s.lowBaseReasons,['views','interactions']);
});
test('Historical documents with numeric strings are read; other legacy fields are not substituted',()=>{
 const s=computeScore({followers:'8500',views:'24800',interactions:'1120',newFollowers:'260'});
 assert.equal(s.available,true);assert.equal(s.views,24800);assert.equal(s.interactions,1120);
 assert.equal(s.netFollowers,null,'nuovi follower non equivalgono ai follower netti');
 assert.equal(s.accountsReached,null);assert.equal(s.reachEngagementRate,null);
});

/* ---------- Basi di osservazione ridotte ---------- */
test('Low observation base is flagged without altering the score',()=>{
 const small={...base,views:400,interactions:5};
 const s=computeScore(small);
 assert.equal(s.lowBase,true);assert.deepEqual(s.lowBaseReasons,['views','interactions']);
 const c=config();c.lowBase={views:0,interactions:0};
 const t=computeScore(small,c);
 assert.equal(t.lowBase,false);assert.equal(t.socialScore,s.socialScore,'la segnalazione non cambia il punteggio');
 assert.equal(computeScore({...base,views:1000,interactions:10}).lowBase,false,'soglie escluse');
 assert.deepEqual(computeScore({...base,views:999,interactions:10}).lowBaseReasons,['views']);
});

/* ---------- Ricalcolo e campi salvati ---------- */
test('Stored fields are rounded consistently and never contain the old model fields',()=>{
 const f=scoreDocumentFields(computeScore({...base,views:24800,interactions:1120,accountsReached:18400}));
 assert.deepEqual(Object.keys(f).sort(),['engagementRate','engagementScore','lowBase','reachEngagementRate','scoringVersion','socialScore','visibilityScore']);
 assert.equal(f.engagementRate,4.52);assert.equal(f.reachEngagementRate,6.09);assert.equal(f.scoringVersion,3);
 assert.ok(Number.isInteger(f.engagementScore) && Number.isInteger(f.visibilityScore) && Number.isInteger(f.socialScore));
 assert.equal(scoreDocumentFields(computeScore({...base,accountsReached:null})).reachEngagementRate,null);
});
test('Recalculation with a new configuration changes the score; the same data and config always give the same result',()=>{
 const c=config();c.references.views=10000;
 assert.ok(computeScore(base,c).socialScore>computeScore(base).socialScore);
 assert.deepEqual(computeScore(base,c),computeScore(structuredClone(base),structuredClone(c)));
});
test('Historical applications get a v2 score; the previous model is a different calculation',()=>{
 const v2=computeScore(data),old=legacyScore(data);
 assert.equal(v2.available,true);assert.equal(typeof old.socialScore,'number');
 assert.ok(old.perfLevel!==undefined && v2.perfLevel===undefined,'nessun livello di classificazione nel nuovo modello');
});

/* ---------- Configurazione ---------- */
for(const [name,mutate,code] of [
 ['unknown root',c=>{c.secret='forbidden';},'UNKNOWN_FIELD'],
 ['old bands kept',c=>{c.bands=[];},'UNKNOWN_FIELD'],
 ['old levels kept',c=>{c.levels=[];},'UNKNOWN_FIELD'],
 ['unknown weight',c=>{c.weights.er=1;},'UNKNOWN_FIELD'],
 ['missing weight',c=>{delete c.weights.visibility;},'MISSING_FIELD'],
 ['zero weights',c=>{c.weights={engagement:0,visibility:0};},'RANGE'],
 ['negative weight',c=>{c.weights.engagement=-1;},'RANGE'],['weight above 100',c=>{c.weights.visibility=101;},'RANGE'],
 ['NaN weight',c=>{c.weights.engagement=NaN;},'TYPE'],['Infinity reference',c=>{c.references.views=Infinity;},'TYPE'],
 ['string weight',c=>{c.weights.engagement='65';},'TYPE'],
 ['zero engagement reference',c=>{c.references.engagementRate=0;},'RANGE'],
 ['zero views reference',c=>{c.references.views=0;},'RANGE'],
 ['fraction low base',c=>{c.lowBase.views=1.5;},'TYPE'],['negative low base',c=>{c.lowBase.interactions=-1;},'RANGE'],
 ['version',c=>{c.version=2;},'VERSION']
]) test(`Strict scoring config rejects ${name}`,()=>{
 const c=config();assert.doesNotThrow(()=>validateScoringConfig(c));mutate(c);
 assert.throws(()=>validateScoringConfig(c),e=>e instanceof ValidationError&&e.code===code);
});
test('Previous-model configurations are ignored, never converted into the new model',()=>{
 for(const old of [{version:1,tiers:[]},{version:2,weights:{er:45,reach:35,growth:20},levels:[],bands:[]},{version:2,weights:'x'}]) {
  assert.deepEqual(resolveScoringConfig(old),json(DEFAULT_SCORING));
  assert.deepEqual(json(computeScore(base,old)),json(computeScore(base)));
  assert.deepEqual(json(computeScore(base,old)),frontendScore(base,old));
 }
});
test('Invalid v3 server config fails closed instead of silently changing the score',()=>{
 const c=config();c.weights.engagement=NaN;
 assert.throws(()=>computeScore(data,c),e=>e.code==='TYPE');
 const cyclic={version:3};cyclic.weights=cyclic;
 assert.throws(()=>resolveScoringConfig(cyclic),ValidationError);
 assert.throws(()=>resolveScoringConfig('x'),ValidationError);
 assert.throws(()=>resolveScoringConfig([]),ValidationError);
});
test('Config validation and scoring never mutate callers or shared defaults',()=>{
 const c=config(),before=structuredClone(c);computeScore(data,c);assert.deepEqual(c,before);
 const validated=validateScoringConfig(c);validated.weights.engagement=1;assert.deepEqual(c,before);
 assert.ok(Object.isFrozen(DEFAULT_SCORING.weights));
});
test('Weights not totaling 100 normalize exactly like the Admin',()=>{
 const c=config();c.weights={engagement:13,visibility:7};
 assert.deepEqual(json(computeScore(data,c)),frontendScore(data,c));
 assert.equal(computeScore(base,c).socialScore,50);
});
test('No automatic decision: the result has no status, level or approval field',()=>{
 const s=computeScore(base);
 for(const key of ['status','perfLevel','perfLabel','level','approved','decision','bandLabel']) assert.ok(!(key in s),key);
 assert.ok(!/status\s*:/.test(frontendScoringSource),'lo scoring non scrive stati');
});
