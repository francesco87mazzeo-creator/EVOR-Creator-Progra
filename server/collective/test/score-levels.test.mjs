import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import levels from '../../../public/score-levels.js';
import {computeScore} from '../scoring.mjs';

test('Historical defaults: separate total and metric thresholds, independent copies',()=>{
  const a=levels.defaults(),b=levels.defaults();
  assert.deepEqual(a.social.map(x=>x.min),[0,35,55,75]);
  assert.deepEqual(a.metrics.map(x=>x.min),[0,25,50,75]);
  a.social[0].label='Changed';assert.notEqual(a.social[0].label,b.social[0].label);
});
for(const [value,social,metric] of [[0,'low','poor'],[24.999,'low','poor'],[25,'low','average'],[34.999,'low','average'],
  [35,'average','average'],[49.999,'average','average'],[50,'average','good'],[54.999,'average','good'],
  [55,'good','good'],[74.999,'good','good'],[75,'high','excellent'],[100,'high','excellent']]){
  test(`Classification has exactly one level at ${value}`,()=>{
    assert.equal(levels.classify(value,levels.DEFAULT_CONFIG.social).id,social);
    assert.equal(levels.classify(value,levels.DEFAULT_CONFIG.metrics).id,metric);
  });
}
for(const value of [null,undefined,'0','50',NaN,Infinity,-1,100.1])test(`Invalid/missing ${String(value)} is unclassified, never clamped or converted to zero`,()=>{
  assert.equal(levels.classify(value,levels.DEFAULT_CONFIG.social),null);
});
const invalid=[
 ['gap',c=>c.social[1].min=36,'GAP'],['overlap',c=>c.social[1].min=34,'OVERLAP'],
 ['start',c=>c.social[0].min=1,'COVERAGE'],['end',c=>c.social.at(-1).max=99,'COVERAGE'],
 ['empty group',c=>c.social=[],'LEVEL_COUNT'],['too many',c=>c.social=Array(21).fill(c.social[0]),'LEVEL_COUNT'],
 ['reversed',c=>c.social[0].max=0,'EMPTY_INTERVAL'],['negative',c=>c.social[0].min=-1,'BOUNDARY'],
 ['decimal',c=>c.metrics[1].min=25.5,'BOUNDARY'],['string boundary',c=>c.metrics[1].min='25','BOUNDARY'],
 ['infinity',c=>c.social[0].max=Infinity,'BOUNDARY'],['null boundary',c=>c.social[0].min=null,'BOUNDARY'],
 ['color injection',c=>c.social[0].color='url(https://example.test)','COLOR'],['short hex',c=>c.social[0].color='#fff','COLOR'],
 ['empty label',c=>c.social[0].label='   ','LABEL'],['long label',c=>c.social[0].label='a'.repeat(81),'LABEL'],
 ['control',c=>c.social[0].label='a\nb','LABEL'],['duplicate id',c=>c.social[1].id=c.social[0].id,'ID'],
 ['unknown level field',c=>c.social[0].html='x','UNKNOWN_FIELD'],['unknown config',c=>c.weights={},'UNKNOWN_FIELD'],
 ['version',c=>c.version=2,'VERSION'],['missing metrics',c=>delete c.metrics,'MISSING_FIELD']
];
for(const [name,mutate,code]of invalid)test(`Strict levels validation rejects ${name}`,()=>{
  const c=levels.defaults();mutate(c);assert.throws(()=>levels.validateConfig(c),e=>e.code===code);
});
test('Variable group lengths, sorted canonical form, complete coverage for every real score',()=>{
  for(let count=1;count<=100;count++){
    const group=Array.from({length:count},(_,i)=>({id:'l'+i,label:'Level '+i,color:'#123abc',min:Math.floor(i*100/count),max:Math.floor((i+1)*100/count)}));
    const cfg=levels.validateConfig({version:1,maxLevels:{social:count,metrics:count},social:[...group].reverse(),metrics:group});
    assert.equal(cfg.social[0].min,0);assert.equal(cfg.social[0].color,'#123ABC');
    for(let score=0;score<=100;score+=.25)assert.ok(levels.classify(score,cfg.social));
  }
});
test('Old documents without limits retain default 20; limits are independent and canonical',()=>{
  const old=levels.defaults();delete old.maxLevels;
  assert.deepEqual(levels.validateConfig(old).maxLevels,{social:20,metrics:20});
  const cfg=levels.defaults();cfg.maxLevels={social:100,metrics:4};
  assert.deepEqual(levels.validateConfig(cfg).maxLevels,{social:100,metrics:4});
});
for(const value of [0,101,1.5,'20',null,Infinity])test(`Configured limit ${String(value)} is rejected`,()=>{
  const cfg=levels.defaults();cfg.maxLevels.social=value;
  assert.throws(()=>levels.validateConfig(cfg),e=>e.code==='MAX_LEVELS');
});
test('Lowering the configured limit below the existing count fails without truncating data',()=>{
  const cfg=levels.defaults();cfg.maxLevels.social=3;
  assert.throws(()=>levels.validateConfig(cfg),e=>e.code==='LEVEL_COUNT');assert.equal(cfg.social.length,4);
});
test('Browser and Worker use the exact same implementation',()=>{
  const context={};vm.createContext(context);vm.runInContext(readFileSync(new URL('../../../public/score-levels.js',import.meta.url),'utf8'),context);
  const cfg=levels.defaults();cfg.social[1].label='Custom';context.json=JSON.stringify(cfg);
  const browser=JSON.parse(vm.runInContext('JSON.stringify(CollectiveScoreLevels.validateConfig(JSON.parse(json)))',context));
  assert.deepEqual(browser,levels.validateConfig(cfg));
  for(const score of [0,25,35,55,75,100]){
    context.value=score;
    assert.equal(vm.runInContext('CollectiveScoreLevels.classify(value,JSON.parse(json).social).id',context),levels.classify(score,cfg.social).id);
  }
});
test('Prototype keys, accessors and symbol fields are rejected without evaluating getters',()=>{
  assert.throws(()=>levels.validateConfig(JSON.parse('{"version":1,"social":[],"metrics":[],"__proto__":{}}')),e=>e.code==='UNKNOWN_FIELD');
  const c=levels.defaults();Object.defineProperty(c,'social',{enumerable:true,get(){throw Error('Getter evaluated');}});
  assert.throws(()=>levels.validateConfig(c),e=>e.code==='UNKNOWN_FIELD');
});
test('Custom classifications never modify numeric scoring or historical data',()=>{
  const legacy={followers:8500,views:24800,interactions:1120,netFollowers:260,accountsReached:null,socialScore:81,scoringVersion:2};
  const original=JSON.stringify(legacy),before=computeScore(legacy);
  const cfg=levels.defaults();cfg.social=[{id:'one',label:'Custom',color:'#123456',min:0,max:100}];
  levels.classify(before.socialScore,levels.validateConfig(cfg).social);
  assert.deepEqual(computeScore(legacy),before);assert.equal(JSON.stringify(legacy),original);
});
