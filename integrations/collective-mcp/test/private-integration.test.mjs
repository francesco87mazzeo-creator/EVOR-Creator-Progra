import {test}from'node:test';
import assert from'node:assert/strict';
import {createPrivateMcpHandler,buildPrivateFirestoreRequest}from'../../../worker/src/mcp-private-read.mjs';
import {createPrivateCollectiveChannel}from'../src/private-channel.mjs';
import {createReader}from'../src/reader.mjs';
import {createTools}from'../src/tools.mjs';
import {dataFixture,FOUNDER,PROJECT}from'./helpers.mjs';

const secret='s'.repeat(43);
test('End-to-end synthetic Founder: private service binding exposes only approved metrics and configuration',async()=>{
 const fixture=dataFixture();let checked=0,reads=0;
 const service=createPrivateMcpHandler({
  secret,founderUid:FOUNDER,
  verifyFounder:async p=>{checked++;return p.uid===FOUNDER&&p.role==='admin'&&p.version===1;},
  readFirestore:async(operation,argument)=>{
   reads++;
   const googleRequest=buildPrivateFirestoreRequest(PROJECT,operation,argument,'a'.repeat(43));
   // Simulated Firestore receives only the projected request, never the binding secret.
   const outgoing=new Request(googleRequest.url,{
    method:googleRequest.method,
    headers:{'content-type':'application/json'},
    ...(googleRequest.method==='POST'?{body:await googleRequest.text()}:{})
   });
   return fixture.channel.fetch(outgoing);
  }
 });
 const binding={fetch:req=>service(req)};
 const channel=createPrivateCollectiveChannel({
  binding,secret,projectId:PROJECT,identity:{uid:FOUNDER,role:'admin',version:1}
 });
 const tools=createTools(createReader({projectId:PROJECT,channel}));
 const list=await tools.list_recent_applications({limit:2});
 assert.equal(list.applications.length,2);
 const detail=await tools.get_application_metrics({applicationId:list.applications[0].id});
 const scoring=await tools.get_scoring_configuration();
 assert.equal(detail.recalculated.scoringVersion,3);
 assert.equal(scoring.scoring.source,'stored_document');
 assert.equal(checked,5); // list + detail + scoring and levels + all three configuration documents
 assert.equal(reads,checked);
 const returned=JSON.stringify({list,detail,scoring});
 for(const privateValue of ['PRIVATE_NAME_SHOULD_NOT_LEAK','private@example.invalid','PRIVATE_NOTES_SHOULD_NOT_LEAK',
   'PRIVATE_SCREENSHOT_SHOULD_NOT_LEAK','PRIVATE_CREATOR_CODE_SHOULD_NOT_LEAK','PRIVATE_PERSON'])
  assert.equal(returned.includes(privateValue),false);
 assert.equal(fixture.requests.every(req=>new URL(req.url).origin==='https://firestore.googleapis.com'),true);
});
test('A correctly configured private service still refuses the wrong HUB identity',async()=>{
 let reads=0;
 const service=createPrivateMcpHandler({
  secret,founderUid:FOUNDER,verifyFounder:async()=>false,
  readFirestore:async()=>{reads++;return Response.json({});}
 });
 const result=await service(new Request('https://collective-mcp.internal/internal/mcp/read',{
  method:'POST',headers:{'content-type':'application/json','x-evora-mcp-private-key':secret},
  body:JSON.stringify({operation:'recent',argument:{limit:1},principal:{uid:FOUNDER,role:'admin',version:1}})
 }));
 assert.equal(result.status,403);assert.equal(reads,0);
});
