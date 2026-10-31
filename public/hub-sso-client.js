/* Admin only. EVORΛ HUB single sign-on for the GitHub Pages admin, without new routes on this domain.
 * PKCE: state and verifier live only in this tab's sessionStorage; the one-time HUB code comes back
 * in the URL fragment (never sent to servers or in Referer) and is redeemed by the COLLECTIVE Worker,
 * which mints the evora-athletes token. Firebase SDK manages persistence; no manual token storage.
 */
(function(root){
 'use strict';
 const HUB='https://evora-hub-auth-test.francesco87-mazzeo.workers.dev';
 const KEY='evora_hub_sso';
 const MAX_AGE_MS=5*60*1000;
 let hubUid=null;
 const b64url=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const random=()=>b64url(crypto.getRandomValues(new Uint8Array(32)));
 const opaque=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
 class Denied extends Error{}
 const initial=new Promise(resolve=>{const stop=auth.onAuthStateChanged(u=>{stop();resolve(u);});});
 async function call(path,user,payload){
  const headers={'Content-Type':'application/json'};
  if(user)headers.Authorization='Bearer '+await user.getIdToken();
  const r=await fetch(environment.workerBase+'/hub-sso/'+path,{method:'POST',mode:'cors',credentials:'omit',headers,body:JSON.stringify(payload||{}),cache:'no-store',referrerPolicy:'no-referrer'});
  if(r.status===401||r.status===403)throw new Denied('Accesso HUB negato.');
  if(!r.ok)throw new Error('Accesso HUB non verificabile.');return r.json();
 }
 async function verify(user){
  const d=await call('status',user);
  if(auth.currentUser!==user||!d.user||d.user.uid!==user.uid||!['admin','manager'].includes(d.user.role))throw new Denied('Identità HUB non coerente.');
  hubUid=user.uid;return d.user;
 }
 async function localCleanup(){
  hubUid=null;localStorage.removeItem('evora_login_at');sessionStorage.removeItem('evora_last_role');
  // Auth observer immediately unmounts old Admin panels and their local data.
  await auth.signOut();
 }
 async function start(){
  const state=random(),verifier=random();
  const challenge=b64url(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
  sessionStorage.setItem(KEY,JSON.stringify({state,verifier,at:Date.now()}));
  const target=new URL('/authorize',HUB);
  target.search=new URLSearchParams({client:'collective-real',state,challenge}).toString();
  location.assign(target.href);
  return new Promise(()=>{}); // navigating away: never mount the panel
 }
 async function complete(fragment){
  // Drop code/state from the address bar and history before anything else.
  history.replaceState(null,'',location.pathname);
  let saved=null;try{saved=JSON.parse(sessionStorage.getItem(KEY)||'null');}catch{saved=null;}
  sessionStorage.removeItem(KEY);
  const code=fragment.get('hub_code'),state=fragment.get('hub_state');
  if(!saved||!opaque(code)||!opaque(saved.verifier)||state!==saved.state||!(Date.now()-saved.at<MAX_AGE_MS))throw new Error('Collegamento HUB non valido o scaduto.');
  await localCleanup();
  const d=await call('exchange',null,{code,verifier:saved.verifier});
  if(typeof d.customToken!=='string')throw new Error('Risposta HUB non valida.');
  await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
  await auth.signInWithCustomToken(d.customToken);await verify(auth.currentUser);
 }
 const ready=initial.then(async user=>{
  const query=new URLSearchParams(location.search),fragment=new URLSearchParams(location.hash.slice(1));
  if(query.get('hub')==='start'){history.replaceState(null,'',location.pathname);return start();}
  if(fragment.has('hub_code')){try{await complete(fragment);return;}catch{await localCleanup();throw new Error('Accesso HUB non completato.');}}
  // A HUB session that cannot be confirmed is closed; the panel then shows the legacy recovery login.
  if(user){try{const t=await user.getIdTokenResult();if(t.claims.evoraHub===true)await verify(user);}catch{await localCleanup();}}
 });
 // Explicit HUB denial signs out; a network error never extends anything and is retried later.
 const check=async()=>{if(!hubUid||!auth.currentUser)return;try{await verify(auth.currentUser);}catch(e){if(e instanceof Denied)await localCleanup();}};
 root.addEventListener('focus',()=>{void check();});root.addEventListener('pageshow',()=>{void check();});setInterval(()=>{void check();},60000);
 root.CollectiveHub=Object.freeze({ready,verify,isHub(user){return !!user&&hubUid===user.uid;},start,async logout(user){try{await call('logout',user);}finally{await localCleanup();}}});
})(globalThis);
