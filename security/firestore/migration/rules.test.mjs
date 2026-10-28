import {before,beforeEach,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertSucceeds,assertFails as firebaseFails} from '@firebase/rules-unit-testing';
import {doc,collection,getDoc,getDocs,query,orderBy,setDoc,updateDoc,deleteDoc} from 'firebase/firestore';
import {submission,currentSubmission,defaultScoring,stamp} from '../test/frontend-fixture.mjs';
import {expressionBudgetExceeded} from '../scripts/emulator-diagnostics.mjs';
assert.equal(process.env.EVORA_RULES_PROFILE,'migration');
assert.equal(process.env.EVORA_DIAGNOSTICS_GUARD,'1');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8089');
let env,original,current;
const db=role=>role==='anonymous'?env.unauthenticatedContext().firestore():env.authenticatedContext(`synthetic-${role}`,role==='unprivileged'?{}:{role}).firestore();
const ref=(role,path='candidature/existing')=>doc(db(role),path);
async function denied(promise){const error=await firebaseFails(promise);assert.ok(!expressionBudgetExceeded(error.message));}
before(async()=>{
 env=await initializeTestEnvironment({projectId:'demo-evora-security',firestore:{host:'127.0.0.1',port:8089,rules:await readFile(new URL('firestore.rules',import.meta.url),'utf8')}});
 original=await submission();
 current={...await currentSubmission(),accountsReached:null,reachEngagementRate:null};
});
beforeEach(async()=>{
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async context=>{
  await setDoc(doc(context.firestore(),'candidature','existing'),original);
  await setDoc(doc(context.firestore(),'candidature','schema5'),current);
  await setDoc(doc(context.firestore(),'settings','scoring'),defaultScoring());
 });
});
after(async()=>env?.cleanup());
for(const role of ['anonymous','unprivileged','unknown','viewer','manager','admin']){
 const canRead=['viewer','manager','admin'].includes(role),canEdit=['manager','admin'].includes(role);
 test(`${role}: direct create denied, even with valid frontend payload`,()=>denied(setDoc(ref(role,'candidature/new'),original)));
 test(`${role}: exact read and current list query`,async()=>{
  await (canRead?assertSucceeds:denied)(getDoc(ref(role)));
  await (canRead?assertSucceeds:denied)(getDocs(query(collection(db(role),'candidature'),orderBy('date','desc'))));
 });
 test(`${role}: notes update`,()=> (canEdit?assertSucceeds:denied)(updateDoc(ref(role),{notes:'Synthetic',updatedAt:stamp})));
 test(`${role}: delete`,()=> (role==='admin'?assertSucceeds:denied)(deleteDoc(ref(role))));
 test(`${role}: scoring restricted get, all client scoring writes denied`,async()=>{
  await (canRead?assertSucceeds:denied)(getDoc(ref(role,'settings/scoring')));
  await denied(setDoc(ref(role,'settings/scoring'),defaultScoring()));
  await denied(deleteDoc(ref(role,'settings/scoring')));
 });
 test(`${role}: settings lists and private server data denied`,async()=>{
  await denied(getDocs(collection(db(role),'settings')));
  for(const path of ['settings/config','applicationRequests/secret','collectiveSessions/secret','other/doc']){
   await denied(getDoc(ref(role,path)));await denied(setDoc(ref(role,path),{private:true}));
  }
 });
}
for(const role of ['manager','admin']){
 test(`${role}: every current management operation including full Insights correction`,async()=>{
  for(const status of ['new','review','shortlist','watchlist','more_info','approved','rejected','archived']) await assertSucceeds(updateDoc(ref(role),{status,updatedAt:stamp}));
  await assertSucceeds(updateDoc(ref(role),{creatorCode:'SYNTHETIC10',updatedAt:stamp}));
  await assertSucceeds(updateDoc(ref(role),{evaluation:{brandFit:5,contentQuality:4,credibility:3,reliability:2,potential:1,strategicValue:0,updatedAt:stamp},updatedAt:stamp}));
  const previousValues=Object.fromEntries(['views','netFollowers','interactions','accountsReached'].map(k=>[k,original[k]]));
  const newValues={views:20,netFollowers:-1,interactions:2,accountsReached:10};
  await assertSucceeds(updateDoc(ref(role),{...newValues,insightsCorrection:{correctedAt:stamp,correctedBy:'staff',previousValues,newValues,note:'Synthetic correction'},socialScore:50,perfLevel:'AVERAGE',erRate:20,reachRate:1,growthRate:-1,updatedAt:stamp}));
 });
 test(`${role}: original answers and malformed management updates denied`,async()=>{
  await denied(updateDoc(ref(role),{email:'changed@example.test',updatedAt:stamp}));
  await denied(updateDoc(ref(role),{status:'unknown',updatedAt:stamp}));
  await denied(updateDoc(ref(role),{evaluation:{brandFit:6,updatedAt:stamp},updatedAt:stamp}));
 });
}

