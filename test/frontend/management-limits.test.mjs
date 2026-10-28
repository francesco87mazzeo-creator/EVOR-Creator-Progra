// Test actual UI save handlers, including bypass of native maxlength constraints.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {computeSocial,DEFAULT_SCORING} from '../../server/collective/scoring.mjs';
import {frontendSource as html} from './app-source.mjs';   // pagine e moduli app/ dopo la separazione
const limits=html.match(/const MANAGEMENT_LIMITS = Object\.freeze\(\{[^\n]+\}\);/)[0];
function section(start,end){const a=html.indexOf(start),b=html.indexOf(end,a);assert.ok(a>=0&&b>a);return html.slice(a,b);}
const detail=section('function CandidateDetail(','const BENCH_LEVELS');
const handlers=detail.slice(detail.indexOf('  const flash ='),detail.indexOf('  const rated ='));
const editor=section('function InsightsEditor(','function CandidateDetail(');
const correction=editor.slice(editor.indexOf('  const save = async () => {'),editor.indexOf('\n  return (',editor.indexOf('  const save = async () => {')));
async function run(name,values={}){
 const state={writes:[],message:'',error:false};
 const sandbox={notes:'',code:'',note:'',evalv:{},vals:{views:'10',netFollowers:'-1',interactions:'2',accountsReached:'10'},
  app:{id:'synthetic',views:1,netFollowers:0,interactions:1,accountsReached:1,followers:100},scoring:DEFAULT_SCORING,computeSocial,
  ...values,onPatch:async(id,patch)=>{state.writes.push({id,patch:JSON.parse(JSON.stringify(patch))});},
  setMsg:value=>{state.message=value;},setMsgError:value=>{state.error=value;},setBusy(){},setEditing(){},setTimeout:()=>0};
 vm.createContext(sandbox);await vm.runInContext(`${limits}\n${name==='correction'?correction:handlers}\n${name==='correction'?'save':name}();`,sandbox);
 return state;
}
for(const [length,allowed] of [[0,true],[10000,true],[10001,false]])test(`Notes length ${length} follows Rules bound`,async()=>{
 const state=await run('saveNotes',{notes:'x'.repeat(length)});assert.equal(state.writes.length,allowed?1:0);
 if(allowed)assert.equal(state.writes[0].patch.notes.length,length);else assert.ok(state.message.includes('10.000')&&state.error);
});
for(const [length,allowed] of [[0,true],[2000,true],[2001,false]])test(`Correction note length ${length} follows Rules bound`,async()=>{
 const state=await run('correction',{note:'x'.repeat(length)});assert.equal(state.writes.length,allowed?1:0);
 if(allowed)assert.equal(state.writes[0].patch.insightsCorrection.note.length,length);else assert.ok(state.message.includes('2.000'));
});
for(const [length,allowed] of [[0,true],[120,true],[121,false]])test(`Creator code length ${length} follows Rules bound`,async()=>{
 const state=await run('saveCode',{code:'a'.repeat(length)});assert.equal(state.writes.length,allowed?1:0);
 if(allowed)assert.equal(state.writes[0].patch.creatorCode,'A'.repeat(length));else assert.ok(state.message.includes('120')&&state.error);
});
test('Uppercase expansion cannot bypass the saved creator code length',async()=>{
 const pass=await run('saveCode',{code:'ß'.repeat(60)}),fail=await run('saveCode',{code:'ß'.repeat(61)});
 assert.equal(pass.writes[0].patch.creatorCode.length,120);assert.equal(fail.writes.length,0);assert.ok(fail.message.includes('120'));
});
test('Trimming and correction scoring remain unchanged for valid values',async()=>{
 assert.equal((await run('saveCode',{code:' abc '})).writes[0].patch.creatorCode,'ABC');
 const result=await run('correction',{note:' synthetic note '});assert.equal(result.writes[0].patch.insightsCorrection.note,'synthetic note');
 assert.equal(result.writes[0].patch.views,10);assert.equal(result.writes[0].patch.netFollowers,-1);
});
test('UI limits match the candidate Rules constants',async()=>{
 const rules=await readFile(new URL('../../security/firestore/migration/firestore.rules',import.meta.url),'utf8');
 const values=vm.runInNewContext(`${limits}\nMANAGEMENT_LIMITS;`);
 assert.equal(values.notes,Number(rules.match(/str\(d\.notes,(\d+)\)/)[1]));
 assert.equal(values.insightsNote,Number(rules.match(/str\(c\.note,(\d+)\)/)[1]));
 assert.equal(values.creatorCode,Number(rules.match(/str\(d\.creatorCode,(\d+)\)/)[1]));
});
