import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{registerHooks}from'node:module';
registerHooks({resolve(s,c,n){if(s==='cloudflare:workers')return{url:'data:text/javascript,export class WorkerEntrypoint {constructor(ctx,env){this.env=env;this.ctx=ctx;}}',shortCircuit:true};return n(s,c);}});
import{createConfiguredMcpWorker}from'../src/worker.mjs';import productionWorker from'../src/production-worker.mjs';import stagingWorker from'../src/staging-worker.mjs';
import{deploymentProfile,MCP_PROFILES,MCP_PROD_HUB,MCP_PROD_HUB_PROJECT,MCP_PROD_RESOURCE,MCP_PROD_DATA_PROJECT}from'../../../server/collective/mcp-profiles.mjs';
import{MCP_STAGE_PROJECT,MCP_STAGE_HUB,MCP_STAGE_RESOURCE}from'../../../server/collective/mcp-staging.mjs';
import{RECENT_FIELDS,DETAIL_FIELDS,SETTING_FIELDS}from'../../../server/collective/mcp-read-policy.mjs';
import{createPrivateCollectiveChannel}from'../src/private-channel.mjs';
import{createReader}from'../src/reader.mjs';
import{createPrivateMcpHandler,buildPrivateFirestoreRequest}from'../../../worker/src/mcp-private-read.mjs';
import{checkProduction}from'../scripts/check-production.mjs';
const identity={uid:'synthetic_founder_0001',role:'admin',version:1},secret='s'.repeat(43);
const settings=()=>({MCP_DEPLOYMENT_PROFILE:'production',FIRESTORE_PROJECT_ID:MCP_PROD_DATA_PROJECT,MCP_RESOURCE:MCP_PROD_RESOURCE,MCP_ISSUER:MCP_PROD_HUB,MCP_JWKS_URL:MCP_PROD_HUB+'/.well-known/jwks.json',MCP_FOUNDER_UID:identity.uid,MCP_PRIVATE_SHARED_KEY:secret});
const read=url=>JSON.parse(readFileSync(new URL(url,import.meta.url),'utf8'));

