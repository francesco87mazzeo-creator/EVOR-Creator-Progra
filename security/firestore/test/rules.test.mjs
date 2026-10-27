import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment, assertSucceeds, assertFails as firebaseAssertFails} from '@firebase/rules-unit-testing';
import {doc,collection,query,orderBy,getDoc,getDocs,setDoc,updateDoc,deleteDoc,deleteField,writeBatch} from 'firebase/firestore';
import {submission,defaultScoring,completeOcr,stamp} from './frontend-fixture.mjs';
import {expressionBudgetExceeded} from '../scripts/emulator-diagnostics.mjs';
async function assertFails(promise) {
 const error=await firebaseAssertFails(promise);
 assert.ok(!expressionBudgetExceeded(error.message), 'Budget exhaustion is not an expected authorization denial');
 return error;
}
let witnessId=0;
async function rejectedCreate(baseline, mutate) {
 const id=++witnessId;
 await assertSucceeds(setDoc(app('anonymous',`witness-${id}`),baseline));
 const invalid=clone(baseline); mutate(invalid);
 await assertFails(setDoc(app('anonymous',`invalid-${id}`),invalid));
 await assertSucceeds(setDoc(app('anonymous',`repaired-${id}`),baseline));
}
async function rejectedScoring(mutate) {
 const baseline=defaultScoring();
 await assertSucceeds(setDoc(settings('admin'),baseline));
 const invalid=clone(baseline);mutate(invalid);
 await assertFails(setDoc(settings('admin'),invalid));
 await assertSucceeds(setDoc(settings('admin'),baseline));
}
// Refuse to run against a remote service even if configuration is inherited.
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8089');
assert.equal(process.env.EVORA_DIAGNOSTICS_GUARD,'1','Use npm test: the emulator log guard is required for conclusive denials');
let env, original;
const db = role => role === 'anonymous' ? env.unauthenticatedContext().firestore() : env.authenticatedContext(`synthetic-${role}`,role==='unprivileged'?{}:{role}).firestore();
const app = (role,id='existing')=>doc(db(role),'candidature',id);
const settings = role=>doc(db(role),'settings','scoring');
const clone = v=>structuredClone(v);
before(async()=>{
 env=await initializeTestEnvironment({projectId:'demo-evora-security',firestore:{host:'127.0.0.1',port:8089,rules:await readFile(new URL('../firestore.rules',import.meta.url),'utf8')}});
 original=await submission();
 // Fail the suite prerequisites rather than reporting false security successes
 // against a payload which can never be written through the real rules.
 const full=await submission(completeOcr());
 const worst=clone(full);
 worst.ocrInsights.conflicts=['views','netFollowers','interactions','accountsReached'].map(key=>({key,valueA:1,valueB:2}));
 for (const [name,data] of [['simple',original],['full-ocr',full],['four-conflicts',worst]]) {
  try { await assertSucceeds(setDoc(app('anonymous',`prerequisite-${name}`),data)); }
  catch(cause) { throw new Error(`Positive prerequisite failed: ${name}. Negative denials are not conclusive.`,{cause}); }
 }
 try { await assertSucceeds(setDoc(settings('admin'),defaultScoring())); }
 catch(cause) { throw new Error('Positive prerequisite failed: admin scoring. Negative denials are not conclusive.',{cause}); }
});
beforeEach(async()=>{
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async c=>{
  await setDoc(doc(c.firestore(),'candidature','existing'),original);
  await setDoc(doc(c.firestore(),'settings','scoring'),defaultScoring());
 });
});
after(async()=>{await env?.cleanup();});

