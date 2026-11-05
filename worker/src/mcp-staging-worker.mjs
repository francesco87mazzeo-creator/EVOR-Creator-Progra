// Staging-only service entrypoint: cannot fall back to a production environment.
import {CollectiveMcpReadService as Base}from'./mcp-private-entrypoint.mjs';
export class CollectiveMcpReadService extends Base{
 async fetch(request){if(this.env?.MCP_DEPLOYMENT_PROFILE!=='staging')return new Response(null,{status:503});return super.fetch(request);}
}
export default {fetch(){return new Response(null,{status:404});}};
