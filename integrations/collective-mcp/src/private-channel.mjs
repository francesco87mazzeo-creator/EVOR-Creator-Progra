import {verifyStagePeer}from'./staging.mjs';
import {MCP_PROFILES}from'../../../server/collective/mcp-profiles.mjs';
// Adapter from the existing strictly bounded MCP reader to the private COLLECTIVE
// Worker service binding. There is NO public HTTP or Google API fallback.
import {RECENT_FIELDS,DETAIL_FIELDS,SETTING_FIELDS,validMcpDocumentId} from '../../../server/collective/mcp-read-policy.mjs';
import {DataError} from './reader.mjs';

const PRIVATE_URL='https://collective-mcp.internal/internal/mcp/read';
const sameList=(a,b)=>Array.isArray(a)&&a.length===b.length&&a.every((v,i)=>v===b[i]);
const sameFields=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)
 && Object.keys(value).sort().join('|')===fields.slice().sort().join('|');
export function privateReadOperation(request,projectId){
 const u=new URL(request.url);
 const root='/v1/projects/'+projectId+'/databases/(default)/documents';
 if(u.origin!=='https://firestore.googleapis.com')throw new DataError('PRIVATE_READ_DENIED');
 if(request.method==='POST'&&u.pathname===root+':runQuery'&&!u.search){
   return request.clone().json().then(b=>{
     const q=b?.structuredQuery;
     const fields=q?.select?.fields?.map(f=>f?.fieldPath);
     const ordering=q?.orderBy;
     if(!sameFields(b,['structuredQuery'])||!sameFields(q,['select','from','orderBy','limit'])
       ||!sameFields(q.select,['fields'])||!sameList(fields,RECENT_FIELDS)
       ||JSON.stringify(q.from)!==JSON.stringify([{collectionId:'candidature'}])
       ||JSON.stringify(ordering)!==JSON.stringify([{field:{fieldPath:'date'},direction:'DESCENDING'},{field:{fieldPath:'__name__'},direction:'DESCENDING'}])
       ||!Number.isInteger(q.limit)||q.limit<1||q.limit>20)throw new DataError('PRIVATE_READ_DENIED');
     return {operation:'recent',argument:{limit:q.limit}};
   });
 }
 if(request.method==='GET'&&u.pathname.startsWith(root+'/candidature/')){
   const id=u.pathname.slice((root+'/candidature/').length);
   if(!validMcpDocumentId(id)||!sameList(u.searchParams.getAll('mask.fieldPaths'),DETAIL_FIELDS)
     ||Array.from(u.searchParams.keys()).some(key=>key!=='mask.fieldPaths'))throw new DataError('PRIVATE_READ_DENIED');
   return Promise.resolve({operation:'application',argument:{id}});
 }
 if(request.method==='GET'&&u.pathname.startsWith(root+'/settings/')&&!u.search){
   const id=u.pathname.slice((root+'/settings/').length);
   if(!Object.hasOwn(SETTING_FIELDS,id))throw new DataError('PRIVATE_READ_DENIED');
   return Promise.resolve({operation:'setting',argument:{id}});
 }
 throw new DataError('PRIVATE_READ_DENIED');
}
export function createPrivateCollectiveChannel({binding,secret,projectId,identity,staging=false,profile=staging?MCP_PROFILES.staging:null}){
 if(!binding||typeof binding.fetch!=='function'||typeof secret!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(secret)
   ||typeof projectId!=='string'||!identity||typeof identity.uid!=='string'
   ||identity.role!=='admin'||!Number.isSafeInteger(identity.version)||identity.version<1)
   throw new DataError('PRIVATE_CHANNEL_UNAVAILABLE');
 if(profile&&projectId!==profile.dataProject)throw new DataError('STAGING_PROJECT_MISMATCH');
 let ready;
 return Object.freeze({async fetch(request){
   if(profile)await(ready??=verifyStagePeer(binding,'https://collective-mcp.internal/internal/mcp/stage-info',{profile:profile.name,projectId:profile.dataProject},{'x-evora-mcp-private-key':secret}));
   const {operation,argument}=await privateReadOperation(request,projectId);
   return binding.fetch(new Request(PRIVATE_URL,{
     method:'POST',headers:{'content-type':'application/json','x-evora-mcp-private-key':secret,...(profile?{'x-evora-mcp-stage-project':profile.dataProject,'x-evora-mcp-profile':profile.name}:{})},
     body:JSON.stringify({operation,argument,principal:{uid:identity.uid,role:identity.role,version:identity.version}}),
     signal:AbortSignal.timeout(6000)
   }));
 }});
}