for(const role of ['anonymous','unprivileged','unknown','viewer','manager','admin']) {
 test(`${role}: create actual frontend payload`,async()=>assertSucceeds(setDoc(app(role,'new'),await submission())));
 test(`${role}: read/query/export boundary`,async()=>{
  const check=['viewer','manager','admin'].includes(role)?assertSucceeds:assertFails;
  await check(getDoc(app(role)));
  await check(getDocs(query(collection(db(role),'candidature'),orderBy('date','desc'))));
 });
 test(`${role}: exact public scoring get; settings list/config/other paths denied`,async()=>{
  await assertSucceeds(getDoc(settings(role)));
  await assertFails(getDocs(collection(db(role),'settings')));
  for(const path of ['settings/config','settings/private','other/doc','candidature/existing/private/doc']) {
   await assertFails(getDoc(doc(db(role),path)));
   await assertFails(setDoc(doc(db(role),path),{x:1}));
  }
 });
 test(`${role}: delete boundary`,async()=>{await (role==='admin'?assertSucceeds:assertFails)(deleteDoc(app(role)));});
 test(`${role}: scoring write boundary`,async()=>{await (role==='admin'?assertSucceeds:assertFails)(setDoc(settings(role),defaultScoring()));await assertFails(deleteDoc(settings(role)));});
}
for(const role of ['anonymous','unprivileged','unknown']) {
 test(`${role}: no overwrite/update even with otherwise valid payload`,async()=>{
  await assertFails(setDoc(app(role),await submission()));
  await assertFails(updateDoc(app(role),{notes:'forged',updatedAt:stamp}));
 });
}
for(const role of ['manager','admin']) {
 test(`${role}: current management operations`,async()=>{
  for(const status of ['new','review','shortlist','watchlist','more_info','approved','rejected','archived']) await assertSucceeds(updateDoc(app(role),{status,updatedAt:stamp}));
  await assertSucceeds(updateDoc(app(role),{notes:'Synthetic review',updatedAt:stamp}));
  await assertSucceeds(updateDoc(app(role),{creatorCode:'SYNTHETIC10',updatedAt:stamp}));
  await assertSucceeds(updateDoc(app(role),{evaluation:{brandFit:5,contentQuality:4,credibility:3,reliability:2,potential:1,strategicValue:0,updatedAt:stamp},updatedAt:stamp}));
  const metrics={views:original.views+1,netFollowers:-2,interactions:original.interactions+1,accountsReached:original.accountsReached+1};
  const previousValues=Object.fromEntries(Object.keys(metrics).map(k=>[k,original[k]]));
  await assertSucceeds(updateDoc(app(role),{...metrics,insightsCorrection:{correctedAt:stamp,correctedBy:'staff',previousValues,newValues:metrics,note:'Synthetic correction'},socialScore:55,perfLevel:'GOOD',erRate:2,reachRate:100,growthRate:-0.1,updatedAt:stamp}));
 });
 test(`${role}: immutable original data and unknown fields`,async()=>{
  for(const [key,value] of Object.entries({fullName:'Altered',email:'changed@example.test',privacyConsent:false,ocrInsights:null,role:'admin',date:stamp,followers:1,screenshotData:''})) {
   const v=key==='ocrInsights'?{forged:true}:value;
   await assertFails(updateDoc(app(role),{[key]:v,updatedAt:stamp}));
  }
  await assertFails(updateDoc(app(role),{email:deleteField(),notes:'allowed alone',updatedAt:stamp}));
 });
 test(`${role}: legacy documents remain manageable without migration`,async()=>{
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'candidature','legacy'),{fullName:'Legacy Synthetic',date:stamp,status:'new',views:1,newFollowers:-1,interactions:0}));
  await assertSucceeds(updateDoc(app(role,'legacy'),{notes:'Legacy note',updatedAt:stamp}));
  await assertSucceeds(updateDoc(app(role,'legacy'),{evaluation:{brandFit:3,updatedAt:stamp},updatedAt:stamp}));
 });
}

