import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {PUBLIC_FIELDS,validatePublicApplication} from '../../server/collective/application.mjs';
import {publicFixture} from '../../server/collective/test/frontend-reference.mjs';
const source=await readFile(new URL('../../public/applications-client.js',import.meta.url),'utf8');
const sandbox={TextEncoder,AbortController,setTimeout,clearTimeout,crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'}};
vm.createContext(sandbox);vm.runInContext(source,sandbox);
const {buildPayload,createSubmissionClient}=sandbox.CollectiveApplications;
const fixture=await publicFixture();
const plain=value=>JSON.parse(JSON.stringify(value));
const response=(status=201,data={ok:true,id:'synthetic-id'},headers={get:()=>null})=>({status,ok:status>=200&&status<300,json:async()=>data,headers});
let id=0;const key=()=>`00000000-0000-4000-8000-${String(++id).padStart(12,'0')}`;
const client=fetchImpl=>createSubmissionClient({endpoint:'https://worker.invalid/applications',fetchImpl,newKey:key});

test('Whitelist is exactly the 54 server public fields, never form-only or admin fields',()=>{
 const d=plain(buildPayload({...fixture,role:'owner',status:'approved',notes:'forged',evaluation:{brandFit:5},date:'fake',socialScore:100,fullNameGuess:'extra'}));
 assert.deepEqual(Object.keys(d).sort(),[...PUBLIC_FIELDS].sort());assert.equal(Object.keys(d).length,54);
 validatePublicApplication(d);
});
test('String form numbers become JSON numbers; negative net and optional TikTok are preserved',()=>{
 const d=plain(buildPayload({...fixture,age:'27',followers:'8500',views:'0',netFollowers:'-12',interactions:'0',accountsReached:'1000',tiktokFollowers:''}));
 for(const k of ['age','followers','views','netFollowers','interactions','accountsReached','tiktokFollowers'])assert.equal(typeof d[k],'number');
 assert.equal(d.netFollowers,-12);assert.equal(d.tiktokFollowers,0);
});
for(const value of ['',null,undefined,'2.5','1e3','0x10','abc',NaN,Infinity,-1,1e12+1])test(`No silent numeric fallback for ${String(value)}`,()=>{
 assert.throws(()=>buildPayload({...fixture,followers:value}),e=>e.code==='INVALID_NUMBER'&&e.field==='followers');
});
for(const age of [14,15,16,17,'17',17.5,'17.5',100,'100',null,'',NaN,Infinity]) test(`Age ${String(age)} cannot prepare or send an application`,async()=>{
 const form={...fixture,age};
 assert.throws(()=>buildPayload(form),e=>e.code==='INVALID_NUMBER'&&e.field==='age'&&e.message.includes('18'));
 let calls=0;await assert.rejects(client(async()=>{calls++;return response();}).send(form),e=>e.field==='age');assert.equal(calls,0);
});
for(const age of [18,'18',99,'99']) test(`Age boundary ${String(age)} agrees with server`,()=>{
 const d=plain(buildPayload({...fixture,age}));assert.equal(d.age,Number(age));validatePublicApplication(d);
});
test('Adulthood declaration is required even when age is 18',async()=>{
 let calls=0;await assert.rejects(client(async()=>{calls++;return response();}).send({...fixture,age:18,isAdult:false}),e=>e.code==='CONSENT_REQUIRED'&&e.field==='isAdult');assert.equal(calls,0);
});

test('HTTP request has idempotency and JSON headers, no credentials or Firebase calls',async()=>{
 const calls=[];const c=client(async(...args)=>{calls.push(args);return response();});
 await c.send(fixture);
 assert.equal(calls.length,1);const [url,options]=calls[0];
 assert.equal(url,'https://worker.invalid/applications');assert.equal(options.method,'POST');
 assert.equal(options.headers['Content-Type'],'application/json');assert.match(options.headers['Idempotency-Key'],/^[A-Za-z0-9-]+$/);
 assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.ok(!options.headers.Authorization);
 assert.equal(Object.keys(JSON.parse(options.body)).length,54);
});
test('Network failure and retry reuse exactly the same key and body',async()=>{
 const calls=[];const c=client(async(...args)=>{calls.push(args);if(calls.length===1)throw Error('offline');return response(200,{ok:true,id:'synthetic-id',duplicate:true});});
 await assert.rejects(c.send(fixture),e=>e.code==='NETWORK'&&e.ambiguous);
 await c.send(fixture);assert.equal(calls[0][1].body,calls[1][1].body);
 assert.equal(calls[0][1].headers['Idempotency-Key'],calls[1][1].headers['Idempotency-Key']);
});
test('Changed payload cannot rotate key after an uncertain result',async()=>{
 let calls=0;const c=client(async()=>{calls++;throw Error('offline');});
 await assert.rejects(c.send(fixture));
 await assert.rejects(c.send({...fixture,extra:'changed'}),e=>e.code==='UNCONFIRMED_CHANGE');assert.equal(calls,1);
});
test('Double click is coalesced into one pending request',async()=>{
 let finish,calls=0;const c=client(()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
 const a=c.send(fixture),b=c.send(fixture);assert.equal(a,b);assert.equal(calls,1);finish(response());await a;
});
test('Definitive validation rejection permits correction with a fresh key',async()=>{
 const calls=[];const c=client(async(...args)=>{calls.push(args);return calls.length===1?response(422,{error:{code:'RANGE',path:'$.age'}}):response();});
 await assert.rejects(c.send(fixture),e=>e.field==='age'&&e.code==='RANGE'&&!e.ambiguous);
 await c.send({...fixture,age:28});assert.notEqual(calls[0][1].headers['Idempotency-Key'],calls[1][1].headers['Idempotency-Key']);
});
for(const status of [409,429,500,503])test(`HTTP ${status} keeps the same key on retry`,async()=>{
 const calls=[];const c=client(async(...args)=>{calls.push(args);return calls.length===1?response(status,{error:{code:'RETRY'}},{get:()=> '5'}):response();});
 await assert.rejects(c.send(fixture),e=>e.status===status&&e.retryAfter===null);
 await c.send(fixture);assert.equal(calls[0][1].headers['Idempotency-Key'],calls[1][1].headers['Idempotency-Key']);
});
test('Unconfirmed success, invalid JSON and arbitrary server text never produce confirmation',async()=>{
 for(const r of [response(200,{ok:false}),response(200,{unexpected:'text'}),{...response(),json:async()=>{throw Error('bad JSON');}}]) {
  const c=client(async()=>r);await assert.rejects(c.send(fixture),e=>e.code==='UNCONFIRMED_RESPONSE');
 }
});
test('Raw backend errors are not echoed to the candidate',async()=>{
 const c=client(async()=>response(500,{error:{message:'secret internal error',path:'$.unknown'}}));
 await assert.rejects(c.send(fixture),e=>!e.message.includes('secret internal error')&&e.field===null);
});
test('Test mode never calls fetch, even with invalid input',async()=>{
 let calls=0;const c=client(async()=>{calls++;throw Error('must not execute');});
 assert.equal((await c.send({}, {testMode:true})).simulated,true);assert.equal(calls,0);
});
test('Timeout remains retryable with the original idempotency key',async()=>{
 const calls=[];
 const c=createSubmissionClient({endpoint:'https://worker.invalid/applications',newKey:key,timeoutMs:5,fetchImpl:async(url,options)=>{
  calls.push(options);if(calls.length>1)return response();
  return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
 }});
 await assert.rejects(c.send(fixture),e=>e.code==='TIMEOUT');await c.send(fixture);
 assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);
});

test('Missing IDs and unmarked HTTP 200 responses are never mistaken for saved applications',async()=>{
 for(const r of [response(201,{ok:true}),response(200,{ok:true,id:'synthetic-id'}),response(200,{ok:true,id:'synthetic-id',duplicate:false})]) {
  await assert.rejects(client(async()=>r).send(fixture),e=>e.code==='UNCONFIRMED_RESPONSE');
 }
});
test('The same payload retains its key after a definitive validation rejection',async()=>{
 const calls=[];const c=client(async(...args)=>{calls.push(args);return calls.length===1?response(400,{error:'INVALID_REQUEST'}):response();});
 await assert.rejects(c.send(fixture));await c.send(fixture);
 assert.equal(calls[0][1].headers['Idempotency-Key'],calls[1][1].headers['Idempotency-Key']);
});
test('Fresh Turnstile token per manual attempt, stable idempotency key and body',async()=>{
 let tokens=0;const calls=[];
 const c=createSubmissionClient({endpoint:'https://worker.invalid/applications',newKey:key,
  getTurnstileToken:async()=>`synthetic-token-${++tokens}`,
  fetchImpl:async(...args)=>{calls.push(args);return calls.length===1?response(503,{error:'UNAVAILABLE'}):response();}});
 await assert.rejects(c.send(fixture));await c.send(fixture);
 assert.equal(tokens,2);assert.notEqual(calls[0][1].headers['X-Turnstile-Token'],calls[1][1].headers['X-Turnstile-Token']);
 assert.equal(calls[0][1].headers['Idempotency-Key'],calls[1][1].headers['Idempotency-Key']);
 assert.equal(calls[0][1].body,calls[1][1].body);assert.equal(Object.keys(JSON.parse(calls[0][1].body)).length,54);
});
test('Keys exceeding the supplied 64-character contract are refused before fetch',async()=>{
 let calls=0;const c=createSubmissionClient({endpoint:'https://worker.invalid/applications',newKey:()=> 'a'.repeat(65),fetchImpl:async()=>{calls++;return response();}});
 await assert.rejects(c.send(fixture),e=>e.code==='KEY_UNAVAILABLE');assert.equal(calls,0);
});
for(const status of [400,403,405,413,415,429,503]) test(`Common string error for HTTP ${status} stays controlled`,async()=>{
 await assert.rejects(client(async()=>response(status,{error:'INTERNAL_STRING'})).send(fixture),e=>e.status===status&&!e.message.includes('INTERNAL_STRING'));
});
test('Validator path without JSON root prefix is mapped to the correct field',async()=>{
 await assert.rejects(client(async()=>response(400,{error:{code:'RANGE',path:'age'}})).send(fixture),e=>e.field==='age');
});

test('Token acquisition timeout never sends a request',async()=>{
 let calls=0;
 const c=createSubmissionClient({endpoint:'https://worker.invalid/applications',newKey:key,timeoutMs:5,
  getTurnstileToken:()=>new Promise(()=>{}),fetchImpl:async()=>{calls++;return response();}});
 await assert.rejects(c.send(fixture),e=>e.code==='TIMEOUT');assert.equal(calls,0);
});
test('A new confirmed application uses a new key',async()=>{
 const calls=[];const c=client(async(...args)=>{calls.push(args);return response();});
 await c.send(fixture);await c.send({...fixture,extra:'New application'});
 assert.notEqual(calls[0][1].headers['Idempotency-Key'],calls[1][1].headers['Idempotency-Key']);
});
