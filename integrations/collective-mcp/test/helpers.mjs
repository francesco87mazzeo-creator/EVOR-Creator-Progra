// No test may reach the Internet or a real Firestore/Worker endpoint.
globalThis.fetch=async()=>{throw new Error('EXTERNAL_NETWORK_DISABLED_IN_TESTS');};
import {generateKeyPair, exportJWK, createLocalJWKSet, SignJWT} from 'jose';
import {configuration, authorizer, READ_SCOPE} from '../src/auth.mjs';
import {createReader, RECENT_FIELDS, DETAIL_FIELDS} from '../src/reader.mjs';
import {INDEX_FIELDS, CANDIDATE_FIELDS} from '../../../server/collective/mcp-candidate-policy.mjs';
import {toFirestoreDocument} from '../../../worker/src/firestore.mjs';
import scoreLevels from '../../../public/score-levels.js';
import {DEFAULT_SCORING, computeScore, scoreDocumentFields} from '../../../server/collective/scoring.mjs';
export const NOW=Date.parse('2026-11-04T10:00:00.000Z');
export const FOUNDER='synthetic_founder_0001';
export const PROJECT='demo-evora-mcp';
export const config=configuration({resource:'https://mcp.synthetic.test/mcp',issuer:'https://hub.synthetic.test/oauth',founderUid:FOUNDER});
export const BASE={schemaVersion:5,date:'2026-11-04T09:00:00.000Z',updatedAt:'2026-11-04T09:00:00.000Z',status:'new',followers:2000,views:1206,interactions:54,accountsReached:250,netFollowers:-1};
const secretFields={fullName:'PRIVATE_NAME_SHOULD_NOT_LEAK',email:'private@example.invalid',notes:'PRIVATE_NOTES_SHOULD_NOT_LEAK',screenshotData:'PRIVATE_SCREENSHOT_SHOULD_NOT_LEAK',creatorCode:'PRIVATE_CREATOR_CODE_SHOULD_NOT_LEAK'};
function pathValue(object,path){return path.split('.').reduce((value,key)=>value?.[key],object);}
function setPath(object,path,value){const keys=path.split('.'),last=keys.pop();let parent=object;for(const key of keys)parent=parent[key]??={};parent[last]=structuredClone(value);}
export function dataFixture({applications=null,settings=null,projectId=PROJECT}={}) {
 const app={...BASE,...scoreDocumentFields(computeScore(BASE)),...secretFields,
  ocrInsights:{readAt:BASE.date,merged:{views:1206,interactions:54,accountsReached:250,netFollowers:-1},screenshot1:{screenType:'insights_ok',accountsReached:{value:250,visibility:'complete'}}},
  insightsCorrection:{correctedAt:BASE.date,previousValues:{views:1000},newValues:{views:1206},note:'PRIVATE_CORRECTION_NOTE'},
  insightsHistory:[{correctedBy:'PRIVATE_PERSON',note:'PRIVATE_HISTORY_NOTE'}]};
 const documents=new Map(Object.entries(applications||{application_b:app,application_a:{...app,date:'2026-11-03T09:00:00.000Z'}}));
 const configurationDocs=settings===null?{scoring:structuredClone(DEFAULT_SCORING),scoreLevels:scoreLevels.defaults(),instagramBenchmarks:scoreLevels.benchmarks.toDocument(scoreLevels.benchmarks.defaults())}:settings;
 const requests=[];
 const project=`projects/${projectId}/databases/(default)/documents/`;
 function encode(name,data,mask=null){const filtered={};if(mask)for(const path of mask){const v=pathValue(data,path);if(v!==undefined)setPath(filtered,path,v);}else Object.assign(filtered,data);return{name:project+name,fields:toFirestoreDocument(filtered).fields};}
 const channel={async fetch(request){
  requests.push(request.clone());const url=new URL(request.url);
  if(url.origin!=='https://firestore.googleapis.com'||(!url.pathname.startsWith('/v1/'+project)&&url.pathname!=='/v1/'+project.slice(0,-1)+':runQuery'))throw Error('Unexpected private read');
  if(request.headers.has('authorization'))throw Error('OAuth bearer must never be passed to Firestore');
  const path=url.pathname.slice(('/v1/'+project).length);
  if(path===':runQuery')throw Error('Malformed Firestore URL');
  if(url.pathname.endsWith('documents:runQuery')){
   const query=(await request.json()).structuredQuery;
   if(request.method!=='POST'||query.from[0].collectionId!=='candidature')throw Error('Unexpected query');
   const selected=query.select.fields.map(f=>f.fieldPath);
   if(JSON.stringify(selected)!==JSON.stringify(RECENT_FIELDS)&&JSON.stringify(selected)!==JSON.stringify(INDEX_FIELDS))throw Error('Projection mismatch');
   if(JSON.stringify(query.orderBy)!==JSON.stringify([{field:{fieldPath:'date'},direction:'DESCENDING'},{field:{fieldPath:'__name__'},direction:'DESCENDING'}]))throw Error('Order mismatch');
   const rows=[...documents].filter(([,d])=>d.date!==undefined).sort(([a,x],[b,y])=>x.date<y.date?1:x.date>y.date?-1:a<b?1:a>b?-1:0).slice(0,query.limit).map(([id,d])=>({document:encode('candidature/'+id,d,selected)}));
   return Response.json(rows);
  }
  if(request.method!=='GET')throw Error('Write operation forbidden');
  if(path.startsWith('settings/')){const id=path.slice(9);return Object.hasOwn(configurationDocs,id)?Response.json(encode(path,configurationDocs[id])):new Response(null,{status:404});}
  if(path.startsWith('candidature/')){const id=path.slice(12);if(!documents.has(id))return new Response(null,{status:404});const mask=url.searchParams.getAll('mask.fieldPaths');if(JSON.stringify(mask)!==JSON.stringify(DETAIL_FIELDS)&&JSON.stringify(mask)!==JSON.stringify(CANDIDATE_FIELDS))throw Error('Mask mismatch');return Response.json(encode(path,documents.get(id),mask));}
  throw Error('Unknown path');
 }};
 return{reader:createReader({channel,projectId:PROJECT}),channel,requests,documents,settings:configurationDocs};
}
export async function authorityFixture() {
 const pair=await generateKeyPair('ES256'),jwk=await exportJWK(pair.publicKey);jwk.kid='synthetic-key';jwk.alg='ES256';
 const keySet=createLocalJWKSet({keys:[jwk]}),revoked=new Set(),hub={uid:FOUNDER,role:'admin',version:1};
 const calls={introspection:0,hub:0};let offline=false,active=true;
 async function token(overrides={},header={}) {
  const iat=Math.floor(NOW/1000);
  return new SignJWT({scope:READ_SCOPE,role:'admin',hub_version:1,...overrides}).setProtectedHeader({alg:'ES256',kid:'synthetic-key',typ:'at+jwt',...header}).setIssuer(overrides.iss??config.issuer).setAudience(overrides.aud??config.resource).setSubject(overrides.sub??FOUNDER).setIssuedAt(overrides.iat??iat).setExpirationTime(overrides.exp??iat+300).setJti(overrides.jti??'synthetic_jti_00001').sign(pair.privateKey);
 }
 const oauthAuthority={async fetch(request){calls.introspection++;if(offline)throw Error('PRIVATE_AUTHORITY_DETAIL');const {token:raw}=await request.json();const claims=JSON.parse(Buffer.from(raw.split('.')[1],'base64url').toString());return Response.json({active:active&&!revoked.has(claims.jti),sub:claims.sub,aud:claims.aud,scope:claims.scope,exp:claims.exp,jti:claims.jti,iss:claims.iss});}};
 const hubIdentity={async fetch(request){calls.hub++;if(offline)throw Error('PRIVATE_HUB_DETAIL');if(new URL(request.url).pathname!=='/internal/collective/check')throw Error();const body=await request.json();if(body.uid!==hub.uid||body.role!==hub.role||body.version!==hub.version)return Response.json({},{status:403});return Response.json({user:hub});}};
 const authorize=authorizer({config,keySet,oauthAuthority,hubIdentity,now:()=>NOW});
 return{token,authorize,hub,revoked,calls,keySet,oauthAuthority,hubIdentity,setOffline(v){offline=v;},setActive(v){active=v;}};
}
export function bearer(token,url=config.resource,options={}){return new Request(url,{...options,headers:{authorization:'Bearer '+token,...options.headers}});}