test('Actual public precheck payload including all OCR structures',async()=>{
 await assertSucceeds(setDoc(app('anonymous','ocr'),await submission(completeOcr())));
 const data=await submission(completeOcr());
 data.ocrInsights.conflicts=['views','netFollowers','interactions','accountsReached'].map(key=>({key,valueA:1,valueB:2}));
 data.ocrInsights.screenshot1.views.visibility='partial';
 data.ocrProfile.result.displayName.value=null;
 await assertSucceeds(setDoc(app('anonymous','conflicts'),data));
});
test('Categories, optional fields, negative net followers, zero metrics',async()=>{
 await assertSucceeds(setDoc(app('anonymous','options'),await submission({profileCategories:['altro'],otherProfileCategory:'Synthetic category',hasBrandCollabs:'no',brandCollabDetails:'',tiktok:'',tiktokFollowers:'',views:'0',netFollowers:'-10',interactions:'0',accountsReached:'0'})));
});
const invalid=[
 ['unknown field',d=>{d.role='admin';}],['missing field',d=>{delete d.extra;}],
 ['status',d=>{d.status='approved';}],['notes',d=>{d.notes='injected';}],['creator code',d=>{d.creatorCode='FORGED';}],['evaluation',d=>{d.evaluation={brandFit:5};}],
 ['minor',d=>{d.age=17;}],['consent',d=>{d.privacyConsent=false;}],['adult',d=>{d.isAdult=false;}],
 ['email type',d=>{d.email={x:1};}],['email format',d=>{d.email='invalid';}],['empty required',d=>{d.motivation='';}],
 ['text length',d=>{d.contentType='x'.repeat(601);}],['link protocol',d=>{d.contentUrl1='javascript:alert(1)';}],
 ['category enum',d=>{d.profileCategories=['invalid'];}],['duplicate category',d=>{d.profileCategories=['coach','coach'];}],
 ['category detail',d=>{d.profileCategories=['altro'];d.otherProfileCategory='';}],['enum',d=>{d.hasRoutine='invalid';}],
 ['collaboration detail',d=>{d.brandCollabDetails='';}],['metric type',d=>{d.views='10';}],['negative metric',d=>{d.views=-1;}],
 ['float count',d=>{d.followers=1.5;}],['date',d=>{d.date='yesterday';}],['schema',d=>{d.schemaVersion=999;}],
 ['score range',d=>{d.socialScore=101;}],['NaN',d=>{d.erRate=NaN;}],['infinity',d=>{d.reachRate=Infinity;}],
 ['screenshot prefix',d=>{d.screenshotData='https://example.test/image';}],
 ['screenshot size',d=>{d.screenshotData='data:image/jpeg;base64,'+'A'.repeat(700000);}],
 ['OCR unknown key',d=>{d.ocrInsights={...completeOcr().ocrInsights,extra:'bad'};}],
 ['OCR nested type',d=>{d.ocrProfile=completeOcr().ocrProfile;d.ocrProfile.result.followers.value={bad:1};}],
 ['OCR conflict',d=>{d.ocrInsights=completeOcr().ocrInsights;d.ocrInsights.conflicts=[{key:'invalid',valueA:1,valueB:2}];}],
 ['OCR oversized list',d=>{d.ocrInsights=completeOcr().ocrInsights;d.ocrInsights.conflicts=Array(5).fill({key:'views',valueA:1,valueB:2});}]
];
for(const [name,mutate] of invalid) test(`Reject public payload: ${name}`,async()=>rejectedCreate(await submission(completeOcr()),mutate));
for(const [name,mutate] of [
 ['unknown key',d=>{d.secret='not allowed';}],['weight zero',d=>{d.weights={er:0,reach:0,growth:0};}],
 ['weight negative',d=>{d.weights.er=-1;}],['weight type',d=>{d.weights.er='45';}],
 ['level order',d=>{d.levels[1].min=90;}],['level key',d=>{d.levels[0].extra=true;}],
 ['threshold order',d=>{d.bands[0].er.good=1;}],['threshold key',d=>{d.bands[0].er.extra=1;}],
 ['band order',d=>{d.bands[1].max=1;}],['last max',d=>{d.bands[4].max=1000000;}],['band count',d=>{d.bands.pop();}]
]) test(`Reject malformed admin scoring: ${name}`,async()=>rejectedScoring(mutate));
for(const [name,patch] of [
 ['unknown status',{status:'bogus'}],['notes type',{notes:{x:1}}],['notes length',{notes:'x'.repeat(10001)}],
 ['rating range',{evaluation:{brandFit:6,updatedAt:stamp}}],['rating field',{evaluation:{secret:1,updatedAt:stamp}}],
 ['deleted status',{status:deleteField()}],['negative count',{interactions:-1}],
 ['correction mismatch',{insightsCorrection:{correctedAt:stamp,correctedBy:'staff',previousValues:{views:1,netFollowers:1,interactions:1,accountsReached:1},newValues:{views:1,netFollowers:1,interactions:1,accountsReached:1},note:''}}]
]) test(`Reject invalid manager update: ${name}`,async()=>assertFails(updateDoc(app('manager'),{...patch,updatedAt:stamp})));
test('Batch with forbidden write fails atomically',async()=>{
 const firestore=db('manager'), batch=writeBatch(firestore);
 batch.update(doc(firestore,'candidature','existing'),{notes:'must not persist',updatedAt:stamp});
 batch.set(doc(firestore,'settings','scoring'),defaultScoring());
 await assertFails(batch.commit());
 assert.equal((await getDoc(app('admin'))).data().notes,'');
});
test('Google identity without server role gets no staff rights',async()=>{
 const firestore=env.authenticatedContext('synthetic-google',{firebase:{sign_in_provider:'google.com'},email:'synthetic@example.test'}).firestore();
 await assertFails(getDoc(doc(firestore,'candidature','existing')));
});
test('Public score is declared data; staff display recomputes it',async()=>{
 const d=clone(original);d.socialScore=100;d.perfLevel='HIGH';
 await assertSucceeds(setDoc(app('anonymous','declared-score'),d));
});

