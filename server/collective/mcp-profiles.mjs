// Closed MCP deployment profiles. Each pins the HUB it trusts, the single MCP resource and the data project.
// The production profile reads evora-athletes only through its own read-only facade Worker.
import {MCP_STAGE_PROJECT,MCP_STAGE_HUB,MCP_STAGE_RESOURCE} from './mcp-staging.mjs';
export const MCP_PROD_HUB='https://evora-hub-mcp.francesco87-mazzeo.workers.dev';
export const MCP_PROD_HUB_PROJECT='evora-hub-mcp';
export const MCP_PROD_RESOURCE='https://evora-collective-mcp.francesco87-mazzeo.workers.dev/mcp';
export const MCP_PROD_DATA_PROJECT='evora-athletes';
export const MCP_PROFILES=Object.freeze({
 staging:Object.freeze({name:'staging',hubProfile:'mcp-staging',hubProject:MCP_STAGE_PROJECT,hub:MCP_STAGE_HUB,resource:MCP_STAGE_RESOURCE,dataProject:MCP_STAGE_PROJECT}),
 production:Object.freeze({name:'production',hubProfile:'mcp',hubProject:MCP_PROD_HUB_PROJECT,hub:MCP_PROD_HUB,resource:MCP_PROD_RESOURCE,dataProject:MCP_PROD_DATA_PROJECT})
});
const PROFILE_RESOURCES=Object.values(MCP_PROFILES).map(p=>p.resource);
/** Returns the closed profile, or null for the unpublished prototype path that declares no profile. */
export function deploymentProfile(env,component){
 if(env?.MCP_DEPLOYMENT_PROFILE===undefined){
  if(env?.FIRESTORE_PROJECT_ID===MCP_STAGE_PROJECT||PROFILE_RESOURCES.includes(env?.MCP_RESOURCE))throw Error('MCP_PROFILE_REQUIRED');
  return null;
 }
 const profile=Object.hasOwn(MCP_PROFILES,env.MCP_DEPLOYMENT_PROFILE)?MCP_PROFILES[env.MCP_DEPLOYMENT_PROFILE]:null;
 if(!profile||env.FIRESTORE_PROJECT_ID!==profile.dataProject)throw Error('MCP_PROFILE_ISOLATION_REQUIRED');
 if(component==='mcp'&&(env.MCP_RESOURCE!==profile.resource||env.MCP_ISSUER!==profile.hub||env.MCP_JWKS_URL!==profile.hub+'/.well-known/jwks.json'))throw Error('MCP_PROFILE_ORIGIN_MISMATCH');
 return profile;
}
