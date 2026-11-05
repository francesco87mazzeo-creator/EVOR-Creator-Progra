import{test}from'node:test';import assert from'node:assert/strict';
import{createConfiguredMcpWorker}from'../src/worker.mjs';import stagingWorker from'../src/staging-worker.mjs';
import{stageEnvironment,MCP_STAGE_PROJECT,MCP_STAGE_HUB,MCP_STAGE_RESOURCE}from'../../../server/collective/mcp-staging.mjs';
import{createPrivateCollectiveChannel}from'../src/private-channel.mjs';
import{createReader}from'../src/reader.mjs';
const identity={uid:'synthetic_founder_0001',role:'admin',version:1};
const settings=()=>({MCP_DEPLOYMENT_PROFILE:'staging',FIRESTORE_PROJECT_ID:MCP_STAGE_PROJECT,MCP_RESOURCE:MCP_STAGE_RESOURCE,MCP_ISSUER:MCP_STAGE_HUB,MCP_JWKS_URL:MCP_STAGE_HUB+'/.well-known/jwks.json',MCP_FOUNDER_UID:identity.uid,MCP_PRIVATE_SHARED_KEY:'s'.repeat(43)});
test('staging cannot accept production projects, issuers, resources or an omitted profile',()=>{
 const env=settings();assert.equal(stageEnvironment(env,'mcp'),true);
 for(const patch of [{FIRESTORE_PROJECT_ID:'evora-athletes'},{MCP_ISSUER:'https://hub.evorafitness.it'},{MCP_RESOURCE:'https://mcp.evorafitness.it/mcp'},{MCP_JWKS_URL:'https://hub.evorafitness.it/.well-known/jwks.json'},{MCP_DEPLOYMENT_PROFILE:undefined}])assert.throws(()=>createConfiguredMcpWorker({...env,...patch}));
});
test('staging verifies both HUB services before token checks or any data operation',async()=>{
 const calls=[];const wrong={fetch:async request=>{calls.push(new URL(request.url).pathname);return Response.json({profile:'production',projectId:'evora-athletes'});}};
 const data={fetch:async()=>{throw Error('DATA_MUST_NOT_BE_REACHED');}};
 const worker=createConfiguredMcpWorker({...settings(),MCP_OAUTH_AUTHORITY:wrong,HUB_IDENTITY:wrong,COLLECTIVE_MCP_READ:data});
 assert.equal((await worker.fetch(new Request(MCP_STAGE_RESOURCE))).status,503);
 assert.deepEqual(calls.sort(),['/internal/mcp/stage-info','/stage-info']);
});
test('a production or old private binding cannot receive an application query from staging',async()=>{
 for(const response of [()=>Response.json({profile:'production',projectId:'evora-athletes'}),()=>new Response(null,{status:404})]){
  const calls=[];const binding={fetch:async request=>{calls.push(new URL(request.url).pathname);return response();}};
  const reader=createReader({projectId:MCP_STAGE_PROJECT,channel:createPrivateCollectiveChannel({binding,secret:'s'.repeat(43),projectId:MCP_STAGE_PROJECT,identity,staging:true})});
  await assert.rejects(()=>reader.recent(1));assert.deepEqual(calls,['/internal/mcp/stage-info']);
 }
});
test('staging entrypoint is closed when its profile or configuration is absent',async()=>{
 assert.equal((await stagingWorker.fetch(new Request(MCP_STAGE_RESOURCE),{})).status,503);
 assert.equal((await stagingWorker.fetch(new Request(MCP_STAGE_RESOURCE),{MCP_DEPLOYMENT_PROFILE:'staging',MCP_ENABLED:'1'})).status,503);
});
test('checked-in deployment files have only the closed staging services and no credentials',async()=>{
 const{readFileSync}=await import('node:fs');const{checkStaging}=await import('../scripts/check-staging.mjs');
 const mcp=JSON.parse(readFileSync(new URL('../wrangler.staging.jsonc',import.meta.url),'utf8')),bridge=JSON.parse(readFileSync(new URL('../../../worker/wrangler.mcp-staging.jsonc',import.meta.url),'utf8'));
 assert.equal(checkStaging(mcp,bridge).isolated,true);
 for(const patch of[{name:'throbbing-feather-957f'},{vars:{...bridge.vars,FIRESTORE_PROJECT_ID:'evora-athletes'}},{services:[{binding:'HUB_IDENTITY',service:'evora-hub-auth-test',entrypoint:'HubIdentityService'}]}])assert.throws(()=>checkStaging(mcp,{...bridge,...patch}));
});
