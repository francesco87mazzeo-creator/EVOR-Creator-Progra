// Deployment wrapper: existing public Worker stays identical.
// This module only adds a named service-binding entrypoint for MCP.
export {default} from './worker.js';
export {CollectiveMcpReadService} from './mcp-private-entrypoint.mjs';
