/* Admin only. Firebase SDK manages persistent credentials; no manual token storage.
 * Requires the future same-origin /admin/hub-sso/* Worker route. No config changes here.
 */
(function(root){
 'use strict';
 const api='/admin/hub-sso/';
 let hubUid=null;
 const initial=new Promise(resolve=>{const stop=auth.onAuthStateChanged(u=>{stop();resolve(u);});});
 async function call(path,user){
  const headers={'Content-Type':'application/json'};
  if(user)headers.Authorization='Bearer '+await user.getIdToken();
  const r=await fetch(api+path,{method:'POST',credentials:'same-origin',headers,body:'{}',cache:'no-store'});
  if(!r.ok)throw new Error('Accesso HUB non verificabile.');return r.json();
 }
 async function verify(user){
  const d=await call('status',user);
  if(auth.currentUser!==user||d.user.uid!==user.uid||!['admin','manager'].includes(d.user.role))throw new Error('Identità HUB non coerente.');
  hubUid=user.uid;return d.user;
 }
 async function localCleanup(){
  hubUid=null;localStorage.removeItem('evora_login_at');sessionStorage.removeItem('evora_last_role');
  // Auth observer immediately unmounts old Admin panels and their local data.
  await auth.signOut();
 }
 const ready=initial.then(async user=>{
  const q=new URLSearchParams(location.search);
  if(q.get('sso')==='ready'){
   history.replaceState(null,'',location.pathname);await localCleanup();
   try{const d=await call('complete');if(typeof d.customToken!=='string')throw new Error('Risposta HUB non valida.');
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    await auth.signInWithCustomToken(d.customToken);await verify(auth.currentUser);return;
   }catch{await localCleanup();throw new Error('Accesso HUB non completato.');}
  }
  if(user){const t=await user.getIdTokenResult();if(t.claims.evoraHub===true){try{await verify(user);}catch{await localCleanup();throw new Error('Sessione HUB non disponibile.');}}}
 });
 const check=async()=>{if(!hubUid||!auth.currentUser)return;try{await verify(auth.currentUser);}catch{await localCleanup();}};
 root.addEventListener('focus',()=>{void check();});root.addEventListener('pageshow',()=>{void check();});setInterval(()=>{void check();},60000);
 root.CollectiveHub=Object.freeze({ready,verify,isHub(user){return !!user&&hubUid===user.uid;},start(){location.assign(api+'start');},async logout(user){try{await call('logout',user);}finally{await localCleanup();}}});
})(globalThis);
