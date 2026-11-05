// AI evaluation: private channel to the facade and signed, short-lived proposals.
// A proposal binds the Founder, the application, the exact content and the document version it was based on.
// It is stateless (HMAC), so it cannot be forged or edited; reuse is stopped by the facade (same proposalId
// already saved, or document version changed by the first save).
import {validMcpDocumentId} from '../../../server/collective/mcp-read-policy.mjs';
import {validateEvaluation,canonicalJson,PROPOSAL_TTL_MS} from '../../../server/collective/mcp-ai-policy.mjs';
import {boundedText} from './bounded.mjs';
import {DataError} from './reader.mjs';

const AI_URL='https://collective-mcp.internal/internal/mcp/ai';
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64=text=>Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const sha256=async text=>b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
// Proposal key derived from the private channel key, for this single purpose.
async function proposalKey(secret){
 const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),'HKDF',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new TextEncoder().encode('evora-mcp'),info:new TextEncoder().encode('ai-evaluation-proposal-v1')},
  base,{name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
}
export function createProposals({secret,now=Date.now}){
 if(typeof secret!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(secret))throw new DataError('AI_NOT_CONFIGURED');
 const key=proposalKey(secret);
 return Object.freeze({
  async issue({uid,applicationId,content,basedOnVersion}){
   const nonce=b64(crypto.getRandomValues(new Uint8Array(18)));
   const claims={v:1,sub:uid,app:applicationId,h:await sha256(canonicalJson(content)),base:basedOnVersion,exp:now()+PROPOSAL_TTL_MS,n:nonce};
   const body=b64(new TextEncoder().encode(JSON.stringify(claims)));
   const mac=b64(await crypto.subtle.sign('HMAC',await key,new TextEncoder().encode(body)));
   return {token:body+'.'+mac,expiresAt:new Date(claims.exp).toISOString(),proposalId:nonce};
  },
  /** Returns the verified claims or throws a DataError with a precise, non-sensitive code. */
  async verify(token,{uid,applicationId,content}){
   const m=/^([A-Za-z0-9_-]{20,600})\.([A-Za-z0-9_-]{43})$/.exec(typeof token==='string'?token:'');
   if(!m)throw new DataError('PROPOSAL_INVALID');
   const ok=await crypto.subtle.verify('HMAC',await key,unb64(m[2]),new TextEncoder().encode(m[1]));
   if(!ok)throw new DataError('PROPOSAL_INVALID');
   let claims;try{claims=JSON.parse(new TextDecoder().decode(unb64(m[1])));}catch{throw new DataError('PROPOSAL_INVALID');}
   if(claims.v!==1||claims.sub!==uid)throw new DataError('PROPOSAL_INVALID');
   if(claims.app!==applicationId)throw new DataError('PROPOSAL_OTHER_APPLICATION');
   if(!Number.isSafeInteger(claims.exp)||claims.exp<=now())throw new DataError('PROPOSAL_EXPIRED');
   if(claims.h!==await sha256(canonicalJson(content)))throw new DataError('PROPOSAL_CONTENT_CHANGED');
   return claims;
  }
 });
}
export function createAiChannel({binding,secret,identity}){
 if(!binding||typeof binding.fetch!=='function'||typeof secret!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(secret)
   ||!identity||typeof identity.uid!=='string'||identity.role!=='admin'||!Number.isSafeInteger(identity.version))throw new DataError('AI_NOT_CONFIGURED');
 async function call(operation,argument){
  let response;
  try{
   response=await binding.fetch(new Request(AI_URL,{method:'POST',headers:{'content-type':'application/json','x-evora-mcp-private-key':secret},
    body:JSON.stringify({operation,argument,principal:{uid:identity.uid,role:identity.role,version:identity.version}}),signal:AbortSignal.timeout(8000)}));
  }catch{throw new DataError('AI_UNAVAILABLE');}
  if(!response.ok)throw new DataError(response.status===403?'AI_FORBIDDEN':'AI_UNAVAILABLE');
  try{return JSON.parse(await boundedText(response,16384));}catch{throw new DataError('AI_UNAVAILABLE');}
 }
 return Object.freeze({
  async state(id){if(!validMcpDocumentId(id))throw new DataError('INVALID_ID');return call('state',{id});},
  async save({id,evaluation,basedOnVersion,proposalId}){
   if(!validMcpDocumentId(id))throw new DataError('INVALID_ID');
   return call('save',{id,evaluation:validateEvaluation(evaluation),basedOnVersion,proposalId});
  }
 });
}
