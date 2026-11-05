import fs from'node:fs';import{fileURLToPath}from'node:url';
import{MCP_STAGE_PROJECT,MCP_STAGE_HUB,MCP_STAGE_RESOURCE}from'../../../server/collective/mcp-staging.mjs';
export function checkStaging(mcp,bridge,hub=null){
 const require=(ok)=>{if(!ok)throw Error('STAGING_CONFIG_REJECTED');};
 require(mcp.name==='evora-collective-mcp-staging'&&mcp.main==='src/staging-worker.mjs'&&mcp.workers_dev===true&&mcp.preview_urls===false);
 require(bridge.name==='evora-collective-mcp-read-staging'&&bridge.main==='src/mcp-staging-worker.mjs'&&bridge.workers_dev===false&&bridge.preview_urls===false);
 for(const cfg of[mcp,bridge]){
  require(!cfg.routes?.length&&cfg.vars.MCP_DEPLOYMENT_PROFILE==='staging'&&cfg.vars.FIRESTORE_PROJECT_ID===MCP_STAGE_PROJECT&&cfg.observability?.enabled===false);
  for(const key of['FIREBASE_SERVICE_ACCOUNT','FIRESTORE_SERVICE_ACCOUNT','MCP_PRIVATE_SHARED_KEY','MCP_FOUNDER_UID','MCP_OAUTH_SIGNING_JWK'])require(!(key in cfg.vars));
 }
 require(['0','1'].includes(mcp.vars.MCP_ENABLED)&&mcp.vars.MCP_RESOURCE===MCP_STAGE_RESOURCE&&mcp.vars.MCP_ISSUER===MCP_STAGE_HUB&&mcp.vars.MCP_JWKS_URL===MCP_STAGE_HUB+'/.well-known/jwks.json');
 const identity={binding:'HUB_IDENTITY',service:'evora-hub-mcp-staging',entrypoint:'HubIdentityService'};
 require(JSON.stringify(bridge.services)===JSON.stringify([identity]));
 require(JSON.stringify(mcp.services)===JSON.stringify([{binding:'MCP_OAUTH_AUTHORITY',service:'evora-hub-mcp-staging',entrypoint:'HubMcpOAuthService'},identity,{binding:'COLLECTIVE_MCP_READ',service:'evora-collective-mcp-read-staging',entrypoint:'CollectiveMcpReadService'}]));
 if(hub){
  require(hub.name==='evora-hub-mcp-staging'&&hub.main==='server/mcp-staging-worker.ts'&&hub.workers_dev===true&&hub.preview_urls===false&&!hub.routes?.length&&hub.observability?.enabled===false);
  require(hub.vars.HUB_DEPLOYMENT_PROFILE==='mcp-staging'&&hub.vars.HUB_SOCIAL_ENABLED==='0'&&hub.vars.MCP_OAUTH_RESOURCE===MCP_STAGE_RESOURCE&&['0','1'].includes(hub.vars.HUB_MCP_OAUTH_ENABLED));
  const config=JSON.parse(hub.vars.HUB_CONFIG);
  require(config.profile==='mcp-staging'&&config.origin===MCP_STAGE_HUB&&config.rpId===new URL(MCP_STAGE_HUB).hostname&&config.firebase.projectId===MCP_STAGE_PROJECT&&config.firebase.authDomain===MCP_STAGE_PROJECT+'.firebaseapp.com'&&config.collectiveOrigin===new URL(MCP_STAGE_RESOURCE).origin&&config.analyticsUrl===null&&!config.localDemo&&!config.emulatorUrl);
  for(const key of['FIREBASE_SERVICE_ACCOUNT','MCP_OAUTH_SIGNING_JWK','MCP_OAUTH_FOUNDER_UID'])require(!(key in hub.vars));
 }
 for(const cfg of[mcp,bridge,...(hub?[hub]:[])])require(!/evora-athletes|evora-hub-auth-test|throbbing-feather-957f|https:\/\/(?:hub|collective|social)\.evorafitness\.it/.test(JSON.stringify(cfg)));
 return{isolated:true,projectId:MCP_STAGE_PROJECT,flagsEnabled:mcp.vars.MCP_ENABLED==='1',hubConfigChecked:!!hub};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const read=url=>JSON.parse(fs.readFileSync(url,'utf8'));
 const hubPath=process.argv[2];
 console.log(JSON.stringify(checkStaging(read(new URL('../wrangler.staging.jsonc',import.meta.url)),read(new URL('../../../worker/wrangler.mcp-staging.jsonc',import.meta.url)),hubPath?read(hubPath):null)));
}
