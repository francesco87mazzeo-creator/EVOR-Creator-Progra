import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateCollectiveChannel,privateReadOperation} from '../src/private-channel.mjs';
import {RECENT_FIELDS,DETAIL_FIELDS} from '../../../server/collective/mcp-read-policy.mjs';
import {createReader} from '../src/reader.mjs';
const projectId='evora-athletes',key='R'.repeat(43),identity={uid:'founder_uid_abcdefghijklmnop',role:'admin',version:4};
test('Only exact generated Firestore reads become private operations',async()=>{
 const requests=[];
 const binding={fetch:async req=>{requests.push(req);return Response.json({ok:true});}};
 const channel=createPrivateCollectiveChannel({binding,secret:key,projectId,identity});
 const reader=createReader({channel,projectId});
 assert.equal(await reader.setting('scoring').catch(()=>null),null);
 assert.equal(requests.length,1);
 const p=await requests[0].json();
 assert.deepEqual(p,{operation:'setting',argument:{id:'scoring'},principal:identity});
 assert.equal(requests[0].url,'https://collective-mcp.internal/internal/mcp/read');
 assert.equal(requests[0].headers.get('x-evora-mcp-private-key'),key);
});
test('Reject mass read, different project, unrestricted masks and write methods',async()=>{
 const root='https://firestore.googleapis.com/v1/projects/'+projectId+'/databases/(default)/documents';
 for(const r of [
  new Request(root+'/candidature/test',{method:'GET'}),
  new Request(root+'/candidature/test?mask.fieldPaths=email',{method:'GET'}),
  new Request(root+'/settings/secret'),
  new Request(root+'/settings/scoring',{method:'POST'}),
  new Request(root.replace(projectId,'other-project')+'/settings/scoring'),
  new Request(root+':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'candidature'}],limit:100}})})
 ])await assert.rejects(()=>privateReadOperation(r,projectId));
});
test('Reader generated application and recent reads use the same fixed data policy',async()=>{
 const root='https://firestore.googleapis.com/v1/projects/'+projectId+'/databases/(default)/documents';
 const detail=new URL(root+'/candidature/test');
 DETAIL_FIELDS.forEach(f=>detail.searchParams.append('mask.fieldPaths',f));
 assert.deepEqual(await privateReadOperation(new Request(detail),projectId),{operation:'application',argument:{id:'test'}});
 const body={structuredQuery:{select:{fields:RECENT_FIELDS.map(fieldPath=>({fieldPath}))},from:[{collectionId:'candidature'}],orderBy:[{field:{fieldPath:'date'},direction:'DESCENDING'},{field:{fieldPath:'__name__'},direction:'DESCENDING'}],limit:3}};
 assert.deepEqual(await privateReadOperation(new Request(root+':runQuery',{method:'POST',body:JSON.stringify(body)}),projectId),{operation:'recent',argument:{limit:3}});
});
