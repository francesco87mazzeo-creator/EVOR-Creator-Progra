import worker from './worker.mjs';
export default {fetch(request,env){
 if(env?.MCP_DEPLOYMENT_PROFILE!=='production')return new Response(JSON.stringify({error:'PRODUCTION_PROFILE_REQUIRED'}),{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});
 return worker.fetch(request,env);
}};
