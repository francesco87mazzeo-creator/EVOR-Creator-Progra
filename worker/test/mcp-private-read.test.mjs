import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateMcpHandler,buildPrivateFirestoreRequest,validPrivateOperation} from '../src/mcp-private-read.mjs';
import {RECENT_FIELDS,DETAIL_FIELDS,SETTING_FIELDS} from '../../server/collective/mcp-read-policy.mjs';
const founder='founder_uid_abcdefghijklmnop';
const secret='M'.repeat(43);
const url='https://collective-mcp.internal/internal/mcp/read';
const payload=(operation='recent',argument={limit:3},principal={uid:founder,role:'admin',version:2})=>({operation,argument,principal});
const req=(body,options={})=>new Request(url,{method:'POST',headers:{'content-type':'application/json','x-evora-mcp-private-key':options.secret??secret},body:JSON.stringify(body)});
test('Private MCP facade never accepts missing or wrong secret, methods or routes',async()=>{
 let reads=0;
 const service=createPrivateMcpHandler({secret,founderUid:founder,verifyFounder:async()=>true,readFirestore:async()=>{reads++;return Response.json([]);}});
 assert.equal((await service(new Request(url,{method:'GET'}))).status,404);
 assert.equal((await service(new Request(url+'?anything=1',{method:'POST'}))).status,404);
 assert.equal((await service(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}))).status,403);
 assert.equal((await service(req(payload(),{secret:'NOT_THE_KEY'}))).status,403);
 assert.equal(reads,0);
});
test('Private MCP facade rejects impersonation and rechecks exact Founder version on every read',async()=>{
 let checks=0,reads=0;
 const service=createPrivateMcpHandler({secret,founderUid:founder,verifyFounder:async p=>{checks++;return p.version===2;},readFirestore:async()=>{reads++;return Response.json([]);}});
 for(const p of [
  payload('recent',{limit:0}),payload('recent',{limit:21}),payload('application',{id:'../private'}),
  payload('setting',{id:'serviceAccount'}),payload('delete',{id:'x'}),
  payload('recent',{limit:3},{uid:'another_admin_abcdefghijklmnop',role:'admin',version:2}),
  payload('recent',{limit:3},{uid:founder,role:'manager',version:2})
 ])assert.equal((await service(req(p))).status,403);
 assert.equal(checks,0);
 assert.equal((await service(req(payload('recent',{limit:2},{uid:founder,role:'admin',version:1})))).status,403);
 assert.equal(checks,1);assert.equal(reads,0);
 assert.equal((await service(req(payload()))).status,200);assert.equal(checks,2);assert.equal(reads,1);
 assert.equal((await service(req(payload()))).status,200);assert.equal(checks,3);assert.equal(reads,2);
});
test('Missing configuration, unavailable HUB, Firestore failure or oversized response fail closed',async()=>{
 const args={secret,founderUid:founder,verifyFounder:async()=>true,readFirestore:async()=>Response.json([])};
 assert.equal((await createPrivateMcpHandler({...args,secret:''})(req(payload()))).status,503);
 assert.equal((await createPrivateMcpHandler({...args,verifyFounder:async()=>{throw Error('offline');}})(req(payload()))).status,503);
 assert.equal((await createPrivateMcpHandler({...args,readFirestore:async()=>new Response('private', {status:500})})(req(payload()))).status,503);
 assert.equal((await createPrivateMcpHandler({...args,readFirestore:async()=>new Response('X'.repeat(262145))})(req(payload()))).status,503);
});
test('Firestore projected requests whitelist only the exact numeric fields and three settings',async()=>{
 const bearer='a'.repeat(44),project='evora-athletes';
 const recent=buildPrivateFirestoreRequest(project,'recent',{limit:20},bearer);
 assert.equal(recent.method,'POST');assert.match(recent.url,/documents:runQuery$/);
 const q=(await recent.json()).structuredQuery;
 assert.deepEqual(q.select.fields.map(f=>f.fieldPath),RECENT_FIELDS);
 assert.equal(q.limit,20);
 const detail=buildPrivateFirestoreRequest(project,'application',{id:'test_1'},bearer);
 assert.deepEqual(new URL(detail.url).searchParams.getAll('mask.fieldPaths'),DETAIL_FIELDS);
 for(const field of ['email','name','notes','insightsHistory','screenshotData'])assert.equal(new URL(detail.url).search.includes(field),false);
 for(const id of ['scoring','scoreLevels','instagramBenchmarks']){
  const request=buildPrivateFirestoreRequest(project,'setting',{id},bearer);
  assert.deepEqual(new URL(request.url).searchParams.getAll('mask.fieldPaths'),SETTING_FIELDS[id]);
 }
 assert.throws(()=>buildPrivateFirestoreRequest(project,'setting',{id:'adminSecret'},bearer));
 assert.throws(()=>buildPrivateFirestoreRequest(project,'application',{id:'../settings'},bearer));
 assert.throws(()=>buildPrivateFirestoreRequest(project,'recent',{limit:100},bearer));
 assert.equal(validPrivateOperation(payload('recent',{limit:1,extra:true})),false);
});
