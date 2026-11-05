import{test}from'node:test';import assert from'node:assert/strict';
import{dataFixture,BASE}from'./helpers.mjs';
import{createTools}from'../src/tools.mjs';
import{createAiTools}from'../src/ai-tools.mjs';
import{createProposals}from'../src/ai-channel.mjs';
import{EVALUATION_FIELDS,NOT_FOR_EVALUATION,NEVER_REQUESTED,QUESTIONNAIRE}from'../../../server/collective/mcp-candidate-policy.mjs';
import{RUBRICS,validateEvaluation,RUBRIC_V1_AREAS,bandFor}from'../../../server/collective/mcp-ai-policy.mjs';
const v1=(score=72,extra={})=>({score,summary:'Profilo coerente con il brand, metriche solide ma base ridotta.',rubricVersion:'rubric-v1',
 criteria:RUBRIC_V1_AREAS.map((a,i)=>({name:a.name,score:55+i*5,note:'Analisi motivata sintetica di prova per questa area.'})),
 strengths:['Risposte argomentate'],concerns:['Base di audience ridotta'],potential:'Potenziale per contenuti tecnici sintetici.',roles:['Creator UGC'],limitations:['Link non esaminati'],...extra});

const SECRET='s'.repeat(43),UID='synthetic_founder_0001',APP='synthetic-ind-01';
const principal={uid:UID,role:'admin',version:1,scopes:['collective:read','collective:evaluate']};
// Marker values in every score, judgement and previous AI field: none may reach the evaluation input.
const MARKERS={socialScore:87,engagementScore:91,visibilityScore:93,engagementRate:7.77,reachEngagementRate:8.88,erRate:6.66,reachRate:5.55,growthRate:4.44,
 lowBase:true,scoringVersion:3,status:'approved',notes:'STAFF_NOTE_MARKER',creatorCode:'CREATOR_MARKER',
 evaluation:{brandFit:5,contentQuality:5,credibility:5,reliability:5,potential:5,strategicValue:5,updatedAt:'2026-11-04T09:30:00.000Z'},
 aiEvaluation:{score:55,summary:'PRIOR_AI_SUMMARY_MARKER',rubricVersion:'rubric-test-0',evaluatedBy:'founder',basedOnVersion:'v',proposalId:'p'.repeat(24)},
 aiEvaluationHistory:[{score:44,summary:'OLDER_AI_MARKER'}]};
const doc={...BASE,...MARKERS,fullName:'Sara Fittizia',instagramHandle:'sara.fittizia.sintetica',email:'sara@example.invalid',isAdult:true,profileCategories:['coach'],
 motivation:'Voglio rappresentare un brand serio.',contentPerMonth:'3-4',contentUrl1:'https://www.instagram.com/p/X/',contentUrl2:'ftp://bad',
 followers:2000,views:1206,interactions:54,accountsReached:250,netFollowers:-1,
 ocrProfile:{result:{followers:{value:2000,visibility:'complete'}}},ocrInsights:{merged:{views:1206,interactions:50,accountsReached:null,netFollowers:-1}},
 insightsCorrection:{newValues:{netFollowers:-1}}};
const setup=()=>{const f=dataFixture({applications:{[APP]:doc,'synthetic-ind-02':{...doc}}});const proposals=createProposals({secret:SECRET});
 const state={exists:true,version:'2026-11-05T09:00:00.123456Z',fullName:'Sara Fittizia',instagramHandle:'sara.fittizia.sintetica',current:{score:55,rubricVersion:'rubric-test-0',evaluatedAt:'x',proposalId:'p'.repeat(24)},historyCount:1};
 const ai={state:async()=>state,save:async()=>({status:'saved',historyCount:2})};
 return {...f,proposals,ai:createAiTools({ai,proposals,principal,reader:f.reader}),admin:createTools(f.reader)};};