/* ---------- Scoring v2: correzioni a cinque valori, storico e campi del nuovo punteggio ---------- */
const KEYS=['followers','views','netFollowers','interactions','accountsReached'];
const values=d=>Object.fromEntries(KEYS.map(k=>[k,d[k]===undefined?null:d[k]]));
const v2Fields={scoringVersion:3,socialScore:41,engagementRate:4.52,engagementScore:69,visibilityScore:45,reachEngagementRate:null,lowBase:false};
const fix=(previous,next,note='Synthetic v2 correction')=>({correctedAt:stamp,correctedBy:'staff',previousValues:previous,newValues:next,note});
// Patch prodotto dall'editor Admin: valori, correzione, storico e punteggio ricalcolato.
const v2Patch=(doc,next,history=null)=>{
 const c=fix(values(doc),next);
 const prior=Array.isArray(doc.insightsHistory)?doc.insightsHistory:(doc.insightsCorrection?[doc.insightsCorrection]:[]);
 return {...next,insightsCorrection:c,insightsHistory:history||[...prior,c],...v2Fields,updatedAt:stamp};
};
const NEXT={followers:9000,views:30000,netFollowers:-3,interactions:600,accountsReached:null};
for(const role of ['manager','admin']){
 test(`${role}: v2 correction with five values, history and new score fields on a legacy (schema 4) document`,async()=>{
  await assertSucceeds(updateDoc(ref(role),v2Patch(original,NEXT)));
  const saved=(await getDoc(ref(role))).data();
  assert.equal(saved.accountsReached,null);assert.equal(saved.insightsHistory.length,1);assert.equal(saved.status,original.status);
  assert.equal(saved.perfLevel,original.perfLevel,'i campi del modello precedente restano come salvati');
 });
 test(`${role}: v2 correction on a schema 5 document, accounts reached added later and history appended`,async()=>{
  const first=v2Patch(current,{...NEXT,accountsReached:12000});
  await assertSucceeds(updateDoc(ref(role,'candidature/schema5'),first));
  const after=(await getDoc(ref(role,'candidature/schema5'))).data();
  await assertSucceeds(updateDoc(ref(role,'candidature/schema5'),v2Patch(after,{...NEXT,accountsReached:null,views:31000})));
  const saved=(await getDoc(ref(role,'candidature/schema5'))).data();
  assert.equal(saved.insightsHistory.length,2);assert.deepEqual(saved.insightsHistory[0],first.insightsCorrection);
 });
 test(`${role}: a previous single correction is carried into the history, never dropped`,async()=>{
  // Correzione a quattro valori del pannello precedente, ancora ammessa durante il rilascio.
  const old=fix(Object.fromEntries(['views','netFollowers','interactions','accountsReached'].map(k=>[k,original[k]])),{views:20,netFollowers:-1,interactions:2,accountsReached:10});
  await assertSucceeds(updateDoc(ref(role),{...old.newValues,insightsCorrection:old,updatedAt:stamp}));
  const withOld=(await getDoc(ref(role))).data();
  const p=v2Patch(withOld,NEXT);
  await denied(updateDoc(ref(role),{...p,insightsHistory:[p.insightsCorrection]}));
  await assertSucceeds(updateDoc(ref(role),p));
  assert.deepEqual((await getDoc(ref(role))).data().insightsHistory,[old,p.insightsCorrection]);
 });
 test(`${role}: followers, accounts reached and new score fields can be corrected; values are validated`,async()=>{
  await assertSucceeds(updateDoc(ref(role),{followers:0,updatedAt:stamp}));
  await assertSucceeds(updateDoc(ref(role),{accountsReached:null,updatedAt:stamp}));
  await assertSucceeds(updateDoc(ref(role),{...v2Fields,updatedAt:stamp}));
  // Zero visualizzazioni: punteggio e coinvolgimento non disponibili, zero salvato come dato.
  await assertSucceeds(updateDoc(ref(role),{views:0,socialScore:null,engagementRate:null,engagementScore:null,visibilityScore:0,updatedAt:stamp}));
  for(const bad of [{followers:-1},{followers:1.5},{followers:null},{accountsReached:-1},{accountsReached:'10'},{views:null},
   {scoringVersion:2},{socialScore:101},{socialScore:'50'},{engagementScore:101},{visibilityScore:-1},{engagementRate:-1},
   {reachEngagementRate:'x'},{lowBase:'yes'},{decision:'approved'}])
   await denied(updateDoc(ref(role),{...bad,updatedAt:stamp}));
 });
 test(`${role}: malformed or inconsistent v2 corrections are denied`,async()=>{
  const p=v2Patch(original,NEXT);
  const variants=[
   ['newValues differ from saved values',{...p,views:31000}],
   ['required value missing after correction',{...p,views:null,insightsCorrection:{...p.insightsCorrection,newValues:{...NEXT,views:null}},insightsHistory:[{...p.insightsCorrection,newValues:{...NEXT,views:null}}]}],
   ['followers not saved with the correction',{...p,followers:original.followers}],
   ['extra key in values',{...p,insightsCorrection:{...p.insightsCorrection,newValues:{...NEXT,extra:1}}}],
   ['author not staff',{...p,insightsCorrection:{...p.insightsCorrection,correctedBy:'admin'},insightsHistory:[{...p.insightsCorrection,correctedBy:'admin'}]}],
   ['history not ending with the correction',{...p,insightsHistory:[fix(values(original),{...NEXT,views:1})]}],
   ['history without a correction change',{insightsHistory:[fix(values(original),NEXT)],updatedAt:stamp}],
   ['history not a list',{...p,insightsHistory:{0:p.insightsCorrection}}],
   ['note too long',{...p,insightsCorrection:{...p.insightsCorrection,note:'x'.repeat(2001)},insightsHistory:[{...p.insightsCorrection,note:'x'.repeat(2001)}]}]
  ];
  for(const [,patch] of variants) await denied(updateDoc(ref(role),patch));
 });
 test(`${role}: history is append-only and limited to 50 entries`,async()=>{
  const p1=v2Patch(original,NEXT);await assertSucceeds(updateDoc(ref(role),p1));
  const after=(await getDoc(ref(role))).data();
  const p2=v2Patch(after,{...NEXT,views:30500});
  await denied(updateDoc(ref(role),{...p2,insightsHistory:[{...p1.insightsCorrection,note:'rewritten'},p2.insightsCorrection]}));
  await denied(updateDoc(ref(role),{...p2,insightsHistory:[p2.insightsCorrection]}));
  await denied(updateDoc(ref(role),{...p2,insightsHistory:[p1.insightsCorrection,p1.insightsCorrection,p2.insightsCorrection]}));
  await assertSucceeds(updateDoc(ref(role),p2));
  const full=Array(49).fill(p1.insightsCorrection);
  await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'candidature','existing'),{insightsHistory:[...full,p2.insightsCorrection]}));
  const at50=(await getDoc(ref(role))).data();
  await denied(updateDoc(ref(role),v2Patch(at50,{...NEXT,views:40000})));
 });
}
test('viewer: v2 correction denied',async()=>denied(updateDoc(ref('viewer'),v2Patch(original,NEXT))));
