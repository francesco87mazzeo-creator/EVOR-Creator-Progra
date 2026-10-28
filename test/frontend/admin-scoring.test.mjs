import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {DEFAULT_SCORING} from '../../server/collective/scoring.mjs';
const source=await readFile(new URL('../../public/admin-scoring-client.js',import.meta.url),'utf8');
import {frontendSource as html} from './app-source.mjs';   // pagine e moduli app/ dopo la separazione
const sandbox={AbortController,setTimeout,clearTimeout};vm.createContext(sandbox);vm.runInContext(source,sandbox);
const {saveScoring}=sandbox.CollectiveAdminScoring;
const config=structuredClone(DEFAULT_SCORING),endpoint='https://worker.invalid/admin/scoring';
const user={getIdToken:async(...args)=>{assert.equal(args.length,0);return 'synthetic-id-token';}};
const response=status=>({status,ok:status>=200&&status<300});
const save=(fetchImpl,auth={currentUser:user},cfg=config)=>saveScoring({endpoint,auth,config:cfg,fetchImpl});
test('POST contains full configuration and current Firebase ID token, no Firestore fallback',async()=>{
 const calls=[];await save(async(...args)=>{calls.push(args);return response(200);});
 assert.equal(calls.length,1);const [url,options]=calls[0];assert.equal(url,endpoint);assert.equal(options.method,'POST');
 assert.equal(options.headers.Authorization,'Bearer synthetic-id-token');assert.equal(options.headers['Content-Type'],'application/json');
 assert.deepEqual(JSON.parse(options.body),config);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
});
for(const status of [200,201,204])test(`HTTP ${status} confirms save without assuming a JSON response format`,async()=>{await save(async()=>response(status));});
for(const [status,code] of [[400,'INVALID_CONFIG'],[401,'LOGIN_REQUIRED'],[403,'FORBIDDEN'],[429,'SERVICE_ERROR'],[503,'SERVICE_ERROR']])test(`HTTP ${status} produces the correct save error`,async()=>{
 let calls=0;await assert.rejects(save(async()=>{calls++;return response(status);}),e=>e.code===code&&e.status===status);assert.equal(calls,1);
});
test('No user or empty ID token requires new login and never sends a request',async()=>{
 for(const auth of [{currentUser:null},{currentUser:{getIdToken:async()=>''}}]) {
  let calls=0;await assert.rejects(save(async()=>{calls++;return response(200);},auth),e=>e.code==='LOGIN_REQUIRED');assert.equal(calls,0);
 }
});
test('Expired SDK session requires login, transient token network failure remains retryable',async()=>{
 for(const [code,expected] of [['auth/user-token-expired','LOGIN_REQUIRED'],['auth/network-request-failed','NETWORK']]) {
  let calls=0;await assert.rejects(save(async()=>{calls++;return response(200);},{currentUser:{getIdToken:async()=>{throw{code};}}}),e=>e.code===expected);assert.equal(calls,0);
 }
});
test('A changed Firebase user during token retrieval cannot send a stale token',async()=>{
 const auth={currentUser:null};auth.currentUser={getIdToken:async()=>{auth.currentUser={};return 'synthetic';}};
 await assert.rejects(save(async()=>{throw Error('must not send');},auth),e=>e.code==='LOGIN_REQUIRED');
});
test('Network error is not success, leaks no token and performs no automatic retry',async()=>{
 let calls=0;await assert.rejects(save(async()=>{calls++;throw Error('synthetic-id-token');}),e=>e.code==='NETWORK'&&!e.message.includes('synthetic-id-token'));assert.equal(calls,1);
});
test('Timeout is a controlled unconfirmed save',async()=>{
 await assert.rejects(saveScoring({endpoint,auth:{currentUser:user},config,timeoutMs:5,fetchImpl:async(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted'))))}),e=>e.code==='TIMEOUT');
});
test('Malformed serialization fails before token retrieval',async()=>{
 const cyclic={};cyclic.self=cyclic;let tokens=0;
 await assert.rejects(save(async()=>response(200),{currentUser:{getIdToken:async()=>{tokens++;return 'synthetic';}}},cyclic),e=>e.code==='INVALID_CONFIG');assert.equal(tokens,0);
});
test('Panel wrapper uses Worker; only public get remains for settings/scoring',()=>{
 assert.ok(!/collection\("settings"\)\.doc\("scoring"\)\.(?:set|update|delete)\(/.test(html));
 assert.match(html,/async saveScoring\(cfg\)\{\s*await CollectiveAdminScoring\.saveScoring\(\{endpoint:ADMIN_SCORING_URL,auth,config:cfg\}\)/);
 assert.match(html,/collection\("settings"\)\.doc\("scoring"\)\.get\(/);
 assert.match(html,/const ADMIN_SCORING_URL = WORKER_BASE \+ "\/admin\/scoring"/);
});
