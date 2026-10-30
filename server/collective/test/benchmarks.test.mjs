import {test} from 'node:test';
import assert from 'node:assert/strict';
import levels from '../../../public/score-levels.js';
const B=levels.benchmarks;
test('defaults separate observed historical Reach/Growth from experimental Engagement',()=>{
 const c=B.validateConfig(B.defaults());assert.deepEqual(c.reach[0],[60,120,250]);assert.deepEqual(c.growth[4],[.08,.25,.8]);assert.deepEqual(c.engagement[2],[6,12,24]);
});
for(const metric of B.metrics){
 test(`${metric}: exact anchors, constant tails, continuous ordered convex curve`,()=>{
  const c=B.defaults();c.followers.forEach((f,i)=>assert.deepEqual(B.thresholds(c,metric,f),c[metric][i]));
  assert.deepEqual(B.thresholds(c,metric,0),c[metric][0]);assert.deepEqual(B.thresholds(c,metric,1e9),c[metric][4]);
  for(let i=0;i<4;i++)for(let k=0;k<=100;k++){
   const f=c.followers[i]*Math.pow(c.followers[i+1]/c.followers[i],k/100),r=B.thresholds(c,metric,f);
   assert.ok(r[0]<r[1]&&r[1]<r[2]);r.forEach((v,j)=>assert.ok(v>=Math.min(c[metric][i][j],c[metric][i+1][j])-1e-9&&v<=Math.max(c[metric][i][j],c[metric][i+1][j])+1e-9));
  }
  c.followers.slice(1,-1).forEach(f=>B.thresholds(c,metric,f-1e-4).forEach((v,j)=>assert.ok(Math.abs(v-B.thresholds(c,metric,f+1e-4)[j])<1e-6)));
 });
 test(`${metric}: linked editing preserves gaps and only chosen band; single editing isolated`,()=>{
  const c=B.defaults(),r=B.edit(c,metric,2,0,c[metric][2][0]+.5,true);
  assert.deepEqual(r[metric][2],c[metric][2].map(v=>v+.5));assert.deepEqual(r[metric][1],c[metric][1]);
  const single=B.edit(c,metric,2,0,c[metric][2][0]+.01,false);assert.equal(single[metric][2][1],c[metric][2][1]);assert.deepEqual(c,B.defaults());
 });
}
for(const bad of [null,undefined,-1,NaN,Infinity,'2000'])test(`missing/invalid followers ${String(bad)} is not zero`,()=>assert.equal(B.thresholds(B.defaults(),'reach',bad),null));
for(const value of [-1,Infinity,NaN,100001,'2',null])test(`reject invalid threshold ${String(value)}`,()=>assert.throws(()=>B.edit(B.defaults(),'reach',0,0,value,false)));
test('reject crossing, unknown fields, changed anchors, invalid version; serializable roundtrip',()=>{
 const c=B.defaults();assert.throws(()=>B.edit(c,'reach',0,0,120,false));assert.throws(()=>B.edit(c,'reach',0,0,-1,true));
 assert.throws(()=>B.validateConfig({...c,score:100}));assert.throws(()=>B.validateConfig({...c,version:2}));assert.throws(()=>B.validateConfig({...c,followers:[0,1,2,3,4]}));assert.deepEqual(B.validateConfig(JSON.parse(JSON.stringify(c))),c);
});

test('reject sparse and executable arrays without invoking accessors',()=>{
 const sparse=B.defaults();delete sparse.engagement[0][1];assert.throws(()=>B.validateConfig(sparse));
 const c=B.defaults();let invoked=0;Object.defineProperty(c.reach[0],'0',{get(){invoked++;return 60;},enumerable:true});assert.throws(()=>B.validateConfig(c));assert.equal(invoked,0);
});

for(const metric of B.metrics)test(`${metric}: linked edits isolate all five bands and preserve both gaps`,()=>{
 const c=B.defaults();
 for(let band=0;band<5;band++)for(let level=0;level<3;level++)for(const delta of [.01,-.01]){
  const changed=B.edit(c,metric,band,level,c[metric][band][level]+delta,true);
  for(const otherMetric of B.metrics)for(let i=0;i<5;i++){
   if(otherMetric===metric&&i===band){
    changed[metric][i].forEach((v,j)=>assert.ok(Math.abs(v-c[metric][i][j]-delta)<1e-10));
    for(let j=0;j<2;j++)assert.ok(Math.abs((changed[metric][i][j+1]-changed[metric][i][j])-(c[metric][i][j+1]-c[metric][i][j]))<1e-10);
   }else assert.deepEqual(changed[otherMetric][i],c[otherMetric][i]);
  }
 }
});
