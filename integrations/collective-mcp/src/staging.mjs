import {boundedText} from './bounded.mjs';
import {MCP_STAGE_PROJECT,MCP_STAGE_HUB} from '../../../server/collective/mcp-staging.mjs';
export async function verifyStagePeer(binding,url,expected,headers={}){
 const response=await binding.fetch(new Request(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:'{}',signal:AbortSignal.timeout(5000)}));
 if(!response.ok)throw Error('STAGING_PEER_UNAVAILABLE');
 const peer=JSON.parse(await boundedText(response,2048));
 if(Object.entries(expected).some(([key,value])=>peer[key]!==value))throw Error('STAGING_PEER_MISMATCH');
}
export async function verifyStageHub(env){
 const expected={profile:'mcp-staging',projectId:MCP_STAGE_PROJECT,origin:MCP_STAGE_HUB};
 await Promise.all([
  verifyStagePeer(env.MCP_OAUTH_AUTHORITY,'https://oauth.internal/stage-info',expected),
  verifyStagePeer(env.HUB_IDENTITY,'https://hub.internal/internal/mcp/stage-info',expected)
 ]);
}
