// Offline cross-repository contract test. All keys and identities are generated
// for this process, and every HTTP request is intercepted or rejected.
import assert from'node:assert/strict';import{pathToFileURL}from'node:url';import path from'node:path';import{readFileSync}from'node:fs';import{registerHooks}from'node:module';
import{generateKeyPair,exportJWK,exportPKCS8}from'jose';
import{Client}from'@modelcontextprotocol/sdk/client/index.js';
import{StreamableHTTPClientTransport}from'@modelcontextprotocol/sdk/client/streamableHttp.js';
import{dataFixture,FOUNDER}from'../test/helpers.mjs';
import{MCP_STAGE_PROJECT,MCP_STAGE_HUB,MCP_STAGE_RESOURCE}from'../../../server/collective/mcp-staging.mjs';
import stagingWorker from'../src/staging-worker.mjs';
if(!process.argv[2])throw Error('Usage: npm run test:hub-integration -- /path/to/evora-social-analytics');
const root=path.resolve(process.argv[2]),load=file=>import(pathToFileURL(path.join(root,file)).href);
registerHooks({resolve(s,c,n){if(s==='cloudflare:workers')return{url:'data:text/javascript,export class WorkerEntrypoint {constructor(ctx,env){this.ctx=ctx;this.env=env;}}',shortCircuit:true};return n(s,c);}});
const{Hub}=await load('apps/hub/server/hub.ts'),{MpcOAuth,MCP_OAUTH_CLIENT,MCP_OAUTH_REDIRECT}=await load('apps/hub/server/mcp-oauth.ts');
const{emptyState}=await load('apps/hub/server/types.ts'),{emptyMpcOAuthState}=await load('apps/hub/server/mcp-oauth-store.ts'),{hash}=await load('apps/hub/server/security.ts');
const{mcpStageInfo}=await load('apps/hub/server/mcp-staging.ts');
const{CollectiveMcpReadService}=await import('../../../worker/src/mcp-staging-worker.mjs');
const config=JSON.parse(readFileSync(path.join(root,'apps/hub/config.mcp-staging.example.json'),'utf8'));
const user={uid:FOUNDER,role:'admin',version:1,enabled:true,displayName:'Synthetic'},authTime=Math.floor(Date.now()/1000);
const registry=emptyState();registry.users[FOUNDER]=user;
const hub=new Hub(config,{transact:async fn=>fn(registry)},{verify:async()=>({uid:FOUNDER,role:'admin',version:1,authTime}),check:async()=>{}});
const oauthState=emptyMpcOAuthState(),oauthKey=await generateKeyPair('ES256',{extractable:true});
const oauth=new MpcOAuth(hub,{transact:async fn=>fn(registry)},{check:async()=>{}},{transact:async fn=>{const draft=structuredClone(oauthState),result=fn(draft);Object.assign(oauthState,draft);return result;}},{issuer:MCP_STAGE_HUB,resource:MCP_STAGE_RESOURCE,founderUid:FOUNDER,signingJwk:JSON.stringify({...await exportJWK(oauthKey.privateKey),kid:'synthetic-stage-key'})});
const verifier='v'.repeat(43),approval=await oauth.approve(new Request(MCP_STAGE_HUB+'/api/mcp-oauth/authorize',{method:'POST',headers:{origin:MCP_STAGE_HUB,'content-type':'application/json',authorization:'Bearer synthetic-hub-session'},body:JSON.stringify({clientId:MCP_OAUTH_CLIENT,redirectUri:MCP_OAUTH_REDIRECT,scope:'collective:read',resource:MCP_STAGE_RESOURCE,state:'synthetic_state_0123456789_ABCD',challenge:await hash(verifier)})}));
assert.equal(approval.status,200);const code=new URL((await approval.json()).redirect).searchParams.get('code');
const post=params=>new Request(MCP_STAGE_HUB+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:params});
const response=await oauth.token(post(new URLSearchParams({client_id:MCP_OAUTH_CLIENT,grant_type:'authorization_code',redirect_uri:MCP_OAUTH_REDIRECT,code,code_verifier:verifier,resource:MCP_STAGE_RESOURCE})));assert.equal(response.status,200);const issued=await response.json();
const data=dataFixture({projectId:MCP_STAGE_PROJECT}),googleKey=await generateKeyPair('RS256',{extractable:true}),googleToken='synthetic_google_access_token_0001';let reads=0,proofs=0;
globalThis.fetch=async(input,init)=>{
 const request=new Request(input,init),url=new URL(request.url);
 if(url.href===MCP_STAGE_HUB+'/.well-known/jwks.json')return oauth.jwks();
 if(url.href==='https://oauth2.googleapis.com/token')return Response.json({access_token:googleToken,expires_in:3600});
 if(url.origin==='https://firestore.googleapis.com'){
  assert.ok(url.pathname.startsWith('/v1/projects/'+MCP_STAGE_PROJECT+'/'));assert.equal(request.headers.get('authorization'),'Bearer '+googleToken);assert.equal(request.headers.has('x-evora-mcp-private-key'),false);reads++;
  return data.channel.fetch(new Request(request.url,{method:request.method,headers:{'content-type':'application/json'},...(request.method==='POST'?{body:await request.text()}:{})}));
 }
 throw Error('UNEXPECTED_NETWORK');
};
const stageEnv={HUB_CONFIG:JSON.stringify(config),HUB_DEPLOYMENT_PROFILE:'mcp-staging',FIREBASE_SERVICE_ACCOUNT:JSON.stringify({project_id:MCP_STAGE_PROJECT})};
const identityBinding={fetch:request=>{if(new URL(request.url).pathname==='/internal/mcp/stage-info'){proofs++;return Response.json(mcpStageInfo(stageEnv));}return hub.privateFetch(request);}};
const oauthBinding={fetch:request=>{if(new URL(request.url).pathname==='/stage-info'){proofs++;return Response.json(mcpStageInfo(stageEnv));}return oauth.privateFetch(request);}};
const secret='s'.repeat(43),account=JSON.stringify({project_id:MCP_STAGE_PROJECT,client_email:'synthetic@example.invalid',private_key:await exportPKCS8(googleKey.privateKey)});
const bridge=new CollectiveMcpReadService({}, {MCP_DEPLOYMENT_PROFILE:'staging',MCP_PRIVATE_SHARED_KEY:secret,MCP_FOUNDER_UID:FOUNDER,FIRESTORE_PROJECT_ID:MCP_STAGE_PROJECT,FIREBASE_SERVICE_ACCOUNT:account,HUB_IDENTITY:identityBinding});
const env={MCP_DEPLOYMENT_PROFILE:'staging',MCP_ENABLED:'1',MCP_RESOURCE:MCP_STAGE_RESOURCE,MCP_ISSUER:MCP_STAGE_HUB,MCP_JWKS_URL:MCP_STAGE_HUB+'/.well-known/jwks.json',MCP_FOUNDER_UID:FOUNDER,MCP_PRIVATE_SHARED_KEY:secret,FIRESTORE_PROJECT_ID:MCP_STAGE_PROJECT,HUB_IDENTITY:identityBinding,MCP_OAUTH_AUTHORITY:oauthBinding,COLLECTIVE_MCP_READ:bridge};
const client=new Client({name:'offline-staging-contract',version:'1.0.0'});
await client.connect(new StreamableHTTPClientTransport(new URL(MCP_STAGE_RESOURCE),{requestInit:{headers:{Authorization:'Bearer '+issued.access_token}},fetch:(input,init)=>stagingWorker.fetch(new Request(input,init),env)}));
try{
 for(const[name,args]of[['list_recent_applications',{limit:2}],['get_application_metrics',{applicationId:'application_b'}],['get_scoring_configuration',{}]]){const result=await client.callTool({name,arguments:args});assert.notEqual(result.isError,true);assert.equal(JSON.stringify(result).includes('PRIVATE_'),false);}
 const refresh=()=>post(new URLSearchParams({grant_type:'refresh_token',client_id:MCP_OAUTH_CLIENT,refresh_token:issued.refresh_token}));
 const successor=await(await oauth.token(refresh())).json();assert.equal((await oauth.token(refresh())).status,400);
 const active=await oauth.privateFetch(new Request('https://oauth.internal/introspect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:successor.access_token,token_type_hint:'access_token'})}));assert.equal((await active.json()).active,false);
 const before=reads;await assert.rejects(()=>client.callTool({name:'list_recent_applications',arguments:{}}));assert.equal(reads,before);assert.equal(reads,7);assert.ok(proofs>0);
 console.log(JSON.stringify({result:'PASS',allThreeTools:true,stagingProofs:true,onlyStagingProject:true,existingSecretName:true,refreshFamilyReplayRevoked:true,firestoreReads:reads,realNetwork:false}));
}finally{await client.close();}
