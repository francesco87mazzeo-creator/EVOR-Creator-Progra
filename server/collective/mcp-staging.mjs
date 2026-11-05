// Closed, dedicated MCP staging. Never reuse the HUB test service referenced by live SSO.
export const MCP_STAGE_PROJECT='evora-mcp-staging';
export const MCP_STAGE_HUB='https://evora-hub-mcp-staging.francesco87-mazzeo.workers.dev';
export const MCP_STAGE_RESOURCE='https://evora-collective-mcp-staging.francesco87-mazzeo.workers.dev/mcp';
export function stageEnvironment(env,component){
 if(env.MCP_DEPLOYMENT_PROFILE===undefined){if(env.FIRESTORE_PROJECT_ID===MCP_STAGE_PROJECT||env.MCP_RESOURCE===MCP_STAGE_RESOURCE)throw Error('STAGING_PROFILE_REQUIRED');return false;}
 if(env.MCP_DEPLOYMENT_PROFILE!=='staging'||env.FIRESTORE_PROJECT_ID!==MCP_STAGE_PROJECT)throw Error('STAGING_ISOLATION_REQUIRED');
 if(component==='mcp'&&(env.MCP_RESOURCE!==MCP_STAGE_RESOURCE||env.MCP_ISSUER!==MCP_STAGE_HUB||env.MCP_JWKS_URL!==MCP_STAGE_HUB+'/.well-known/jwks.json'))throw Error('STAGING_ORIGIN_MISMATCH');
 return true;
}