// Check every one of the 71 submitted fields, not only representative samples.
// The map value is deliberately incompatible with each declared scalar/list/map schema.
// For OCR fields it is an invalid map, rather than null (which is supported).
const allFields=Object.keys(await submission());
for(const field of allFields) test(`Reject wrong type/shape for public field: ${field}`,async()=>{
 await rejectedCreate(await submission(completeOcr()),d=>{d[field]={unexpected:'synthetic'};});
});
test('Combined image size rejected below individual image caps',async()=>{
 const d=await submission(completeOcr());
 d.screenshotData='data:image/jpeg;base64,'+'A'.repeat(450000);
 d.screenshotData2='data:image/jpeg;base64,'+'A'.repeat(450000);
 await assertFails(setDoc(app('anonymous','image-budget'),d));
});
test('Maximum bounded OCR conflict list accepted with complete image payload',async()=>{
 const d=await submission(completeOcr());
 d.ocrInsights.conflicts=['views','netFollowers','interactions','accountsReached'].map(key=>({key,valueA:100,valueB:200}));
 await assertSucceeds(setDoc(app('anonymous','max-ocr'),d));
});
test('Admin can create a missing scoring document',async()=>{
 await env.withSecurityRulesDisabled(c=>deleteDoc(doc(c.firestore(),'settings','scoring')));
 await assertSucceeds(setDoc(settings('admin'),defaultScoring()));
});
test('Manager cannot forge admin privilege through a document field',async()=>{
 await assertFails(updateDoc(app('manager'),{role:'admin',updatedAt:stamp}));
 await assertFails(deleteDoc(app('manager')));
});
test('No-op update is compatible when timestamps coincide within the same millisecond',async()=>{
 await assertSucceeds(updateDoc(app('manager'),{status:original.status,updatedAt:original.updatedAt}));
});
test('Missing scoring get stays public for frontend fallback',async()=>{
 await env.withSecurityRulesDisabled(c=>deleteDoc(doc(c.firestore(),'settings','scoring')));
 const result=await assertSucceeds(getDoc(settings('anonymous')));
 assert.equal(result.exists(),false);
});


