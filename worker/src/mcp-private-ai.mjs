// Private AI-evaluation facade: prepares and saves ONE evaluation per confirmed proposal.
// Reads use the existing read-only service account. Writes use a password-authenticated Firebase identity
// (role `aiwriter`) whose ID token is subject to Firestore Security Rules, which allow it to change only
// `aiEvaluation` and `aiEvaluationHistory`. No IAM write credential exists anywhere in this path.
import {AI_STATE_FIELDS,MAX_HISTORY,validateEvaluation,canonicalJson,EvaluationError} from '../../server/collective/mcp-ai-policy.mjs';
import {validMcpDocumentId} from '../../server/collective/mcp-read-policy.mjs';
import {accessToken,toFirestoreValue,fromFirestoreValue} from './firestore.mjs';

export const PRIVATE_AI_PATH='/internal/mcp/ai';
const MAX_BODY=16384;
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===keys.slice().sort().join('|');
const validUid=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(value)&&!value.startsWith('staff-');
const validVersion=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,9})?Z$/.test(value);
const validNonce=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{22,64}$/.test(value);
function constantTimeEqual(a,b){
 if(typeof a!=='string'||typeof b!=='string')return false;
 let different=a.length^b.length;
 for(let i=0;i<Math.max(a.length,b.length);i++)different|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);
 return different===0;
}
async function boundedJson(request){
 const text=await request.text();
 if(text.length>MAX_BODY)throw Error('BODY_TOO_LARGE');
 return JSON.parse(text);
}
export function validAiOperation(payload){
 if(!exactKeys(payload,['operation','principal','argument']))return false;
 const p=payload.principal;
 if(!exactKeys(p,['uid','role','version'])||!validUid(p.uid)||p.role!=='admin'||!Number.isSafeInteger(p.version)||p.version<1)return false;
 const a=payload.argument;
 if(payload.operation==='state')return exactKeys(a,['id'])&&validMcpDocumentId(a.id);
 if(payload.operation==='save'){
  if(!exactKeys(a,['id','evaluation','basedOnVersion','proposalId'])||!validMcpDocumentId(a.id)||!validVersion(a.basedOnVersion)||!validNonce(a.proposalId))return false;
  try{validateEvaluation(a.evaluation);return true;}catch(e){if(e instanceof EvaluationError)return false;throw e;}
 }
 return false;
}
/** Shape of the stored current evaluation, for the proposal preview: no history contents. */
function summarize(raw){
 if(!raw?.mapValue)return null;
 const v=fromFirestoreValue(raw);
 return {score:Number.isInteger(v.score)?v.score:null,rubricVersion:typeof v.rubricVersion==='string'?v.rubricVersion:null,
  evaluatedAt:typeof v.evaluatedAt==='string'?v.evaluatedAt:null,proposalId:typeof v.proposalId==='string'?v.proposalId:null};
}
export function createPrivateAiHandler({secret,founderUid,verifyFounder,store}){
 return async request=>{
  const url=new URL(request.url);
  if(request.method!=='POST'||url.pathname!==PRIVATE_AI_PATH||url.search)return json({error:'not_found'},404);
  if(!/^[A-Za-z0-9_-]{43,128}$/.test(secret||'')||!validUid(founderUid)||typeof verifyFounder!=='function'||!store)return json({error:'not_configured'},503);
  if(!constantTimeEqual(request.headers.get('x-evora-mcp-private-key'),secret))return json({error:'forbidden'},403);
  let payload;
  try{payload=await boundedJson(request);}catch{return json({error:'invalid_request'},400);}
  if(!validAiOperation(payload)||payload.principal.uid!==founderUid)return json({error:'forbidden'},403);
  try{
   if(await verifyFounder(payload.principal)!==true)return json({error:'forbidden'},403);
   if(payload.operation==='state')return json(await store.state(payload.argument.id));
   return json(await store.save(payload.argument));
  }catch{return json({error:'ai_unavailable'},503);}
 };
}
/**
 * Firestore access for the AI facade. `transport` is fetch; `now` the clock.
 * writer: {email,password,apiKey} of the `aiwriter` identity (Firebase Auth email/password).
 */
