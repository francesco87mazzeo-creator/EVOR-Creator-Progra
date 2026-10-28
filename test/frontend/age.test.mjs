// Execute the real React handlers without JSX rendering. Tests deliberately invoke
// final submit directly, bypassing step navigation and native input constraints.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {publicFixture} from '../../server/collective/test/frontend-reference.mjs';
import {frontendSource as html} from './app-source.mjs';   // pagine e moduli app/ dopo la separazione
const client=await readFile(new URL('../../public/applications-client.js',import.meta.url),'utf8');
function fragment(a,b){const start=html.indexOf(a),end=html.indexOf(b,start);assert.ok(start>=0&&end>start);return html.slice(start,end);}
const validators=fragment('  const validate = (s) => {','  const next = () =>');
const submit=fragment('  const submit = async () => {','  /* ---------- SCHERMATA DI CONFERMA');
const steps=fragment('const STEPS =','const LIMITS =');
const utility=fragment('const isEmail  =','const cleanHandle =');
const fixture=await publicFixture();
async function run(age,testMode,{isAdult=true}={}){
 const state={calls:0,done:false,errors:{},step:6,message:''};
 const sandbox={URL,TextEncoder,AbortController,setTimeout,clearTimeout,
  crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},
  fetch:async()=>{state.calls++;return{ok:true,status:201,json:async()=>({ok:true,id:'synthetic-id'})};},
  testMode,form:{...fixture,age,isAdult},saving:false,submissionRef:{current:null},APPLICATIONS_URL:'https://worker.invalid/applications',
  window:{scrollTo(){}},scrollTop(){},setErrors:v=>{state.errors=v;},setStep:v=>{state.step=v;},
  setSaveErr:v=>{state.message=v;},setDone:v=>{state.done=v;},setSaving:v=>{sandbox.saving=v;}};
 vm.createContext(sandbox);vm.runInContext(client,sandbox);
 await vm.runInContext(`${steps}\n${utility}\n${validators}\n${submit}\nsubmit();`,sandbox);
 return state;
}
for(const mode of [false,true]){
 for(const age of [14,17,17.5,'17','',null,NaN,100])test(`Final submit rejects age ${String(age)} with testMode=${mode}`,async()=>{
  const state=await run(age,mode);assert.equal(state.calls,0);assert.equal(state.done,false);assert.equal(state.step,0);assert.ok(state.errors.age);
 });
 test(`Final submit requires adulthood declaration with testMode=${mode}`,async()=>{
  const state=await run(18,mode,{isAdult:false});assert.equal(state.calls,0);assert.equal(state.done,false);assert.ok(state.errors.isAdult);
 });
 for(const age of [18,99])test(`Final submit accepts boundary ${age} with testMode=${mode}`,async()=>{
  const state=await run(age,mode);assert.equal(state.done,true);assert.equal(state.calls,mode?0:1);
 });
}