// Viewer may submit through the same public create-only path as anyone else.
// It never gains management writes, including operations accepted for managers.
for (const [name, patch] of [
 ['status', {status:'approved'}], ['notes', {notes:'Synthetic note'}],
 ['creator code', {creatorCode:'SYNTHETIC'}],
 ['evaluation', {evaluation:{brandFit:5,updatedAt:stamp}}],
 ['insights', {views:1,netFollowers:1,interactions:1,accountsReached:1}],
 ['derived score', {socialScore:100,perfLevel:'HIGH',erRate:1,reachRate:1,growthRate:1}],
 ['original responses', {fullName:'Synthetic replacement'}],
 ['role escalation', {role:'admin'}], ['delete field', {notes:deleteField()}]
]) test(`Viewer cannot update ${name}`,async()=>{
 await assertFails(updateDoc(app('viewer'),{...patch,updatedAt:stamp}));
});
test('Viewer cannot overwrite a candidate through set or merge',async()=>{
 await assertFails(setDoc(app('viewer'),await submission()));
 await assertFails(setDoc(app('viewer'),{notes:'Synthetic overwrite',updatedAt:stamp},{merge:true}));
});
test('Viewer can read legacy and OCR documents without editing them',async()=>{
 await env.withSecurityRulesDisabled(async c=>{
  await setDoc(doc(c.firestore(),'candidature','legacy-viewer'),{fullName:'Synthetic legacy',date:stamp});
  await setDoc(doc(c.firestore(),'candidature','ocr-viewer'),await submission(completeOcr()));
 });
 await assertSucceeds(getDoc(app('viewer','legacy-viewer')));
 await assertSucceeds(getDoc(app('viewer','ocr-viewer')));
 await assertFails(updateDoc(app('viewer','legacy-viewer'),{notes:'Not allowed',updatedAt:stamp}));
});
test('Viewer batch cannot combine public create with a management update',async()=>{
 const firestore=db('viewer'),batch=writeBatch(firestore);
 batch.set(doc(firestore,'candidature','viewer-batch'),await submission());
 batch.update(doc(firestore,'candidature','existing'),{notes:'Not allowed',updatedAt:stamp});
 await assertFails(batch.commit());
 assert.equal((await getDoc(app('admin','viewer-batch'))).exists(),false);
});

// A1 must preserve exact schemas, including a missing+extra key of the same size.
test('Exact cardinality cannot replace one public field with an unknown field',async()=>{
 await rejectedCreate(await submission(completeOcr()),d=>{delete d.extra;d.unexpected='synthetic';});
});
test('Exact cardinality cannot replace an OCR field with an unknown field',async()=>{
 await rejectedCreate(await submission(completeOcr()),d=>{
  delete d.ocrInsights.screenshot1.views.value;
  d.ocrInsights.screenshot1.views.unexpected=24800;
 });
});
test('Exact cardinality cannot replace a scoring field with an unknown field',async()=>{
 await rejectedScoring(d=>{delete d.bands[0].er.good;d.bands[0].er.unexpected=6;});
});
for(const value of [-1,0,NaN,Infinity,-Infinity,'3',null]) {
 test(`Threshold minimum rejects invalid boundary ${String(value)}`,async()=>{
  await rejectedScoring(d=>{d.bands[0].er.avg=value;});
 });
}
for(const value of [-1,0,NaN,Infinity,-Infinity,'10',null,100000000000001]) {
 test(`Threshold maximum rejects invalid boundary ${String(value)}`,async()=>{
  await rejectedScoring(d=>{d.bands[0].er.excellent=value;});
 });
}
test('Threshold upper bound remains inclusive',async()=>{
 const d=defaultScoring();d.bands[0].er={avg:1,good:2,excellent:100000000000000};
 await assertSucceeds(setDoc(settings('admin'),d));
});
test('Increasing band maxima preserve the original inclusive upper bound',async()=>{
 const d=defaultScoring();d.bands[3].max=1000000000000;
 await assertSucceeds(setDoc(settings('admin'),d));
 await assertFails(setDoc(settings('admin'),{...d,bands:d.bands.map((b,i)=>i===3?{...b,max:1000000000001}:b)}));
 await assertSucceeds(setDoc(settings('admin'),d));
});
for(const value of [NaN,Infinity,-Infinity,-1,100.01,'45',null]) {
 test(`Scoring weight retains its original finite numeric range: ${String(value)}`,async()=>{
  await rejectedScoring(d=>{d.weights.er=value;});
 });
}