test('production profile accepts only its HUB, resource and the evora-athletes data project',()=>{
 assert.equal(deploymentProfile(settings(),'mcp'),MCP_PROFILES.production);
 for(const patch of [{FIRESTORE_PROJECT_ID:MCP_STAGE_PROJECT},{FIRESTORE_PROJECT_ID:MCP_PROD_HUB_PROJECT},{MCP_ISSUER:MCP_STAGE_HUB},{MCP_RESOURCE:MCP_STAGE_RESOURCE},
  {MCP_JWKS_URL:MCP_STAGE_HUB+'/.well-known/jwks.json'},{MCP_DEPLOYMENT_PROFILE:'staging'},{MCP_DEPLOYMENT_PROFILE:'prod'},{MCP_DEPLOYMENT_PROFILE:undefined}])
  assert.throws(()=>createConfiguredMcpWorker({...settings(),...patch}));
 // A Worker that omits the profile can never present the production resource.
 assert.throws(()=>deploymentProfile({FIRESTORE_PROJECT_ID:MCP_PROD_DATA_PROJECT,MCP_RESOURCE:MCP_PROD_RESOURCE},'mcp'));
});
test('production MCP refuses staging or unprofiled HUB attestations before tokens or data',async()=>{
 for(const attestation of [{profile:'mcp-staging',projectId:MCP_STAGE_PROJECT,origin:MCP_STAGE_HUB},{profile:'mcp',projectId:MCP_STAGE_PROJECT,origin:MCP_PROD_HUB},{profile:'mcp',projectId:MCP_PROD_HUB_PROJECT,origin:MCP_STAGE_HUB}]){
  const calls=[];const hub={fetch:async request=>{calls.push(new URL(request.url).pathname);return Response.json(attestation);}};
  const data={fetch:async()=>{throw Error('DATA_MUST_NOT_BE_REACHED');}};
  const worker=createConfiguredMcpWorker({...settings(),MCP_OAUTH_AUTHORITY:hub,HUB_IDENTITY:hub,COLLECTIVE_MCP_READ:data});
  assert.equal((await worker.fetch(new Request(MCP_PROD_RESOURCE,{method:'POST'}))).status,503);
  assert.deepEqual(calls.sort(),['/internal/mcp/stage-info','/stage-info']);
 }
});
test('production channel sends queries only to the production read facade',async()=>{
 for(const response of [()=>Response.json({profile:'staging',projectId:MCP_STAGE_PROJECT}),()=>Response.json({profile:'unprofiled',projectId:MCP_PROD_DATA_PROJECT}),()=>Response.json({profile:'production',projectId:MCP_STAGE_PROJECT}),()=>new Response(null,{status:404})]){
  const calls=[];const binding={fetch:async request=>{calls.push(new URL(request.url).pathname);return response();}};
  const reader=createReader({projectId:MCP_PROD_DATA_PROJECT,channel:createPrivateCollectiveChannel({binding,secret,projectId:MCP_PROD_DATA_PROJECT,identity,profile:MCP_PROFILES.production})});
  await assert.rejects(()=>reader.recent(1));assert.deepEqual(calls,['/internal/mcp/stage-info']);
 }
 assert.throws(()=>createPrivateCollectiveChannel({binding:{fetch(){}},secret,projectId:MCP_STAGE_PROJECT,identity,profile:MCP_PROFILES.production}));
});
test('a facade answers only requests addressed to its own profile and project',async()=>{
 const reads=[];const facade=deployment=>createPrivateMcpHandler({secret,founderUid:identity.uid,deployment,verifyFounder:async()=>true,readFirestore:async op=>{reads.push(op);return Response.json([]);}});
 const call=(handler,headers)=>handler(new Request('https://collective-mcp.internal/internal/mcp/read',{method:'POST',headers:{'content-type':'application/json','x-evora-mcp-private-key':secret,...headers},
  body:JSON.stringify({operation:'recent',argument:{limit:1},principal:identity})}));
 const production=facade({profile:'production',projectId:MCP_PROD_DATA_PROJECT}),staging=facade({profile:'staging',projectId:MCP_STAGE_PROJECT}),legacy=facade({profile:'unprofiled',projectId:MCP_PROD_DATA_PROJECT});
 assert.equal((await call(production,{'x-evora-mcp-stage-project':MCP_PROD_DATA_PROJECT,'x-evora-mcp-profile':'production'})).status,200);
 assert.equal((await call(production,{'x-evora-mcp-stage-project':MCP_STAGE_PROJECT})).status,403);
 assert.equal((await call(staging,{'x-evora-mcp-stage-project':MCP_PROD_DATA_PROJECT,'x-evora-mcp-profile':'production'})).status,403);
 assert.equal((await call(legacy,{'x-evora-mcp-stage-project':MCP_PROD_DATA_PROJECT,'x-evora-mcp-profile':'production'})).status,403);
 assert.equal((await call(staging,{'x-evora-mcp-stage-project':MCP_STAGE_PROJECT})).status,200);
 assert.deepEqual(reads,['recent','recent']);
});
test('production and staging entrypoints are closed outside their own profile',async()=>{
 for(const env of [{},{MCP_DEPLOYMENT_PROFILE:'staging',MCP_ENABLED:'1'},{MCP_DEPLOYMENT_PROFILE:'production',MCP_ENABLED:'1'}])
  assert.equal((await productionWorker.fetch(new Request(MCP_PROD_RESOURCE),env)).status,503);
 assert.equal((await stagingWorker.fetch(new Request(MCP_STAGE_RESOURCE),{MCP_DEPLOYMENT_PROFILE:'production',MCP_ENABLED:'1'})).status,503);
 const{CollectiveMcpReadService}=await import('../../../worker/src/mcp-production-worker.mjs');
 assert.equal((await new CollectiveMcpReadService({},{MCP_DEPLOYMENT_PROFILE:'staging'}).fetch(new Request('https://collective-mcp.internal/internal/mcp/read',{method:'POST'}))).status,503);
});
test('checked-in production files are three new closed Workers without credentials',()=>{
 const mcp=read('../wrangler.production.jsonc'),bridge=read('../../../worker/wrangler.mcp-production.jsonc');
 assert.equal(checkProduction(mcp,bridge).isolated,true);
 for(const patch of [{name:'throbbing-feather-957f'},{vars:{...bridge.vars,FIRESTORE_PROJECT_ID:MCP_STAGE_PROJECT}},{services:[{binding:'HUB_IDENTITY',service:'evora-hub-auth-test',entrypoint:'HubIdentityService'}]},
  {services:[{binding:'HUB_IDENTITY',service:'evora-hub-mcp-staging',entrypoint:'HubIdentityService'}]},{workers_dev:true},{routes:[{pattern:'collective.evorafitness.it/*'}]}])
  assert.throws(()=>checkProduction(mcp,{...bridge,...patch}));
 for(const patch of [{compatibility_flags:[]},{vars:{...mcp.vars,MCP_ISSUER:MCP_STAGE_HUB}},{name:'evora-collective-mcp-staging'}])assert.throws(()=>checkProduction({...mcp,...patch},bridge));
 // The live COLLECTIVE Worker keeps its original entrypoint: the pilot never wraps it.
 assert.match(readFileSync(new URL('../../../wrangler.toml',import.meta.url),'utf8'),/^main = "worker\/src\/worker\.js"$/m);
});
test('the read projection never requests identity, contacts, notes, evaluations or screenshots',()=>{
 const forbidden=/^(name|fullName|firstName|lastName|email|phone|instagram|instagramHandle|instagramUrl|tiktok|tiktokHandle|tiktokUrl|notes|evaluation|creatorCode|city|birth|age|gender|profileScreenshotData|screenshotData|screenshotData2|message|motivation|consent)/i;
 const all=[...RECENT_FIELDS,...DETAIL_FIELDS,...Object.values(SETTING_FIELDS).flat()];
 assert.deepEqual(all.filter(f=>forbidden.test(f.split('.')[0])||/screenshotData|Data$|email|note/i.test(f)),[]);
 const recent=buildPrivateFirestoreRequest(MCP_PROD_DATA_PROJECT,'recent',{limit:20},'b'.repeat(20));
 assert.equal(new URL(recent.url).pathname,'/v1/projects/evora-athletes/databases/(default)/documents:runQuery');
 const detail=buildPrivateFirestoreRequest(MCP_PROD_DATA_PROJECT,'application',{id:'synthetic-01'},'b'.repeat(20));
 assert.deepEqual(new URL(detail.url).searchParams.getAll('mask.fieldPaths'),[...DETAIL_FIELDS]);
 assert.equal(detail.method,'GET');assert.equal(recent.method,'POST');
});
