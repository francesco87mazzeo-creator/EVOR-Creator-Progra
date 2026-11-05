import {before,beforeEach,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertSucceeds,assertFails as firebaseFails} from '@firebase/rules-unit-testing';
import {doc,getDoc,getDocs,collection,setDoc,updateDoc,deleteDoc,serverTimestamp,Timestamp} from 'firebase/firestore';
import {submission,stamp} from '../test/frontend-fixture.mjs';
import {expressionBudgetExceeded} from '../scripts/emulator-diagnostics.mjs';
assert.equal(process.env.EVORA_RULES_PROFILE,'migration');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8089');
let env,original;
// The AI writer is a password identity with role aiwriter; the same claims via another provider get nothing.
const writer=(provider='password')=>env.authenticatedContext('synthetic-ai-writer',{role:'aiwriter',firebase:{sign_in_provider:provider}}).firestore();
const staff=role=>env.authenticatedContext('synthetic-'+role,{role}).firestore();
const app=c=>doc(c,'candidature','existing');
// withSecurityRulesDisabled resolves to undefined: read the stored document through a closure.
async function stored(){let data;await env.withSecurityRulesDisabled(async c=>{data=(await getDoc(app(c.firestore()))).data();});return data;}
async function denied(promise){const error=await firebaseFails(promise);assert.ok(!expressionBudgetExceeded(error.message),'expression budget exceeded');}
const evaluation=(extra={})=>({score:67,summary:'Valutazione sintetica di prova con motivazione sufficiente.',rubricVersion:'rubric-v1',
 criteria:[{name:'Allineamento con EVORΛ',score:70,note:'Analisi sintetica motivata.'}],strengths:['Punto di forza sintetico'],concerns:['Criticità sintetica'],
 potential:'Potenziale sintetico per EVORΛ.',roles:['Creator UGC'],limitations:['Link non esaminati'],
 evaluatedAt:serverTimestamp(),evaluatedBy:'founder',basedOnVersion:'2026-11-05T09:00:00.000000Z',proposalId:'p'.repeat(24),...extra});
before(async()=>{
 env=await initializeTestEnvironment({projectId:'demo-evora-security',firestore:{host:'127.0.0.1',port:8089,rules:await readFile(new URL('firestore.rules',import.meta.url),'utf8')}});
 original=await submission();
});
beforeEach(async()=>{await env.clearFirestore();await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'candidature','existing'),original));});
after(async()=>env?.cleanup());

test('aiwriter: saves only a valid rubric-v1 evaluation with server time',()=>assertSucceeds(updateDoc(app(writer()),{aiEvaluation:evaluation()})));
test('aiwriter: re-evaluation must move the previous evaluation to history unchanged',async()=>{
 await assertSucceeds(updateDoc(app(writer()),{aiEvaluation:evaluation()}));
 const previous=(await stored()).aiEvaluation;assert.equal(previous.score,67);
 await denied(updateDoc(app(writer()),{aiEvaluation:evaluation({proposalId:'q'.repeat(24)})}));
 await denied(updateDoc(app(writer()),{aiEvaluation:evaluation({proposalId:'q'.repeat(24)}),aiEvaluationHistory:[]}));
 await denied(updateDoc(app(writer()),{aiEvaluation:evaluation({proposalId:'q'.repeat(24)}),aiEvaluationHistory:[{...previous,score:1}]}));
 await assertSucceeds(updateDoc(app(writer()),{aiEvaluation:evaluation({proposalId:'q'.repeat(24),score:70}),aiEvaluationHistory:[previous]}));
 // The same proposal id twice is refused even with a correct history.
 const second=await stored();assert.equal(second.aiEvaluationHistory.length,1);
 await denied(updateDoc(app(writer()),{aiEvaluation:evaluation({proposalId:'q'.repeat(24)}),aiEvaluationHistory:[...second.aiEvaluationHistory,second.aiEvaluation]}));
});
test('aiwriter: every other field, combination or shape is denied',async()=>{
 for(const change of [{status:'approved'},{socialScore:99},{notes:'x'},{evaluation:{brandFit:5,updatedAt:stamp}},{motivation:'alterata'},{views:1},
  {aiEvaluation:evaluation(),status:'approved'},{aiEvaluation:evaluation(),socialScore:1},
  {aiEvaluation:evaluation({rubricVersion:'rubric-test-0'})},{aiEvaluation:evaluation({rubricVersion:'rubric-test-1'})},{aiEvaluation:evaluation({score:101})},
  {aiEvaluation:evaluation({score:6.5})},{aiEvaluation:evaluation({summary:'breve'})},{aiEvaluation:evaluation({evaluatedBy:'staff'})},
  {aiEvaluation:evaluation({evaluatedAt:Timestamp.fromDate(new Date('2020-01-01T00:00:00Z'))})},{aiEvaluation:evaluation({proposalId:'bad'})},
  {aiEvaluation:evaluation({status:'approved'})},{aiEvaluation:evaluation({roles:Array(7).fill('Ruolo')})},{aiEvaluationHistory:[{score:1}]}])
  await denied(updateDoc(app(writer()),change));
});
test('aiwriter: no read, list, create, delete or settings write',async()=>{
 await denied(getDoc(app(writer())));
 await denied(getDocs(collection(writer(),'candidature')));
 await denied(setDoc(doc(writer(),'candidature','new'),{aiEvaluation:evaluation()}));
 await denied(deleteDoc(app(writer())));
 await denied(setDoc(doc(writer(),'settings','scoring'),{version:3}));
});
test('the same claims through another sign-in provider are denied',async()=>{
 for(const provider of ['custom','anonymous','google.com'])await denied(updateDoc(app(writer(provider)),{aiEvaluation:evaluation()}));
});
test('staff can neither write nor rewrite the AI fields, but keeps its own updates and can read them',async()=>{
 await assertSucceeds(updateDoc(app(writer()),{aiEvaluation:evaluation()}));
 for(const role of ['admin','manager']){
  await denied(updateDoc(app(staff(role)),{aiEvaluation:{score:1}}));
  await denied(updateDoc(app(staff(role)),{aiEvaluationHistory:[]}));
  await assertSucceeds(updateDoc(app(staff(role)),{notes:'Synthetic',updatedAt:stamp}));
 }
 for(const role of ['viewer','manager','admin'])assert.equal((await assertSucceeds(getDoc(app(staff(role))))).data().aiEvaluation.score,67);
});
