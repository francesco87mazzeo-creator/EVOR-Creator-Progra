import {stageEnvironment}from'../../../server/collective/mcp-staging.mjs';
import {verifyStageHub}from'./staging.mjs';
import {createHandler} from './server.mjs';
import {configuration,authorizer,remoteKeySet} from './auth.mjs';
import {createReader} from './reader.mjs';
import {createPrivateCollectiveChannel} from './private-channel.mjs';

// Factory for local tests with explicitly supplied test authorities/data channels.
// No ambient credentials or HTTP data fallback; use explicit private bindings only.
export function createPrototypeWorker(dependencies) {
  return Object.freeze({fetch:createHandler(dependencies)});
}
// No implicit activation: all services, secrets, issuer and resource must be
// explicitly provided after the combined HUB/COLLECTIVE security review.
const handlers=new WeakMap();
export function createConfiguredMcpWorker(env) {
  const staging=stageEnvironment(env,'mcp');
  const required=['MCP_RESOURCE','MCP_ISSUER','MCP_JWKS_URL','MCP_FOUNDER_UID',
    'MCP_PRIVATE_SHARED_KEY','FIRESTORE_PROJECT_ID'];
  if(required.some(key=>typeof env?.[key]!=='string'||!env[key]))throw Error('MCP_CONFIG_REQUIRED');
  for(const key of ['MCP_OAUTH_AUTHORITY','HUB_IDENTITY','COLLECTIVE_MCP_READ'])
    if(typeof env[key]?.fetch!=='function')throw Error('MCP_BINDING_REQUIRED');
  const config=configuration({resource:env.MCP_RESOURCE,issuer:env.MCP_ISSUER,founderUid:env.MCP_FOUNDER_UID});
  const authorize=authorizer({
    config,keySet:remoteKeySet(env.MCP_JWKS_URL,config),
    oauthAuthority:env.MCP_OAUTH_AUTHORITY,hubIdentity:env.HUB_IDENTITY
  });
  const readerFactory=identity=>createReader({
    projectId:env.FIRESTORE_PROJECT_ID,
    channel:createPrivateCollectiveChannel({
      binding:env.COLLECTIVE_MCP_READ,secret:env.MCP_PRIVATE_SHARED_KEY,
      projectId:env.FIRESTORE_PROJECT_ID,identity,staging
    })
  });
  const handler=createHandler({config,authorize,readerFactory});
  return Object.freeze({async fetch(request){
    if(staging){try{await verifyStageHub(env);}catch{return new Response(JSON.stringify({error:'STAGING_PEER_UNAVAILABLE'}),{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});}}
    return handler(request);
  }});
}
export default {
  async fetch(request,env) {
    if(env?.MCP_ENABLED!=='1')return new Response(JSON.stringify({error:'HUB_AUTHENTICATION_REVIEW_REQUIRED',dataAccessEnabled:false}),{
      status:503,headers:{'content-type':'application/json','cache-control':'no-store'}
    });
    try{
      let handler=handlers.get(env);
      if(!handler){handler=createConfiguredMcpWorker(env);handlers.set(env,handler);}
      return handler.fetch(request);
    }catch{
      return new Response(JSON.stringify({error:'MCP_CONFIGURATION_UNAVAILABLE',dataAccessEnabled:false}),{
        status:503,headers:{'content-type':'application/json','cache-control':'no-store'}
      });
    }
  }
};
