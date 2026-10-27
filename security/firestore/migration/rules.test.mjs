import {before,beforeEach,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertSucceeds,assertFails as firebaseFails} from '@firebase/rules-unit-testing';
import {doc,collection,getDoc,getDocs,query,orderBy,setDoc,updateDoc,deleteDoc} from 'firebase/firestore';
import {submission,defaultScoring,stamp} from '../test/frontend-fixture.mjs';
import {expressionBudgetExceeded} from '../scripts/emulator-diagnostics.mjs';
assert.equal(process.env.EVORA_RULES_PROFILE,'migration');
assert.equal(process.env.EVORA_DIAGNOSTICS_GUARD,'1');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8089');
let env,original;
const db=role=>role==='anonymous'?env.unauthenticatedContext().firestore():env.authenticatedContext(`synthetic-${role}`,role==='unprivileged'?{}:{role}).firestore();
const ref=(role,path='candidature/existing')=>doc(db(role),path);
async function denied(promise){const error=await firebaseFails(promise);assert.ok(!expressionBudgetExceeded(error.message));}
before(async()=>{
 env=await initializeTestEnvironment({projectId:'demo-evora-security',firestore:{host:'127.0.0.1',port:8089,rules:await readFile(new URL('firestore.rules',import.meta.url),'utf8')}});
 original=await submission();
});
beforeEach(async()=>{
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async context=>{
  await setDoc(doc(context.firestore(),'candidature','existing'),original);
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
 test(`${role}: scoring public get, all client scoring writes denied`,async()=>{
  await assertSucceeds(getDoc(ref(role,'settings/scoring')));
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
