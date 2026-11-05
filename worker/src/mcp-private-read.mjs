// Private read-only facade. This module has no public route and no mutation operation.
// It must be exposed ONLY as a Cloudflare WorkerEntrypoint through a service binding.
import {RECENT_FIELDS, DETAIL_FIELDS, SETTING_FIELDS, validMcpDocumentId} from '../../server/collective/mcp-read-policy.mjs';
import {INDEX_FIELDS, CANDIDATE_FIELDS, MAX_INDEX} from '../../server/collective/mcp-candidate-policy.mjs';
import {accessToken} from './firestore.mjs';

const PRIVATE_ORIGIN = 'https://collective-mcp.internal';
const PRIVATE_PATH = '/internal/mcp/read';
const MAX_BODY = 2048;
const MAX_RESPONSE = 262144;
const json = (body,status=200) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
const validUid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value) && !value.startsWith('staff-');
const exactKeys = (value,keys) => value && typeof value==='object' && !Array.isArray(value)
  && Object.keys(value).sort().join('|')===keys.slice().sort().join('|');
function constantTimeEqual(a,b) {
  if(typeof a!=='string'||typeof b!=='string') return false;
  let different = a.length ^ b.length;
  const length = Math.max(a.length,b.length);
  for(let i=0;i<length;i++) different |= (a.charCodeAt(i)||0) ^ (b.charCodeAt(i)||0);
  return different===0;
}
async function boundedBody(request) {
  const reader=request.body?.getReader();
  if(!reader) throw Error('NO_BODY');
  const chunks=[];let length=0;
  try {
    for(;;) {
      const {done,value}=await reader.read();
      if(done)break;
      length+=value.length;if(length>MAX_BODY)throw Error('BODY_TOO_LARGE');
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let at=0;
  for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
export function validPrivateOperation(payload) {
  if(!payload || !exactKeys(payload,['operation','principal','argument'])) return false;
  if(!exactKeys(payload.principal,['uid','role','version']) || !validUid(payload.principal.uid)
     || payload.principal.role!=='admin'||!Number.isSafeInteger(payload.principal.version)||payload.principal.version<1) return false;
  if(payload.operation==='recent') return exactKeys(payload.argument,['limit']) && Number.isInteger(payload.argument.limit)
    && payload.argument.limit>=1&&payload.argument.limit<=20;
  if(payload.operation==='application') return exactKeys(payload.argument,['id'])&&validMcpDocumentId(payload.argument.id);
  if(payload.operation==='setting') return exactKeys(payload.argument,['id'])
    && Object.hasOwn(SETTING_FIELDS,payload.argument.id);
  if(payload.operation==='index') return exactKeys(payload.argument,[]);
  if(payload.operation==='candidate') return exactKeys(payload.argument,['id'])&&validMcpDocumentId(payload.argument.id);
  return false;
}
export function createPrivateMcpHandler({secret, founderUid,verifyFounder,readFirestore,deployment=null}) {
  return async request => {
    const url=new URL(request.url);
    if(request.method!=='POST'||url.origin!==PRIVATE_ORIGIN||![PRIVATE_PATH,'/internal/mcp/stage-info'].includes(url.pathname)||url.search)
      return json({error:'not_found'},404);
    if(!/^[A-Za-z0-9_-]{43,128}$/.test(secret||'')||!validUid(founderUid)
      ||typeof verifyFounder!=='function'||typeof readFirestore!=='function') return json({error:'not_configured'},503);
    if(!constantTimeEqual(request.headers.get('x-evora-mcp-private-key'),secret)) return json({error:'forbidden'},403);
    if(url.pathname==='/internal/mcp/stage-info')return deployment?json(deployment):json({error:'not_configured'},503);
    const stageProject=request.headers.get('x-evora-mcp-stage-project'),stageProfile=request.headers.get('x-evora-mcp-profile')||'staging';
    if(stageProject&&(deployment?.profile!==stageProfile||deployment.projectId!==stageProject))return json({error:'staging_isolation'},403);
    if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||'')) return json({error:'unsupported_media_type'},415);
    let payload;
    try{payload=await boundedBody(request);}catch{return json({error:'invalid_request'},400);}
    if(!validPrivateOperation(payload)||payload.principal.uid!==founderUid) return json({error:'forbidden'},403);
    try{
      // Every read rechecks the exact personal Founder UID/role/version against HUB.
      const allowed=await verifyFounder(payload.principal);
      if(allowed!==true)return json({error:'forbidden'},403);
      const response=await readFirestore(payload.operation,payload.argument);
      if(!(response instanceof Response)||![200,404].includes(response.status))return json({error:'data_unavailable'},503);
      const bytes=await response.arrayBuffer();
      if(bytes.byteLength>MAX_RESPONSE) return json({error:'data_unavailable'},503);
      return new Response(bytes,{status:response.status,headers:{'content-type':'application/json','cache-control':'no-store'}});
    }catch{return json({error:'data_unavailable'},503);}
  };
}

function scopedUrl(projectId,path='') {
  if(!/^[a-z0-9-]{4,40}$/.test(projectId||''))throw Error('INVALID_PROJECT');
  return new URL('https://firestore.googleapis.com/v1/projects/'+projectId+'/databases/(default)/documents'+path);
}
const fieldsQuery = paths => paths.map(path=>({fieldPath:path}));
export function buildPrivateFirestoreRequest(projectId,operation,argument,bearer) {
  if(!/^[A-Za-z0-9._-]{20,8192}$/.test(bearer||''))throw Error('NO_AUTH');
  const headers={'Authorization':'Bearer '+bearer,'content-type':'application/json'};
  if(operation==='recent'&&exactKeys(argument,['limit'])&&Number.isInteger(argument.limit)&&argument.limit>=1&&argument.limit<=20) {
    const url=scopedUrl(projectId+'' ,':runQuery');
    const body={structuredQuery:{select:{fields:fieldsQuery(RECENT_FIELDS)},from:[{collectionId:'candidature'}],orderBy:[{field:{fieldPath:'date'},direction:'DESCENDING'},{field:{fieldPath:'__name__'},direction:'DESCENDING'}],limit:argument.limit}};
    return new Request(url,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  }
  if(operation==='application'&&exactKeys(argument,['id'])&&validMcpDocumentId(argument.id)) {
    const url=scopedUrl(projectId,'/candidature/'+argument.id);
    for(const field of DETAIL_FIELDS)url.searchParams.append('mask.fieldPaths',field);
    return new Request(url,{method:'GET',headers,signal:AbortSignal.timeout(5000)});
  }
  if(operation==='setting'&&exactKeys(argument,['id'])&&Object.hasOwn(SETTING_FIELDS,argument.id)) {
    const url=scopedUrl(projectId,'/settings/'+argument.id);
    for(const field of SETTING_FIELDS[argument.id])url.searchParams.append('mask.fieldPaths',field);
    return new Request(url,{method:'GET',headers,signal:AbortSignal.timeout(5000)});
  }
  // Search index: names, handles, status and date only; the MCP server matches the query.
  if(operation==='index'&&exactKeys(argument,[])) {
    const url=scopedUrl(projectId+'',':runQuery');
    const body={structuredQuery:{select:{fields:fieldsQuery(INDEX_FIELDS)},from:[{collectionId:'candidature'}],orderBy:[{field:{fieldPath:'date'},direction:'DESCENDING'},{field:{fieldPath:'__name__'},direction:'DESCENDING'}],limit:MAX_INDEX}};
    return new Request(url,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  }
  if(operation==='candidate'&&exactKeys(argument,['id'])&&validMcpDocumentId(argument.id)) {
    const url=scopedUrl(projectId,'/candidature/'+argument.id);
    for(const field of CANDIDATE_FIELDS)url.searchParams.append('mask.fieldPaths',field);
    return new Request(url,{method:'GET',headers,signal:AbortSignal.timeout(5000)});
  }
  throw Error('OPERATION_DENIED');
}
export function createPrivateFirestoreAccess({serviceAccount,projectId,transport=fetch,now=Date.now}) {
  return async (operation,argument) => {
    const bearer=await accessToken(serviceAccount,now);
    const request=buildPrivateFirestoreRequest(projectId,operation,argument,bearer);
    return transport(request);
  };
}
export const MCP_PRIVATE_SERVICE_ORIGIN=PRIVATE_ORIGIN;
export const MCP_PRIVATE_SERVICE_PATH=PRIVATE_PATH;