test('the evaluation projection never requests a score, judgement, status, previous AI evaluation or excluded personal field',()=>{
 for(const field of [...NOT_FOR_EVALUATION,...NEVER_REQUESTED.filter(f=>!['ocrInsights','ocrProfile','insightsCorrection'].includes(f))])
  assert.equal(EVALUATION_FIELDS.some(p=>p===field||p.startsWith(field+'.')),false,field);
 assert.deepEqual(EVALUATION_FIELDS.filter(p=>p.startsWith('ocr')||p.startsWith('insights')),['ocrInsights.merged','ocrProfile.result.followers','insightsCorrection.newValues']);
});
test('dedicated read: no site score, staff evaluation, status or previous AI evaluation reaches the output',async()=>{
 const {ai,requests}=setup(),r=await ai.get_application_for_ai_evaluation({applicationId:APP,rubricVersion:'rubric-v1'});
 // The random signed ticket is excluded from the scan: its characters can match a marker by chance.
 const {inputTicket,ticketExpiresAt,...data}=r;assert.ok(inputTicket&&ticketExpiresAt);
 const text=JSON.stringify(data);
 for(const marker of ['87','91','93','7.77','8.88','6.66','5.55','4.44','STAFF_NOTE_MARKER','CREATOR_MARKER','PRIOR_AI_SUMMARY_MARKER','OLDER_AI_MARKER','approved','sara@example.invalid'])
  assert.equal(text.includes(marker),false,marker);
 for(const key of ['socialScore','engagementScore','visibilityScore','evaluation','aiEvaluation','status','lowBase','scoringVersion','saved','calculatedNow','staffEvaluation'])
  assert.equal(new RegExp('"'+key+'"').test(text),false,key);
 const mask=new URL(requests.at(-1).url).searchParams.getAll('mask.fieldPaths');assert.deepEqual(mask,[...EVALUATION_FIELDS]);
 assert.equal(r.questionnaire.length,QUESTIONNAIRE.length);assert.equal(r.candidate.fullName,'Sara Fittizia');
 assert.ok(r.excludedByServer.includes('valutazioni AI precedenti'));assert.ok(r.instructions.some(i=>/non usare punteggi/.test(i)));
});
test('metrics carry their source: screenshot read, candidate changed, staff correction, candidate entered or missing',async()=>{
 const {ai}=setup(),r=await ai.get_application_for_ai_evaluation({applicationId:APP});
 const source=Object.fromEntries(r.instagram.metrics.map(m=>[m.key,m.source]));
 assert.deepEqual(source,{followers:'screenshot_read',views:'screenshot_read',interactions:'candidate_changed',accountsReached:'candidate_entered',netFollowers:'staff_correction'});
 assert.match(r.instagram.verification,/nessuna verifica indipendente/);
 assert.deepEqual(r.contentLinks.links,[{url:'https://www.instagram.com/p/X/',examinedByServer:false}]);assert.equal(r.contentLinks.unusable,1);
 assert.ok(r.questionnaire.every(q=>q.nature==='dichiarazione del candidato'));
});
test('the administrative detail tool is unchanged and still shows scoring and staff evaluation',async()=>{
 const {admin}=setup(),d=await admin.get_application_details({applicationId:APP});
 assert.equal(d.status.value,'approved');assert.equal(d.staffEvaluation.present,true);assert.ok('saved' in d.scoring);
});
test('a proposal requires the ticket of the dedicated read, for the same application and rubric',async()=>{
 const {ai,proposals}=setup();
 const evaluation=v1(70);
 await assert.rejects(()=>ai.propose_ai_evaluation({applicationId:APP,...evaluation}),{code:'INPUT_TICKET_INVALID'});
 await assert.rejects(()=>ai.get_application_for_ai_evaluation({applicationId:APP,rubricVersion:'rubric-test-0'}),{code:'RUBRIC_NOT_ACTIVE'});
 const read=await ai.get_application_for_ai_evaluation({applicationId:APP,rubricVersion:'rubric-v1'});
 await assert.rejects(()=>ai.propose_ai_evaluation({applicationId:'synthetic-ind-02',...evaluation,inputTicket:read.inputTicket}),{code:'INPUT_TICKET_OTHER_APPLICATION'});
 await assert.rejects(()=>proposals.verifyInput(read.inputTicket,{uid:UID,applicationId:APP,rubricVersion:'rubric-test-1'}),{code:'INPUT_TICKET_OTHER_RUBRIC'});
 const proposal=await ai.propose_ai_evaluation({applicationId:APP,...evaluation,inputTicket:read.inputTicket});
 // Typed tokens: a proposal is not an input ticket and an input ticket is not a proposal.
 await assert.rejects(()=>ai.propose_ai_evaluation({applicationId:APP,...evaluation,inputTicket:proposal.proposalToken}),{code:'INPUT_TICKET_INVALID'});
 await assert.rejects(()=>proposals.verify(read.inputTicket,{uid:UID,applicationId:APP,content:validateEvaluation(evaluation)}),{code:'PROPOSAL_INVALID'});
 const expired=createProposals({secret:SECRET,now:()=>Date.now()-31*60_000});
 const old=await expired.issueInput({uid:UID,applicationId:APP,rubricVersion:'rubric-v1'});
 await assert.rejects(()=>ai.propose_ai_evaluation({applicationId:APP,...evaluation,inputTicket:old.ticket}),{code:'INPUT_TICKET_EXPIRED'});
});
test('the proposal says whether a previous AI evaluation exists but never shows its score',async()=>{
 const {ai}=setup(),read=await ai.get_application_for_ai_evaluation({applicationId:APP});
 const p=await ai.propose_ai_evaluation({applicationId:APP,...v1(70),inputTicket:read.inputTicket});
 assert.equal(p.band,'Buono con riserve');
 assert.equal(p.previousEvaluationExists,true);assert.equal(p.previousEvaluationsInHistory,1);
 // Exact keys: no field can carry the previous score (55); the proposal itself is the new content only.
 assert.deepEqual(Object.keys(p).sort(),['applicationId','band','candidate','expiresAt','nextStep','notice','previousEvaluationExists','previousEvaluationsInHistory','proposal','proposalToken','rubric','status']);
 assert.deepEqual(Object.keys(p.candidate).sort(),['fullName','instagramHandle']);assert.deepEqual(Object.keys(p.rubric).sort(),['label','version']);
});
test('rubric-v1: six areas in order with motivated analysis, no fixed weights, all structured fields required',()=>{
 const rubric=RUBRICS['rubric-v1'];assert.equal(rubric.active,true);assert.equal(rubric.areas.length,6);assert.equal('weight' in rubric.areas[0],false);
 // Any overall score is accepted with the same area scores: it is the evaluator's judgement, not a mean.
 for(const score of [10,72,95])assert.equal(validateEvaluation(v1(score)).score,score);
 assert.deepEqual(validateEvaluation(v1(72,{roles:[]})).roles,[]);
 const base=v1();
 for(const [bad,code] of [[{...base,criteria:base.criteria.slice(1)},'CRITERIA_NOT_MATCHING_RUBRIC'],[{...base,criteria:[base.criteria[1],base.criteria[0],...base.criteria.slice(2)]},'CRITERIA_NOT_MATCHING_RUBRIC'],
  [{...base,criteria:base.criteria.map(c=>({name:c.name,score:c.score}))},'AREA_ANALYSIS_REQUIRED'],[{...base,criteria:base.criteria.map(c=>({...c,note:'breve'}))},'AREA_ANALYSIS_REQUIRED'],
  [{...base,roles:undefined},'STRUCTURED_FIELDS_REQUIRED'],[{...base,limitations:undefined},'STRUCTURED_FIELDS_REQUIRED'],[{...base,roles:Array(7).fill('Ruolo ripetuto')},'INVALID_ROLES'],
  [{...base,rubricVersion:'rubric-test-1'},'RUBRIC_NOT_ACTIVE']])
  assert.throws(()=>validateEvaluation(Object.fromEntries(Object.entries(bad).filter(([,v])=>v!==undefined))),{code},code);
});
test('common scale: qualitative bands cover 0-100 without gaps',()=>{
 assert.deepEqual([0,19,20,39,40,59,60,74,75,89,90,100].map(s=>bandFor(s).label),['Non idoneo','Non idoneo','Debole','Debole','Incerto','Incerto','Buono con riserve','Buono con riserve','Molto buono','Molto buono','Eccezionale','Eccezionale']);
 assert.equal(bandFor(null),null);
});
test('the dedicated read presents the six areas, the scale and the independence rules, never weights',async()=>{
 const {ai}=setup(),r=await ai.get_application_for_ai_evaluation({applicationId:APP});
 assert.equal(r.rubric.version,'rubric-v1');assert.equal(r.rubric.areas.length,6);assert.equal(r.rubric.scale.length,6);
 assert.match(r.rubric.weighting,/Nessun peso fisso/);assert.match(r.rubric.scope,/non per una campagna/);
 assert.equal(JSON.stringify(r.rubric).includes('"weight"'),false);
 assert.ok(r.instructions.some(i=>/strumenti amministrativi/.test(i)));assert.ok(r.instructions.some(i=>/non hai esaminato/.test(i)));
});
test('administrative detail lets ChatGPT consult saved AI evaluations of any rubric, unconverted',async()=>{
 const {admin}=setup(),d=await admin.get_application_details({applicationId:APP});
 assert.equal(d.aiEvaluations.current.score,55);assert.equal(d.aiEvaluations.current.rubricVersion,'rubric-test-0');assert.equal(d.aiEvaluations.current.test,true);
 assert.equal(d.aiEvaluations.history.length,1);assert.equal(d.aiEvaluations.history[0].score,44);assert.match(d.aiEvaluations.note,/non vanno usate/);
 assert.equal(d.status.value,'approved');assert.equal(typeof d.scoring.saved.socialScore,'number');
});
