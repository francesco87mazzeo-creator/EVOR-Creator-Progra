import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createPrototypeWorker} from '../src/worker.mjs';
import blockedWorker from '../src/worker.mjs';
import {dataFixture, authorityFixture, config, bearer, NOW} from './helpers.mjs';
import {READ_SCOPE} from '../src/auth.mjs';

async function fixture(t,options={}){
 const data=dataFixture(options),auth=await authorityFixture();
 const worker=createPrototypeWorker({config,authorize:auth.authorize,reader:data.reader});
 const accessToken=await auth.token();
 const transport=new StreamableHTTPClientTransport(new URL(config.resource),{requestInit:{headers:{Authorization:'Bearer '+accessToken}},fetch:async(input,init)=>worker.fetch(new Request(input,init))});
 const client=new Client({name:'synthetic-mcp-client',version:'1.0.0'});
 t.after(()=>client.close());await client.connect(transport);
 return{...data,...auth,worker,client,accessToken};
}
test('official SDK client initializes, discovers exactly three protected read-only tools and calls all three',async t=>{
 const f=await fixture(t);const catalog=await f.client.listTools();
 assert.deepEqual(catalog.tools.map(t=>t.name),['list_recent_applications','get_application_metrics','get_scoring_configuration']);
 for(const tool of catalog.tools){assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.annotations.destructiveHint,false);assert.equal(tool.annotations.openWorldHint,false);assert.deepEqual(tool._meta.securitySchemes,[{type:'oauth2',scopes:[READ_SCOPE]}]);}
 const wireResponse=await f.worker.fetch(bearer(f.accessToken,config.resource,{method:'POST',headers:{'content-type':'application/json','accept':'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:100,method:'tools/list',params:{}})}));
 const wire=await wireResponse.json();for(const tool of wire.result.tools)assert.deepEqual(tool.securitySchemes,tool._meta.securitySchemes,'OAuth schemes must be present on the wire; the generic SDK client strips this custom descriptor field');
 const recent=await f.client.callTool({name:'list_recent_applications',arguments:{limit:2}});assert.equal(recent.isError,undefined);assert.equal(recent.structuredContent.applications.length,2);assert.equal(recent.structuredContent.applications[0].id,'application_b');
 const metrics=await f.client.callTool({name:'get_application_metrics',arguments:{applicationId:'application_b'}});assert.equal(metrics.isError,undefined);assert.equal(metrics.structuredContent.metrics.accountsReached,250);assert.equal(metrics.structuredContent.metrics.netFollowers,-1);
 const settings=await f.client.callTool({name:'get_scoring_configuration',arguments:{}});assert.equal(settings.isError,undefined);assert.equal(settings.structuredContent.scoring.source,'stored_document');assert.equal(settings.structuredContent.benchmarks.contributesToV2,false);
 const serialized=JSON.stringify([recent,metrics,settings]);for(const secret of ['PRIVATE_','private@example.invalid','screenshotData','correctedBy','fullName','creatorCode','PRIVATE_CORRECTION_NOTE','PRIVATE_HISTORY_NOTE'])assert.equal(serialized.includes(secret),false,secret);
 assert.equal(f.requests.some(r=>r.method!=='GET'&&!new URL(r.url).pathname.endsWith('documents:runQuery')),false);
});
for(const bad of [0,21,1.5,'2',null])test(`MCP rejects invalid recent limit ${JSON.stringify(bad)} before querying`,async t=>{
 const f=await fixture(t);const result=await f.client.callTool({name:'list_recent_applications',arguments:{limit:bad}});assert.equal(result.isError,true);assert.equal(f.requests.length,0);
});
for(const bad of ['../settings/scoring','a/b','a%2Fb','', 'x'.repeat(129)])test(`MCP rejects invalid document identifier ${bad.slice(0,25)}`,async t=>{
 const f=await fixture(t);const result=await f.client.callTool({name:'get_application_metrics',arguments:{applicationId:bad}});assert.equal(result.isError,true);assert.equal(f.requests.length,0);
});
test('no mutation/export/arbitrary-query tool and strict arguments',async t=>{
 const f=await fixture(t);
 for(const name of ['delete_application','update_application','export_csv','run_query','get_secret']){const result=await f.client.callTool({name,arguments:{}});assert.equal(result.isError,true);}
 for(const [name,args] of [['get_scoring_configuration',{path:'settings/secret'}],['list_recent_applications',{limit:2,fields:['email']}],['get_application_metrics',{applicationId:'application_b',uid:'forged',role:'admin'}]]){
  const result=await f.client.callTool({name,arguments:args});assert.equal(result.isError,true);
 }
 assert.equal(f.requests.length,0);
});
test('revoked grant, HUB role change and authority outage deny an existing client without data reads',async t=>{
 const f=await fixture(t);await f.client.listTools();f.revoked.add('synthetic_jti_00001');
 await assert.rejects(()=>f.client.callTool({name:'list_recent_applications',arguments:{}}));assert.equal(f.requests.length,0);
 f.revoked.clear();f.hub.role='manager';await assert.rejects(()=>f.client.listTools());assert.equal(f.requests.length,0);
 f.hub.role='admin';f.setOffline(true);await assert.rejects(()=>f.client.listTools());assert.equal(f.requests.length,0);
});
test('RFC9728 metadata and challenge are discoverable without data access; host/origin are checked',async()=>{
 const f=dataFixture(),a=await authorityFixture(),worker=createPrototypeWorker({config,authorize:a.authorize,reader:f.reader});
 const metadata=await worker.fetch(new Request(config.origin+'/.well-known/oauth-protected-resource/mcp'));assert.equal(metadata.status,200);assert.deepEqual((await metadata.json()).authorization_servers,[config.issuer]);
 const denied=await worker.fetch(new Request(config.resource,{method:'POST'}));assert.equal(denied.status,401);assert.match(denied.headers.get('www-authenticate'),/resource_metadata=.*oauth-protected-resource\/mcp/);
 assert.equal((await worker.fetch(new Request('https://evil.test/mcp'))).status,403);
 assert.equal((await worker.fetch(bearer(await a.token(),config.resource,{headers:{origin:'https://evil.test'}}))).status,403);
 assert.equal(f.requests.length,0);
});
test('default Worker cannot activate data access, even with production-like environment variables',async()=>{
 const response=await blockedWorker.fetch(new Request(config.resource),{MCP_ENABLED:'true',MCP_FOUNDER_UID:'forged'});assert.equal(response.status,503);assert.equal((await response.json()).dataAccessEnabled,false);
});
test('HTTP endpoint cannot save or accept arbitrary paths and oversized bodies',async()=>{
 const f=dataFixture(),a=await authorityFixture(),worker=createPrototypeWorker({config,authorize:a.authorize,reader:f.reader}),token=await a.token();
 for(const path of ['/applications','/admin/scoring','/notify','/oauth/token','/mcp?token=secret'])assert.equal((await worker.fetch(bearer(token,config.origin+path))).status,404);
 for(const method of ['GET','PUT','PATCH','DELETE'])assert.equal((await worker.fetch(bearer(token,config.resource,{method}))).status,405);
 assert.equal((await worker.fetch(bearer(token,config.resource,{method:'POST',headers:{'content-type':'application/json'},body:' '.repeat(16385)}))).status,413);
 assert.equal(f.requests.length,0);
});
test('upstream failures expose no private details and emit no payload or token logs',async t=>{
 const auth=await authorityFixture();const reader={recent:async()=>{throw Error('PRIVATE_UPSTREAM_PAYLOAD');},application:async()=>{throw Error('PRIVATE_UPSTREAM_PAYLOAD');},setting:async()=>{throw Error('PRIVATE_UPSTREAM_PAYLOAD');}};
 const worker=createPrototypeWorker({config,authorize:auth.authorize,reader}),token=await auth.token(),logs=[];
 const originals={log:console.log,warn:console.warn,error:console.error};for(const key of Object.keys(originals))console[key]=(...args)=>logs.push(args);
 try {
  const transport=new StreamableHTTPClientTransport(new URL(config.resource),{requestInit:{headers:{Authorization:'Bearer '+token}},fetch:async(input,init)=>worker.fetch(new Request(input,init))});
  const client=new Client({name:'synthetic-error-client',version:'1.0.0'});t.after(()=>client.close());await client.connect(transport);
  const result=await client.callTool({name:'list_recent_applications',arguments:{}});assert.equal(result.isError,true);assert.equal(JSON.stringify(result).includes('PRIVATE_'),false);assert.equal(JSON.stringify(result).includes(token),false);assert.equal(logs.length,0);
 } finally {Object.assign(console,originals);}
});
