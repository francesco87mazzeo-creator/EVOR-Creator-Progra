import {createHandler} from './server.mjs';

// Factory for local tests with explicitly supplied test authorities/data channels.
// No production wiring: the HUB repository is inaccessible with the current connection.
export function createPrototypeWorker(dependencies) {
  return Object.freeze({fetch:createHandler(dependencies)});
}
export default {
  async fetch() {
    return new Response(JSON.stringify({error:'HUB_AUTHENTICATION_REVIEW_REQUIRED',dataAccessEnabled:false}),{
      status:503,headers:{'content-type':'application/json','cache-control':'no-store'}
    });
  }
};
