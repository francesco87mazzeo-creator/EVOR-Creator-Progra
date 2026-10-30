import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import levels from '../../public/score-levels.js';
const context={AbortController,setTimeout,clearTimeout};vm.createContext(context);
vm.runInContext(readFileSync(new URL('../../public/admin-scoring-client.js',import.meta.url),'utf8'),context);
const {saveScoreLevels}=context.CollectiveAdminScoring;
const endpoint='https://worker.invalid/admin/score-levels',config=levels.defaults();
const auth={currentUser:{getIdToken:async()=> 'synthetic-id-token'}};
test('Levels transport uses its own endpoint, no credentials/cross-document fallback',async()=>{
 const calls=[];await saveScoreLevels({endpoint,config,auth,fetchImpl:async(url,opts)=>{calls.push([url,opts]);return{ok:true};}});
 assert.equal(calls.length,1);const [url,opts]=calls[0];assert.equal(url,endpoint);assert.equal(opts.method,'POST');
 assert.equal(opts.headers.Authorization,'Bearer synthetic-id-token');assert.deepEqual(JSON.parse(opts.body),config);
 assert.equal(opts.credentials,'omit');assert.equal(opts.redirect,'error');
 await assert.rejects(saveScoreLevels({endpoint:'https://worker.invalid/admin/scoring',config,auth}),/Invalid admin scoring endpoint/);
});
for(const [status,code]of [[400,'INVALID_CONFIG'],[401,'LOGIN_REQUIRED'],[403,'FORBIDDEN'],[429,'SERVICE_ERROR'],[503,'SERVICE_ERROR']]){
 test(`Levels transport handles HTTP ${status} without success`,async()=>{
  await assert.rejects(saveScoreLevels({endpoint,config,auth,fetchImpl:async()=>({status,ok:false})}),e=>e.code===code);
 });
}
test('Levels transport: missing session and token failure prevent every POST',async()=>{
 let posts=0;
 for(const auth of [{currentUser:null},{currentUser:{getIdToken:async()=>{throw Error('expired');}}}])
  await assert.rejects(saveScoreLevels({endpoint,config,auth,fetchImpl:async()=>{posts++;}}),e=>e.code==='LOGIN_REQUIRED');
 assert.equal(posts,0);
});
test('Levels transport: network failure and timeout are not success and do not retry',async()=>{
 let posts=0;
 await assert.rejects(saveScoreLevels({endpoint,config,auth,fetchImpl:async()=>{posts++;throw Error('offline');}}),e=>e.code==='NETWORK');
 await assert.rejects(saveScoreLevels({endpoint,config,auth,timeoutMs:5,fetchImpl:async(url,{signal})=>{
  posts++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))));
 }}),e=>e.code==='TIMEOUT');
 assert.equal(posts,2);
});

for(const status of [200,400,401,403,429,503])test(`Benchmarks transport HTTP ${status} is isolated and authenticated`,async()=>{
 const sent=[];const promise=context.CollectiveAdminScoring.saveBenchmarks({endpoint:'https://worker.invalid/admin/benchmarks',config:levels.benchmarks.defaults(),auth,fetchImpl:async(url,opts)=>{sent.push({url,opts});return{ok:status===200,status};}});
 if(status===200)await promise;else await assert.rejects(promise);
 assert.equal(sent.length,1);assert.equal(sent[0].opts.headers.Authorization,'Bearer synthetic-id-token');assert.equal(sent[0].url,'https://worker.invalid/admin/benchmarks');
});
