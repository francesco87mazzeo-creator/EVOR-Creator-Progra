import {createServer} from 'node:http';
import worker from './worker.mjs';
// Deliberately loopback-only and fail-closed. No login, synthetic bearer printed to the
// terminal, ambient credential loading, production fallback or live data channel.
const port=Number(process.env.PORT || 8791);
if (!Number.isInteger(port)||port<1024||port>65535) throw new Error('Invalid local port');
const server=createServer(async (request,response)=>{
  const result=await worker.fetch(new Request(`http://127.0.0.1:${port}/mcp`,{method:'GET'}));
  response.writeHead(result.status,{...Object.fromEntries(result.headers),connection:'close'});response.end(await result.text());
});
server.listen(port,'127.0.0.1',()=>console.log(`Local MCP prototype: http://127.0.0.1:${port}/mcp — BLOCKED pending HUB authentication review. Run npm test for the isolated MCP tool simulation.`));
