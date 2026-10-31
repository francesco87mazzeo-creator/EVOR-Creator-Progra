import {test}from'node:test';
import assert from'node:assert/strict';
import vm from'node:vm';
import fs from'node:fs';
import {createHash,webcrypto}from'node:crypto';
const source=fs.readFileSync(new URL('../../public/hub-sso-client.js',import.meta.url),'utf8');
const WORKER='https://worker.example.test';
const b64=s=>Buffer.from(s).toString('base64url');
const opaque=c=>b64(Buffer.alloc(32,c));
function fixture({search='',hash='',saved=null,user='old-admin',hub=false,responses={}}={}){
 const calls=[],store=new Map(saved?[['evora_hub_sso',JSON.stringify(saved)]]:[]);const listeners={};
 let current=user?{uid:user,getIdTokenResult:async()=>({claims:hub?{role:'manager',evoraHub:true}:{role:'admin'}}),getIdToken:async()=>'fake-old'}:null;
 const auth={get currentUser(){return current;},onAuthStateChanged(cb){queueMicrotask(()=>cb(current));return()=>{};},async signOut(){calls.push('signOut');current=null;},async setPersistence(){},
  async signInWithCustomToken(value){assert.equal(value,'fake-custom-token');calls.push('signIn');current={uid:'hub-new-manager-0001',getIdTokenResult:async()=>({claims:{evoraHub:true}}),getIdToken:async()=>'fake-manager'};}};
 const location={search,hash,pathname:'/admin/',assigned:null,assign(u){this.assigned=u;calls.push('assign');}};
 const sandbox={auth,environment:{workerBase:WORKER},firebase:{auth:{Auth:{Persistence:{LOCAL:'local'}}}},location,crypto:webcrypto,btoa,TextEncoder,URL,URLSearchParams,
  history:{replaceState(_s,_t,url){calls.push('scrub');assert.equal(url,'/admin/');location.search='';location.hash='';}},
  addEventListener(name,fn){listeners[name]=fn;},setInterval(){},localStorage:{removeItem(){}},
  sessionStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
  async fetch(url,options){const name=url.slice((WORKER+'/hub-sso/').length);assert.ok(url.startsWith(WORKER+'/hub-sso/'));assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');
   calls.push(name+(name==='exchange'?':'+JSON.parse(options.body).verifier:''));const r=responses[name]??200;if(r==='network')throw new TypeError('offline');
   return {ok:r===200,status:r,json:async()=>name==='exchange'?{customToken:'fake-custom-token'}:{user:{uid:current?.uid,role:'manager'}}};}};
 vm.runInNewContext(source,sandbox);return {api:sandbox.CollectiveHub,calls,auth,store,location,listeners};
}
const settled=(p,ms=50)=>Promise.race([p.then(()=>'resolved',()=>'rejected'),new Promise(r=>setTimeout(()=>r('pending'),ms))]);
test('legacy identity remains compatible and makes no HUB network calls',async()=>{const f=fixture();await f.api.ready;assert.deepEqual(f.calls,[]);assert.equal(f.auth.currentUser.uid,'old-admin');});
test('?hub=start stores PKCE only in this tab and goes to the HUB without mounting the panel',async()=>{
 const f=fixture({search:'?hub=start'});assert.equal(await settled(f.api.ready),'pending');
 const saved=JSON.parse(f.store.get('evora_hub_sso'));const target=new URL(f.location.assigned);
 assert.equal(target.origin+target.pathname,'https://evora-hub-auth-test.francesco87-mazzeo.workers.dev/authorize');
 assert.equal(target.searchParams.get('client'),'collective-real');assert.equal(target.searchParams.get('state'),saved.state);
 assert.equal(target.searchParams.get('challenge'),createHash('sha256').update(saved.verifier).digest('base64url'));
 assert.ok(!f.location.assigned.includes(saved.verifier),'verifier never leaves the page');});
test('valid return discards the previous identity, exchanges once and verifies the new one',async()=>{
 const saved={state:opaque(1),verifier:opaque(2),at:Date.now()};const f=fixture({hash:'#hub_code='+opaque(3)+'&hub_state='+saved.state,saved});
 await f.api.ready;assert.deepEqual(f.calls,['scrub','signOut','exchange:'+saved.verifier,'signIn','status']);
 assert.equal(f.api.isHub(f.auth.currentUser),true);assert.equal(f.store.has('evora_hub_sso'),false);});
for(const [name,saved,hash]of[
 ['state mismatch',{state:opaque(1),verifier:opaque(2),at:Date.now()},'#hub_code='+opaque(3)+'&hub_state='+opaque(9)],
 ['expired attempt',{state:opaque(1),verifier:opaque(2),at:Date.now()-6*60*1000},'#hub_code='+opaque(3)+'&hub_state='+opaque(1)],
 ['no attempt in this tab',null,'#hub_code='+opaque(3)+'&hub_state='+opaque(1)],
])test('injected or stale return is refused before any exchange: '+name,async()=>{
 const f=fixture({hash,saved});await assert.rejects(f.api.ready);assert.equal(f.calls.some(c=>c.startsWith('exchange')),false);assert.equal(f.auth.currentUser,null);});
test('denied exchange cannot reuse the previous Admin',async()=>{
 const saved={state:opaque(1),verifier:opaque(2),at:Date.now()};const f=fixture({hash:'#hub_code='+opaque(3)+'&hub_state='+saved.state,saved,responses:{exchange:403}});
 await assert.rejects(f.api.ready);assert.equal(f.auth.currentUser,null);assert.equal(f.calls.includes('signIn'),false);});
test('an existing HUB session the HUB denies is closed and the legacy recovery login is shown',async()=>{
 const f=fixture({user:'hub-old-manager-0001',hub:true,responses:{status:403}});await f.api.ready;assert.equal(f.auth.currentUser,null);});
test('periodic check: a network error keeps the session, an explicit denial signs out',async()=>{
 const responses={status:200};const f=fixture({user:'hub-old-manager-0001',hub:true,responses});await f.api.ready;assert.equal(f.api.isHub(f.auth.currentUser),true);
 responses.status='network';await f.listeners.focus();await new Promise(r=>setTimeout(r,10));assert.notEqual(f.auth.currentUser,null);
 responses.status=403;await f.listeners.focus();await new Promise(r=>setTimeout(r,10));assert.equal(f.auth.currentUser,null);});
