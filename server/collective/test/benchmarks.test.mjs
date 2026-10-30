import {test} from 'node:test';
import assert from 'node:assert/strict';
import levels from '../../../public/score-levels.js';
const B=levels.benchmarks;
test('approved provisional EVORΛ benchmark defaults match all five follower tiers',()=>{
 const c=B.validateConfig(B.defaults());
 assert.deepEqual(c.followers,[1000,5000,20000,100000,500000]);
 assert.deepEqual(c.engagement,[[12,24,45],[9,18,34],[7,14,26],[5,10,20],[4,8,16]]);
 assert.deepEqual(c.reach,[[60,120,250],[40,80,160],[30,60,120],[20,40,80],[15,30,60]]);
 assert.deepEqual(c.growth,[[.5,1.5,3.5],[.45,1.3,3],[.35,1.1,2.7],[.25,.9,2.2],[.2,.7,1.8]]);
});
for(const metric of B.metrics){
 test(`${metric}: exact anchors, constant tails, continuous ordered convex curve`,()=>{
  const c=B.defaults();c.followers.forEach((f,i)=>assert.deepEqual(B.thresholds(c,metric,f),c[metric][i]));
  assert.deepEqual(B.thresholds(c,metric,0),c[metric][0]);assert.deepEqual(B.thresholds(c,metric,1e9),c[metric][4]);
  for(let i=0;i<4;i++)for(let k=0;k<=100;k++){
   const f=c.followers[i]*Math.pow(c.followers[i+1]/c.followers[i],k/100),r=B.thresholds(c,metric,f);
   assert.ok(r[0]<r[1]&&r[1]<r[2]);r.forEach((v,j)=>assert.ok(v>=Math.min(c[metric][i][j],c[metric][i+1][j])-1e-9&&v<=Math.max(c[metric][i][j],c[metric][i+1][j])+1e-9));
  }
  c.followers.slice(1,-1).forEach(f=>B.thresholds(c,metric,f-1e-4).forEach((v,j)=>assert.ok(Math.abs(v-B.thresholds(c,metric,f+1e-4)[j])<1e-7*Math.max(1,Math.abs(v)))));
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

test('Firestore storage uses named maps, never nested arrays; strict round-trip retains thresholds',()=>{
 const c=B.edit(B.defaults(),'growth',3,0,.2,true),stored=B.toDocument(c);
 assert.equal(stored.storageFormat,'named-thresholds-v1');assert.deepEqual(stored.reach[0],{medium:60,good:120,excellent:250});
 const inspect=v=>{if(Array.isArray(v)){assert.equal(v.some(Array.isArray),false,'Firestore nested arrays unsupported');v.forEach(inspect);}else if(v&&typeof v==='object')Object.values(v).forEach(inspect);};inspect(stored);
 assert.deepEqual(B.fromDocument(JSON.parse(JSON.stringify(stored))),c);
 assert.throws(()=>B.fromDocument(c));assert.throws(()=>B.fromDocument({...stored,storageFormat:'unknown'}));
 const bad=structuredClone(stored);bad.reach[0].hidden=1;assert.throws(()=>B.fromDocument(bad));
});

test('v2 cubics retain nonzero, continuous tangents at ordinary interior nodes',()=>{
 const c=B.defaults(),eps=1e-6;
 for(const metric of B.metrics)for(const f of c.followers.slice(1,-1)){
  const a=B.thresholds(c,metric,f*Math.exp(-eps)),b=B.thresholds(c,metric,f),d=B.thresholds(c,metric,f*Math.exp(eps));
  b.forEach((v,j)=>{const left=(v-a[j])/eps,right=(d[j]-v)/eps;assert.ok(Math.abs(left-right)<1e-3*Math.max(1,Math.abs(left)));assert.ok(Math.abs(left)>1e-4,'not a forced flat node');});
 }
});
test('ordered cubic controls prevent overshoot/crossings for asymmetric and nonmonotonic edits',()=>{
 let seed=773;const rand=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
 for(let n=0;n<100;n++){
  const c=B.defaults();c.engagement=Array.from({length:5},()=>{const a=rand()*100,b=a+.0001+rand()*100;return[a,b,b+.0001+rand()*100];});
  B.validateConfig(c);
  for(let i=0;i<4;i++)for(let k=0;k<=80;k++){
   const f=c.followers[i]*Math.pow(c.followers[i+1]/c.followers[i],k/80),row=B.thresholds(c,'engagement',f);
   assert.ok(row[0]<row[1]&&row[1]<row[2]);row.forEach((v,j)=>assert.ok(v>=Math.min(c.engagement[i][j],c.engagement[i+1][j])-1e-9&&v<=Math.max(c.engagement[i][j],c.engagement[i+1][j])+1e-9));
  }
 }
});
test('legacy interpolation and persisted custom values remain readable; upgrade is explicit and immutable',()=>{
 const legacy={...B.edit(B.defaults(),'reach',2,0,41,true),interpolation:'log-smoothstep-v1'},snapshot=JSON.stringify(legacy);
 const stored=B.toDocument(legacy);assert.deepEqual(B.fromDocument(stored),legacy);
 const f=10000,t=Math.log(f/5000)/Math.log(20000/5000),w=t*t*(3-2*t);
 assert.deepEqual(B.thresholds(legacy,'reach',f),legacy.reach[1].map((v,j)=>v+(legacy.reach[2][j]-v)*w));
 const upgraded=B.upgrade(legacy);assert.equal(upgraded.interpolation,B.CURRENT_INTERPOLATION);assert.deepEqual(upgraded.reach,legacy.reach);assert.equal(JSON.stringify(legacy),snapshot);
 assert.equal(B.same(upgraded,B.fromDocument(B.toDocument(upgraded))),true);assert.equal(B.same(upgraded,legacy),false);
});
test('display axis preserves exact follower references and brings 20K nearer to 100K',()=>{
 [1000,5000,20000,100000,500000].forEach((f,i)=>assert.equal(B.axisPosition(f),[0,.24,.60,.80,1][i]));
 let previous=-1;for(let i=0;i<=2000;i++){const f=1000*Math.pow(500,i/2000),x=B.axisPosition(f);assert.ok(x>=previous);previous=x;}
 assert.ok(B.axisPosition(100000)-B.axisPosition(20000)<Math.log(100000/20000)/Math.log(500));assert.equal(B.axisPosition(null),null);
 assert.equal(B.fitY([[100,200,900]]),1000);assert.ok(B.fitY([[0,.0001,.0002]])>0);
});
