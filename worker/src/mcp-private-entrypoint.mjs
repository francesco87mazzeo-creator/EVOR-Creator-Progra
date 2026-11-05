import {deploymentProfile}from'../../server/collective/mcp-profiles.mjs';
import {verifyStagePeer}from'../../integrations/collective-mcp/src/staging.mjs';
// Named Cloudflare service-only entrypoint. Never add a public HTTP route for this class.
import {WorkerEntrypoint} from 'cloudflare:workers';
import {createPrivateMcpHandler,createPrivateFirestoreAccess} from './mcp-private-read.mjs';

function unavailable(){return new Response(JSON.stringify({error:'not_configured'}),{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});}
function founderVerifier(env,profile) {
  return async principal => {
    if(!env.HUB_IDENTITY||typeof env.HUB_IDENTITY.fetch!=='function')return false;
    if(profile)await verifyStagePeer(env.HUB_IDENTITY,'https://hub.internal/internal/mcp/stage-info',{profile:profile.hubProfile,projectId:profile.hubProject,origin:profile.hub});
    const req=new Request('https://hub.internal/internal/collective/check',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({uid:principal.uid,role:principal.role,version:principal.version}),
      signal:AbortSignal.timeout(5000)
    });
    const response=await env.HUB_IDENTITY.fetch(req);
    if(!response.ok)return false;
    const body=await response.json();
    return body?.user?.uid===principal.uid&&body.user.role==='admin'&&body.user.version===principal.version;
  };
}
export class CollectiveMcpReadService extends WorkerEntrypoint {
  async fetch(request) {
    try {
      const env=this.env;
      const profile=deploymentProfile(env,'bridge');
      if(!env?.MCP_PRIVATE_SHARED_KEY||!env?.MCP_FOUNDER_UID||!env?.FIREBASE_SERVICE_ACCOUNT||!env?.FIRESTORE_PROJECT_ID)
        return unavailable();
      const account=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
      if(!account?.private_key||!account?.client_email||account.project_id!==env.FIRESTORE_PROJECT_ID)
        return unavailable();
      const readFirestore=createPrivateFirestoreAccess({serviceAccount:account,projectId:env.FIRESTORE_PROJECT_ID});
      const handler=createPrivateMcpHandler({
        secret:env.MCP_PRIVATE_SHARED_KEY,founderUid:env.MCP_FOUNDER_UID,
        // Only an explicit closed profile attests itself; the unpublished prototype never claims production.
        deployment:{profile:profile?profile.name:'unprofiled',projectId:env.FIRESTORE_PROJECT_ID},
        verifyFounder:founderVerifier(env,profile),readFirestore
      });
      return handler(request);
    }catch{return unavailable();}
  }
}
