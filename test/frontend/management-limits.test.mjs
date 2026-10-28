// Test actual UI save handlers, including bypass of native maxlength constraints.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {computeScore,scoreDocumentFields,DEFAULT_SCORING} from '../../server/collective/scoring.mjs';
import {frontendSource as html} from './app-source.mjs';   // pagine e moduli app/ dopo la separazione
const limits=html.match(/const MANAGEMENT_LIMITS = Object\.freeze\(\{[^\n]+\}\);/)[0];
function section(start,end){const a=html.indexOf(start),b=html.indexOf(end,a);assert.ok(a>=0&&b>a);return html.slice(a,b);}
const detail=section('function CandidateDetail(','const SCORING_FIELDS');
const handlers=detail.slice(detail.indexOf('  const flash ='),detail.indexOf('  const rated ='));
// Funzioni pure dell'editor (campi, convalida, storico) e gestore di salvataggio reale.
const helpers=section('const INSIGHT_FIELDS = [','function InsightsEditor(');
const editor=section('function InsightsEditor(','function ScorePart(');
const correction=editor.slice(editor.indexOf('  const save = async () => {'),editor.indexOf('\n  return (',editor.indexOf('  const save = async () => {')));
const APP={id:'synthetic',followers:100,views:1,netFollowers:0,interactions:1,accountsReached:1};
const VALS={followers:'100',views:'10',netFollowers:'-1',interactions:'2',accountsReached:'10'};
async function run(name,values={}){
 const state={writes:[],message:'',error:false,fieldErrors:{}};
 const app=values.app||APP;
 const sandbox={notes:'',code:'',note:'',evalv:{},vals:VALS,app,scoring:DEFAULT_SCORING,computeScore,scoreDocumentFields,
  fmtDateTime:String,fmtInt:String,fmtMaybe:String,
  ...values,onPatch:async(id,patch)=>{state.writes.push({id,patch:JSON.parse(JSON.stringify(patch))});},
  setMsg:value=>{state.message=value;},setMsgError:value=>{state.error=value;},setBusy(){},setEditing(){},setNote(){},
  setFieldErr:value=>{state.fieldErrors=value;},setTimeout:()=>0};
 vm.createContext(sandbox);
 const code=name==='correction'?`${helpers}\nconst history = insightsHistoryOf(app);\n${correction}\nsave();`:`${handlers}\n${name}();`;
 await vm.runInContext(`${limits}\n${code}`,sandbox);
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
test('Trimming and correction values remain unchanged for valid values',async()=>{
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
 assert.match(rules,/h\.size\(\) <= 50/);assert.match(helpers,/MAX_INSIGHTS_HISTORY = 50;/);
});

/* ---------- Correzione dei dati Insights: valori, storico e ricalcolo ---------- */
test('Correction writes all five values, previous values, history entry and recalculated v2 score',async()=>{
 const {writes:[w]}=await run('correction');
 const p=w.patch;
 assert.deepEqual({followers:p.followers,views:p.views,netFollowers:p.netFollowers,interactions:p.interactions,accountsReached:p.accountsReached},
  {followers:100,views:10,netFollowers:-1,interactions:2,accountsReached:10});
 assert.deepEqual(p.insightsCorrection.previousValues,{followers:100,views:1,netFollowers:0,interactions:1,accountsReached:1});
 assert.deepEqual(p.insightsCorrection.newValues,{followers:100,views:10,netFollowers:-1,interactions:2,accountsReached:10});
 assert.equal(p.insightsCorrection.correctedBy,'staff');
 assert.deepEqual(p.insightsHistory,[p.insightsCorrection]);
 const expected=scoreDocumentFields(computeScore({...APP,followers:100,views:10,netFollowers:-1,interactions:2,accountsReached:10}));
 for(const [k,v] of Object.entries(expected)) assert.deepEqual(p[k],v,k);
 for(const key of ['perfLevel','erRate','reachRate','growthRate','bandLabel','status']) assert.ok(!(key in p),key);
});
test('Empty required values block the save instead of becoming zero',async()=>{
 for(const key of ['followers','views','interactions','netFollowers']) {
  const state=await run('correction',{vals:{...VALS,[key]:'  '}});
  assert.equal(state.writes.length,0,key);assert.equal(state.fieldErrors[key],'Dato obbligatorio',key);
 }
});
test('Invalid numbers are rejected; zero and negative net followers are accepted',async()=>{
 for(const [key,value] of [['views','12.5'],['views','-3'],['followers','1e3'],['interactions','abc'],['netFollowers','1,5'],['accountsReached','-1'],['views','9999999999999']]) {
  const state=await run('correction',{vals:{...VALS,[key]:value}});
  assert.equal(state.writes.length,0,`${key}=${value}`);assert.ok(state.fieldErrors[key],`${key}=${value}`);
 }
 const zero=await run('correction',{vals:{...VALS,views:'0',interactions:'0',netFollowers:'0'}});
 assert.equal(zero.writes[0].patch.views,0);assert.equal(zero.writes[0].patch.netFollowers,0);
 assert.equal(zero.writes[0].patch.socialScore,null,'zero views: not available, not zero');assert.equal(zero.writes[0].patch.lowBase,true);
 assert.equal((await run('correction',{vals:{...VALS,netFollowers:'+7'}})).writes[0].patch.netFollowers,7);
});
test('Accounts reached may be cleared: stored as null, never replaced by views',async()=>{
 const {writes:[w]}=await run('correction',{vals:{...VALS,accountsReached:''}});
 assert.equal(w.patch.accountsReached,null);assert.equal(w.patch.insightsCorrection.newValues.accountsReached,null);
 assert.equal(w.patch.reachEngagementRate,null);
 const legacy=await run('correction',{app:{id:'legacy',followers:100,views:5000,interactions:50,netFollowers:3}});
 assert.equal(legacy.writes[0].patch.insightsCorrection.previousValues.accountsReached,null,'nessun riempimento con le visualizzazioni');
});
test('History is append-only and carries over a legacy single correction',async()=>{
 const old={correctedAt:'2026-01-01T00:00:00.000Z',correctedBy:'staff',previousValues:{views:1,netFollowers:0,interactions:1,accountsReached:1},newValues:{views:1,netFollowers:0,interactions:1,accountsReached:1},note:'old'};
 const carried=await run('correction',{app:{...APP,insightsCorrection:old}});
 assert.deepEqual(carried.writes[0].patch.insightsHistory,[old,carried.writes[0].patch.insightsCorrection]);
 const second={...old,note:'second'};
 const appended=await run('correction',{app:{...APP,insightsCorrection:second,insightsHistory:[old,second]}});
 assert.deepEqual(appended.writes[0].patch.insightsHistory.slice(0,2),[old,second]);
 assert.equal(appended.writes[0].patch.insightsHistory.length,3);
 const full=await run('correction',{app:{...APP,insightsCorrection:second,insightsHistory:Array(50).fill(second)}});
 assert.equal(full.writes.length,0);assert.ok(full.message.includes('50'));
});
test('Unchanged values are saved only with a note, as before',async()=>{
 const same={followers:'100',views:'1',netFollowers:'0',interactions:'1',accountsReached:'1'};
 const state=await run('correction',{vals:same,note:'  '});
 assert.equal(state.writes.length,0);assert.equal(state.message,'Nessun valore modificato.');
 const noted=await run('correction',{vals:same,note:'Verificato sullo screenshot'});
 assert.equal(noted.writes.length,1);assert.deepEqual(noted.writes[0].patch.insightsCorrection.newValues,noted.writes[0].patch.insightsCorrection.previousValues);
});
test('Value origin distinguishes OCR, candidate edits, manual entry and staff corrections',()=>{
 const sandbox={fmtDateTime:v=>'T'+v,fmtInt:String,fmtMaybe:String};vm.createContext(sandbox);
 vm.runInContext(`${helpers}\nglobalThis.valueOrigin=valueOrigin;`,sandbox);
 const ocr={merged:{views:100,netFollowers:2,interactions:5,accountsReached:null}};
 const app={views:100,interactions:6,netFollowers:2,accountsReached:null,followers:900,ocrInsights:ocr,ocrProfile:{result:{followers:{value:900,visibility:'complete'}}}};
 assert.equal(sandbox.valueOrigin(app,'views'),'Lettura automatica dello screenshot');
 assert.equal(sandbox.valueOrigin(app,'followers'),'Lettura automatica dello screenshot');
 assert.match(sandbox.valueOrigin(app,'interactions'),/^Modificato dal candidato · lettura automatica: 5$/);
 assert.equal(sandbox.valueOrigin(app,'accountsReached'),'Non indicato');
 assert.equal(sandbox.valueOrigin({...app,ocrInsights:null},'views'),'Inserito dal candidato');
 const c={correctedAt:'X',previousValues:{followers:900,views:100,netFollowers:2,interactions:6,accountsReached:null},newValues:{followers:900,views:120,netFollowers:2,interactions:6,accountsReached:null}};
 assert.equal(sandbox.valueOrigin({...app,views:120,insightsCorrection:c,insightsHistory:[c]},'views'),'Corretto dallo staff · TX');
});