export function createAiFirestoreStore({serviceAccount,projectId,writer,transport=fetch,now=Date.now}){
 if(!/^[a-z0-9-]{4,40}$/.test(projectId||''))throw Error('INVALID_PROJECT');
 if(!writer||typeof writer.email!=='string'||typeof writer.password!=='string'||!/^[A-Za-z0-9_-]{20,60}$/.test(writer.apiKey||''))throw Error('AI_WRITER_NOT_CONFIGURED');
 const base=`projects/${projectId}/databases/(default)/documents`;
 let session=null;
 async function idToken(){
  if(session&&session.expires>now()+60_000)return session.token;
  const r=await transport(new Request('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(writer.apiKey),{method:'POST',
   headers:{'content-type':'application/json'},body:JSON.stringify({email:writer.email,password:writer.password,returnSecureToken:true}),signal:AbortSignal.timeout(5000)}));
  if(!r.ok)throw Error('AI_WRITER_SIGN_IN_FAILED');
  const body=await r.json();
  if(typeof body.idToken!=='string')throw Error('AI_WRITER_SIGN_IN_FAILED');
  session={token:body.idToken,expires:now()+Math.max(0,Number(body.expiresIn||0)*1000)};
  return session.token;
 }
 async function readDoc(id){
  const url=new URL(`https://firestore.googleapis.com/v1/${base}/candidature/${id}`);
  for(const field of AI_STATE_FIELDS)url.searchParams.append('mask.fieldPaths',field);
  const r=await transport(new Request(url,{headers:{authorization:'Bearer '+await accessToken(serviceAccount,now)},signal:AbortSignal.timeout(5000)}));
  if(r.status===404)return null;
  if(!r.ok)throw Error('AI_STATE_UNAVAILABLE');
  const doc=await r.json();
  if(doc.name!==`${base}/candidature/${id}`||!validVersion(doc.updateTime))throw Error('AI_STATE_UNAVAILABLE');
  return doc;
 }
 return Object.freeze({
  async state(id){
   const doc=await readDoc(id);
   if(!doc)return {exists:false};
   const f=doc.fields||{};
   return {exists:true,version:doc.updateTime,fullName:f.fullName?.stringValue??null,instagramHandle:f.instagramHandle?.stringValue??null,
    current:summarize(f.aiEvaluation),historyCount:f.aiEvaluationHistory?.arrayValue?.values?.length||0};
  },
  async save({id,evaluation,basedOnVersion,proposalId}){
   const content=validateEvaluation(evaluation);
   const doc=await readDoc(id);
   if(!doc)return {status:'not_found'};
   const f=doc.fields||{},current=summarize(f.aiEvaluation);
   // The same confirmed proposal saved twice (retry, duplicate call): report it, write nothing.
   if(current?.proposalId===proposalId)return {status:'already_saved',evaluatedAt:current.evaluatedAt};
   // Anything written since the proposal (staff edit, another evaluation) invalidates it.
   if(doc.updateTime!==basedOnVersion)return {status:'conflict'};
   const value={...content,evaluatedBy:'founder',basedOnVersion,proposalId};
   const fields={aiEvaluation:toFirestoreValue(value)},mask=['aiEvaluation'];
   if(f.aiEvaluation?.mapValue){
    // Raw stored values: the previous evaluation keeps its server timestamp type, as Rules compare exactly.
    const before=f.aiEvaluationHistory?.arrayValue?.values||[],first=canonicalJson(before[0]);
    const kept=before.length<MAX_HISTORY?before:before.filter(v=>canonicalJson(v)!==first);
    fields.aiEvaluationHistory={arrayValue:{values:[...kept,f.aiEvaluation]}};mask.push('aiEvaluationHistory');
   }
   const r=await transport(new Request(`https://firestore.googleapis.com/v1/${base}:commit`,{method:'POST',
    headers:{authorization:'Bearer '+await idToken(),'content-type':'application/json'},signal:AbortSignal.timeout(5000),
    body:JSON.stringify({writes:[{update:{name:`${base}/candidature/${id}`,fields},updateMask:{fieldPaths:mask},
     updateTransforms:[{fieldPath:'aiEvaluation.evaluatedAt',setToServerValue:'REQUEST_TIME'}],currentDocument:{updateTime:basedOnVersion}}]})}));
   if(r.ok){const body=await r.json();return {status:'saved',evaluatedAt:body.commitTime||null,historyCount:fields.aiEvaluationHistory?.arrayValue.values.length||0};}
   const error=await r.json().catch(()=>({}));
   if(r.status===409||error.error?.status==='FAILED_PRECONDITION'||error.error?.status==='ABORTED')return {status:'conflict'};
   if(r.status===403)return {status:'denied'};
   throw Error('AI_SAVE_FAILED');
  }
 });
}
