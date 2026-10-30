import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../app/admin.jsx',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function candidateRowVisibility('),source.indexOf('function CandidateScoreRing('));
test('row visibility shares one observer, invokes only visible targets once and releases all targets',()=>{
 const instances=[];
 class IO{constructor(callback,options){this.callback=callback;this.targets=new Set();instances.push(this);assert.equal(options.threshold,.15);}observe(el){this.targets.add(el);}unobserve(el){this.targets.delete(el);}disconnect(){this.targets.clear();}}
 const pool=vm.runInNewContext(code+'\ncandidateRowVisibility()',{IntersectionObserver:IO});
 let started=0;const targets=Array.from({length:100},()=>({}));const cleanups=targets.map(target=>pool.observe(target,()=>started++));
 assert.equal(instances.length,1);assert.equal(instances[0].targets.size,100);
 instances[0].callback([{target:targets[0],isIntersecting:false}]);assert.equal(started,0);
 instances[0].callback([{target:targets[0],isIntersecting:true},{target:targets[0],isIntersecting:true}]);assert.equal(started,1);assert.equal(instances[0].targets.size,99);
 cleanups[1]();instances[0].callback([{target:targets[1],isIntersecting:true}]);assert.equal(started,1);
 pool.dispose();assert.equal(instances[0].targets.size,0);instances[0].callback([{target:targets[2],isIntersecting:true}]);assert.equal(started,1);
 pool.observe({},()=>started++);assert.equal(instances.length,2);pool.dispose();cleanups.forEach(stop=>stop());
});
test('without IntersectionObserver row visibility has a safe immediate fallback',()=>{
 const pool=vm.runInNewContext(code+'\ncandidateRowVisibility()');let started=0;pool.observe({},()=>started++)();assert.equal(started,1);pool.dispose();
});
