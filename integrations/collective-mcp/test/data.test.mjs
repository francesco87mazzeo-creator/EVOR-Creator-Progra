import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReader, MAX_RECENT, DataError} from '../src/reader.mjs';
import {createTools, loadConfiguration} from '../src/tools.mjs';
import {computeScore, DEFAULT_SCORING, scoreDocumentFields} from '../../../server/collective/scoring.mjs';
import scoreLevels from '../../../public/score-levels.js';
import {dataFixture, BASE, PROJECT} from './helpers.mjs';

const profiles=[
 [100,100,20,50,0],[500,10000,500,3000,5],[1000,50000,1000,25000,40],
 [1001,10000,100,4000,-5],[2000,1206,54,250,-1],[5000,30000,600,12000,0],
 [5001,90000,1200,60000,15],[20000,300000,15000,100000,300],
 [20001,70000,500,25000,-300],[100000,500000,5000,150000,1000],
 [100001,3000000,100000,2000000,10000],[1000000,1000000000,100000000,900000000,100000],
 [2000,0,0,0,0],[2000,1,0,0,0],[2000,1000,0,0,0],[2000,1000,100,null,0],
 [null,1000,100,500,null],[2000,null,100,500,0],[2000,1000,null,500,0],
 [2000,'30000','600','250','-1'],[0,0,0,null,0],[2000,1000,100,100,2000],
 [2000,1000,100,500,-100],[2000,1e12,1e12,1e12,-1e12]
];
for(const [index,values] of profiles.entries())test(`mathematical parity with original scoring module: synthetic profile ${index+1}`,async()=>{
 const metrics=Object.fromEntries(['followers','views','interactions','accountsReached','netFollowers'].map((k,i)=>[k,values[i]]));
 const data={...BASE,...metrics,...scoreDocumentFields(computeScore(metrics))};
 const f=dataFixture({applications:{application_b:data}}),tool=createTools(f.reader);
 const result=await tool.get_application_metrics({applicationId:'application_b'}),expected=computeScore(data,DEFAULT_SCORING);
 for(const key of Object.keys(expected))assert.deepEqual(result.recalculated[key],expected[key],key);
 assert.deepEqual(result.metrics,Object.fromEntries(['followers','views','interactions','accountsReached','netFollowers'].map(key=>[key,expected[key]])));
 assert.equal(result.comparison.numericDifference,expected.socialScore===null?null:0);
 assert.equal(result.recalculated.classification?.label??null,scoreLevels.classify(expected.socialScore,scoreLevels.defaults().social)?.label??null);
});
test('saved score and old model remain distinct from current recalculation; no historical rewrite',async()=>{
 const data={...BASE,scoringVersion:2,socialScore:99,erRate:10,reachRate:20,growthRate:-1};const f=dataFixture({applications:{legacy:data}}),tool=createTools(f.reader);
 const before=structuredClone(data),result=await tool.get_application_metrics({applicationId:'legacy'});
 assert.equal(result.saved.socialScore,99);assert.equal(result.saved.version,2);assert.equal(result.recalculated.scoringVersion,3);assert.equal(result.comparison.sameScoringVersion,false);assert.equal(result.comparison.numericDifference,null);assert.deepEqual(f.documents.get('legacy'),before);
});
test('custom numeric configuration changes only recalculation, not saved score; no implicit defaults on invalid v3',async()=>{
 const config={...structuredClone(DEFAULT_SCORING),weights:{engagement:0,visibility:100}};
 const f=dataFixture({settings:{scoring:config}}),result=await createTools(f.reader).get_application_metrics({applicationId:'application_b'});
 assert.equal(result.recalculated.socialScore,computeScore(BASE,config).socialScore);assert.equal(result.saved.socialScore,computeScore(BASE).socialScore);
 assert.equal(result.comparison.submissionConfigUnavailable,true);assert.equal(result.configurationSources.scoring,'stored_document');
 const bad=dataFixture({settings:{scoring:{...config,references:{views:0,engagementRate:0}}}});await assert.rejects(()=>loadConfiguration(bad.reader));
});
test('missing/legacy configuration defaults are explicitly labelled, never claimed to be stored',async()=>{
 const missing=await loadConfiguration(dataFixture({settings:{}}).reader);assert.equal(missing.scoring.source,'default_missing_document');assert.equal(missing.benchmarks.source,'provisional_defaults_missing_document');assert.equal(missing.levels.source,'historical_defaults_missing_document');
 const legacy=await loadConfiguration(dataFixture({settings:{scoring:{version:2,oldField:5}}}).reader);assert.equal(legacy.scoring.source,'default_non_current_version');assert.deepEqual(legacy.scoring.value,DEFAULT_SCORING);
 for(const id of ['instagramBenchmarks','scoreLevels'])await assert.rejects(()=>loadConfiguration(dataFixture({settings:{[id]:{invalid:'PRIVATE'}}}).reader));
});
test('saved custom benchmark and level values are decoded using original shared validators',async()=>{
 const levels=scoreLevels.defaults();levels.social[1].label='Custom label';levels.social[1].color='#123456';
 const benchmarks=scoreLevels.benchmarks.defaults();benchmarks.engagement[2]=[8,15,30];
 const result=await loadConfiguration(dataFixture({settings:{scoring:structuredClone(DEFAULT_SCORING),scoreLevels:levels,instagramBenchmarks:scoreLevels.benchmarks.toDocument(benchmarks)}}).reader);
 assert.deepEqual(result.levels.value,levels);assert.deepEqual(result.benchmarks.value,benchmarks);assert.equal(result.benchmarks.contributesToV2,false);
});
test('provenance distinguishes OCR evidence, changed correction, note-only snapshot and missing evidence',async()=>{
 const f=dataFixture(),tool=createTools(f.reader);
 let result=await tool.get_application_metrics({applicationId:'application_b'});assert.equal(result.provenance.views.source,'matches_latest_staff_correction');assert.equal(result.provenance.accountsReached.source,'matches_ocr_record');assert.equal(result.provenance.accountsReached.ocrRecordedValue,250);assert.equal(result.provenance.followers.source,'no_evidence');
 const data=f.documents.get('application_b');data.insightsCorrection.previousValues.views=data.views;
 result=await tool.get_application_metrics({applicationId:'application_b'});assert.equal(result.provenance.views.source,'matches_ocr_record');assert.equal(result.provenance.views.latestCorrection.changedInThisRecord,false);
 data.accountsReached=null;data.insightsCorrection.previousValues.accountsReached=250;data.insightsCorrection.newValues.accountsReached=null;
 result=await tool.get_application_metrics({applicationId:'application_b'});assert.equal(result.metrics.accountsReached,null);assert.equal(result.provenance.accountsReached.source,'matches_latest_staff_correction');assert.equal(result.limitations.fullHistoryNotRead,true);
});
test('recent query is capped at twenty and ties use document ID descending',async()=>{
 const applications=Object.fromEntries(Array.from({length:25},(_,i)=>['candidate_'+String(i).padStart(2,'0'),{...BASE}]));
 const f=dataFixture({applications});const result=await createTools(f.reader).list_recent_applications({limit:20});
 assert.equal(result.applications.length,MAX_RECENT);assert.equal(result.applications[0].id,'candidate_24');assert.equal(result.applications[19].id,'candidate_05');assert.equal((await f.requests[0].json()).structuredQuery.limit,20);
});
test('out-of-order, duplicate, foreign project and malformed-date backend results fail closed',async()=>{
 const fixture=dataFixture();await fixture.reader.recent(2);const response=await fixture.channel.fetch(fixture.requests[0].clone());const rows=await response.json();
 for(const data of [[...rows].reverse(),[rows[0],rows[0]],rows.map((r,i)=>i? r:{document:{...r.document,name:r.document.name.replace(PROJECT,'foreign-project')}}),rows.map((r,i)=>i?r:{document:{...r.document,fields:{...r.document.fields,date:{stringValue:'not-a-date'}}}})]){
  const reader=createReader({projectId:PROJECT,channel:{fetch:async()=>Response.json(data)}});await assert.rejects(()=>reader.recent(2),DataError);
 }
});
test('fixed paths only; backend errors and unreadable data never become defaults',async()=>{
 const f=dataFixture();await assert.rejects(()=>f.reader.application('../settings/scoring'));await assert.rejects(()=>f.reader.setting('secret'));assert.equal(f.requests.length,0);
 assert.equal(await f.reader.application('missing'),null);
 for(const response of [()=>new Response('PRIVATE_UPSTREAM_DETAIL',{status:503}),()=>new Response('not-json'),()=>Response.json({})]){
  const reader=createReader({projectId:PROJECT,channel:{fetch:async()=>response()}});await assert.rejects(()=>loadConfiguration(reader));
 }
});
test('no original screenshots, identity, note or history fields are requested from Firestore',async()=>{
 const f=dataFixture();await createTools(f.reader).get_application_metrics({applicationId:'application_b'});
 const request=f.requests.find(r=>new URL(r.url).pathname.includes('/candidature/'));const masks=new URL(request.url).searchParams.getAll('mask.fieldPaths');
 for(const field of ['email','fullName','instagram','phone','screenshotData','screenshotData2','profileScreenshotData','insightsHistory','notes','insightsCorrection.note','insightsCorrection.correctedBy'])assert.equal(masks.includes(field),false,field);
});
test('nonfinite historical numeric data fail closed rather than emitting misleading JSON null scores',async()=>{
 const f=dataFixture({applications:{bad:{...BASE,views:'9'.repeat(400)}}});await assert.rejects(()=>createTools(f.reader).get_application_metrics({applicationId:'bad'}),e=>e.code==='UNSUPPORTED_NUMERIC_DATA');
});
test('informational benchmark failure cannot block the independent V2 metrics calculation',async()=>{
 const f=dataFixture({settings:{scoring:structuredClone(DEFAULT_SCORING),instagramBenchmarks:{invalid:'PRIVATE'}}});
 const result=await createTools(f.reader).get_application_metrics({applicationId:'application_b'});assert.equal(result.recalculated.socialScore,computeScore(BASE).socialScore);
 assert.equal(f.requests.some(request=>new URL(request.url).pathname.endsWith('/settings/instagramBenchmarks')),false);
 await assert.rejects(()=>loadConfiguration(f.reader));
});
