import {test}from'node:test';
import assert from'node:assert/strict';
import vm from'node:vm';
import fs from'node:fs';
const source=fs.readFileSync(new URL('../../public/hub-sso-client.js',import.meta.url),'utf8');
function fixture(ready=false,fail=false){
 const calls=[];let current={uid:'old-admin',getIdTokenResult:async()=>({claims:{role:'admin'}}),getIdToken:async()=>'fake-old'};
 const auth={get currentUser(){return current;},onAuthStateChanged(cb){queueMicrotask(()=>cb(current));return()=>{};},async signOut(){calls.push('signOut');current=null;},async setPersistence(){},async signInWithCustomToken(value){assert.equal(value,'fake-custom-token');calls.push('signIn');current={uid:'new-manager',getIdToken:async()=>'fake-manager'};}};
 const sandbox={auth,firebase:{auth:{Auth:{Persistence:{LOCAL:'local'}}}},location:{search:ready?'?sso=ready':'',pathname:'/admin/',assign(){}},history:{replaceState(){calls.push('scrub');}},URLSearchParams,addEventListener(){},setInterval(){},localStorage:{removeItem(){}},sessionStorage:{removeItem(){}},async fetch(url,options){calls.push(url.endsWith('complete')?'complete':'status');assert.equal(options.cache,'no-store');if(fail)return {ok:false};return {ok:true,json:async()=>url.endsWith('complete')?{customToken:'fake-custom-token'}:{user:{uid:'new-manager',role:'manager'}}};}};
 vm.runInNewContext(source,sandbox);return {api:sandbox.CollectiveHub,calls,auth};
}
test('legacy identity remains compatible and makes no HUB network calls',async()=>{const f=fixture();await f.api.ready;assert.deepEqual(f.calls,[]);assert.equal(f.auth.currentUser.uid,'old-admin');});
test('HUB transfer discards previous Admin before the one-time exchange',async()=>{const f=fixture(true);await f.api.ready;assert.deepEqual(f.calls,['scrub','signOut','complete','signIn','status']);assert.equal(f.auth.currentUser.uid,'new-manager');assert.equal(f.api.isHub(f.auth.currentUser),true);});
test('failed transfer cannot reuse old Admin or silently return to legacy access',async()=>{const f=fixture(true,true);await assert.rejects(f.api.ready);assert.equal(f.auth.currentUser,null);assert.equal(f.calls.includes('signIn'),false);});
