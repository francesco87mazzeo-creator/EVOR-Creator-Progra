import{test}from'node:test';import assert from'node:assert/strict';import{registerHooks}from'node:module';
registerHooks({resolve(s,c,n){if(s==='cloudflare:workers')return{url:'data:text/javascript,export class WorkerEntrypoint {constructor(ctx,env){this.env=env;this.ctx=ctx;}}',shortCircuit:true};return n(s,c);}});
const {CollectiveMcpReadService}=await import('../src/mcp-private-entrypoint.mjs');
const {CollectiveMcpReadService:Stage}=await import('../src/mcp-staging-worker.mjs');
const account=project=>JSON.stringify({private_key:'synthetic-never-used-key',client_email:'synthetic@example.invalid',project_id:project});
const env=()=>({MCP_PRIVATE_SHARED_KEY:'s'.repeat(43),MCP_FOUNDER_UID:'synthetic_founder_0001',FIRESTORE_PROJECT_ID:'evora-mcp-staging',MCP_DEPLOYMENT_PROFILE:'staging',FIREBASE_SERVICE_ACCOUNT:account('evora-mcp-staging')});
const request=(path='/internal/mcp/read',key='wrong')=>new Request('https://collective-mcp.internal'+path,{method:'POST',headers:{'content-type':'application/json','x-evora-mcp-private-key':key},body:'{}'});
test('actual entrypoint accepts only the existing FIREBASE_SERVICE_ACCOUNT name',async()=>{
 const e=env();assert.equal((await new CollectiveMcpReadService({},e).fetch(request())).status,403);
 const wrong={...e,FIRESTORE_SERVICE_ACCOUNT:e.FIREBASE_SERVICE_ACCOUNT};delete wrong.FIREBASE_SERVICE_ACCOUNT;
 assert.equal((await new CollectiveMcpReadService({},wrong).fetch(request())).status,503);
});
test('staging bridge refuses production credentials and projects before any Google request',async()=>{
 const previous=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('NO_NETWORK');};try{
  for(const patch of [{FIREBASE_SERVICE_ACCOUNT:account('evora-athletes')},{FIRESTORE_PROJECT_ID:'evora-athletes'},{MCP_DEPLOYMENT_PROFILE:undefined}])assert.equal((await new Stage({},{...env(),...patch}).fetch(request())).status,503);
  const info=await new Stage({},env()).fetch(request('/internal/mcp/stage-info','s'.repeat(43)));assert.deepEqual(await info.json(),{profile:'staging',projectId:'evora-mcp-staging'});assert.equal(calls,0);
 }finally{globalThis.fetch=previous;}
});

test('staging facade also attests its own HUB binding before any identity or database read',async()=>{
 const paths=[];const e={...env(),HUB_IDENTITY:{fetch:async req=>{paths.push(new URL(req.url).pathname);return Response.json({profile:'staging',projectId:'evora-athletes'});}}};
 const previous=globalThis.fetch;globalThis.fetch=async()=>{throw Error('NO_GOOGLE_NETWORK');};try{
 const req=new Request('https://collective-mcp.internal/internal/mcp/read',{method:'POST',headers:{'content-type':'application/json','x-evora-mcp-private-key':'s'.repeat(43)},body:JSON.stringify({operation:'recent',principal:{uid:e.MCP_FOUNDER_UID,role:'admin',version:1},argument:{limit:1}})});
 const result=await new Stage({},e).fetch(req);assert.equal(result.status,503);assert.deepEqual(paths,['/internal/mcp/stage-info']);
 }finally{globalThis.fetch=previous;}
});
