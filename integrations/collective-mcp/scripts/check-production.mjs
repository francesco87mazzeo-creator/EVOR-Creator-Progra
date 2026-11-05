import fs from'node:fs';import{fileURLToPath}from'node:url';
import{MCP_PROD_HUB,MCP_PROD_HUB_PROJECT,MCP_PROD_RESOURCE,MCP_PROD_DATA_PROJECT}from'../../../server/collective/mcp-profiles.mjs';
// Production MCP pilot: three NEW Workers only. Never the live COLLECTIVE Worker, its HUB test service or staging.
export function checkProduction(mcp,bridge,hub=null){
 const require=(ok)=>{if(!ok)throw Error('PRODUCTION_CONFIG_REJECTED');};
 require(mcp.name==='evora-collective-mcp'&&mcp.main==='src/production-worker.mjs'&&mcp.workers_dev===true&&mcp.preview_urls===false);
 require(JSON.stringify(mcp.compatibility_flags)===JSON.stringify(['global_fetch_strictly_public']));
 require(bridge.name==='evora-collective-mcp-read'&&bridge.main==='src/mcp-production-worker.mjs'&&bridge.workers_dev===false&&bridge.preview_urls===false);
 for(const cfg of[mcp,bridge]){
  require(!cfg.routes?.length&&!cfg.route&&cfg.vars.MCP_DEPLOYMENT_PROFILE==='production'&&cfg.vars.FIRESTORE_PROJECT_ID===MCP_PROD_DATA_PROJECT&&cfg.observability?.enabled===false);
  for(const key of['FIREBASE_SERVICE_ACCOUNT','FIRESTORE_SERVICE_ACCOUNT','MCP_PRIVATE_SHARED_KEY','MCP_FOUNDER_UID','MCP_OAUTH_SIGNING_JWK'])require(!(key in cfg.vars));
  for(const key of['d1_databases','kv_namespaces','r2_buckets','durable_objects','queues','env'])require(!(key in cfg));
 }
 require(['0','1'].includes(mcp.vars.MCP_ENABLED)&&mcp.vars.MCP_RESOURCE===MCP_PROD_RESOURCE&&mcp.vars.MCP_ISSUER===MCP_PROD_HUB&&mcp.vars.MCP_JWKS_URL===MCP_PROD_HUB+'/.well-known/jwks.json');
 const identity={binding:'HUB_IDENTITY',service:'evora-hub-mcp',entrypoint:'HubIdentityService'};
 require(JSON.stringify(bridge.services)===JSON.stringify([identity]));
 require(JSON.stringify(mcp.services)===JSON.stringify([{binding:'MCP_OAUTH_AUTHORITY',service:'evora-hub-mcp',entrypoint:'HubMcpOAuthService'},identity,{binding:'COLLECTIVE_MCP_READ',service:'evora-collective-mcp-read',entrypoint:'CollectiveMcpReadService'}]));
 if(hub){
  require(hub.name==='evora-hub-mcp'&&hub.main==='server/mcp-production-worker.ts'&&hub.workers_dev===true&&hub.preview_urls===false&&!hub.routes?.length&&hub.observability?.enabled===false&&!hub.services);
  require(hub.vars.HUB_DEPLOYMENT_PROFILE==='mcp'&&hub.vars.HUB_SOCIAL_ENABLED==='0'&&hub.vars.MCP_OAUTH_RESOURCE===MCP_PROD_RESOURCE&&['0','1'].includes(hub.vars.HUB_MCP_OAUTH_ENABLED));
  const config=JSON.parse(hub.vars.HUB_CONFIG);
  require(config.profile==='mcp'&&config.origin===MCP_PROD_HUB&&config.rpId===new URL(MCP_PROD_HUB).hostname&&config.firebase.projectId===MCP_PROD_HUB_PROJECT&&config.firebase.authDomain===MCP_PROD_HUB_PROJECT+'.firebaseapp.com'&&config.collectiveOrigin===new URL(MCP_PROD_RESOURCE).origin&&config.analyticsUrl===null&&!config.localDemo&&!config.emulatorUrl);
  for(const key of['FIREBASE_SERVICE_ACCOUNT','MCP_OAUTH_SIGNING_JWK','MCP_OAUTH_FOUNDER_UID'])require(!(key in hub.vars));
  // The identity HUB never sees the COLLECTIVE data project.
  require(!/evora-athletes/.test(JSON.stringify(hub)));
 }
 for(const cfg of[mcp,bridge,...(hub?[hub]:[])])require(!/evora-mcp-staging|-staging\b|evora-hub-auth-test|throbbing-feather-957f|https:\/\/(?:hub|collective|social)\.evorafitness\.it/.test(JSON.stringify(cfg)));
 return{isolated:true,dataProject:MCP_PROD_DATA_PROJECT,hubProject:MCP_PROD_HUB_PROJECT,flagsEnabled:mcp.vars.MCP_ENABLED==='1',hubConfigChecked:!!hub,webKeySet:hub?!JSON.parse(hub.vars.HUB_CONFIG).firebase.apiKey.startsWith('__'):null};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const read=url=>JSON.parse(fs.readFileSync(url,'utf8'));
 const hubPath=process.argv[2];
 console.log(JSON.stringify(checkProduction(read(new URL('../wrangler.production.jsonc',import.meta.url)),read(new URL('../../../worker/wrangler.mcp-production.jsonc',import.meta.url)),hubPath?read(hubPath):null)));
}
