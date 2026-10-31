import {test}from'node:test';
import assert from'node:assert/strict';
import {authorizeHubToken,proxyHubSso}from'../src/hub-sso.mjs';
test('HUB authority is mandatory for a HUB token: no legacy fallback',async()=>{
 await assert.rejects(authorizeHubToken({},'fake'),e=>e.status===503);
 await assert.rejects(authorizeHubToken({HUB_IDENTITY:{fetch:async()=>new Response('{}',{status:403})}},'fake'),e=>e.status===403);
});
test('private authorization validates principal schema and role',async()=>{
 const result={user:{uid:'individual-user',role:'manager',enabled:true,version:2}};
 const env={HUB_IDENTITY:{fetch:async req=>{assert.equal(new URL(req.url).pathname,'/internal/authorize');assert.equal((await req.json()).token,'unit-only');return Response.json(result);}}};
 assert.equal((await authorizeHubToken(env,'unit-only')).user.role,'manager');
 await assert.rejects(authorizeHubToken({HUB_IDENTITY:{fetch:async()=>Response.json({user:{...result.user,role:'owner'}})}},'unit-only'));
});
test('SSO proxy is same-origin and dormant without binding',async()=>{
 assert.equal((await proxyHubSso(new Request('https://collective.evorafitness.it/admin/hub-sso/start'),{})).status,503);
 assert.equal((await proxyHubSso(new Request('https://evil.example/admin/hub-sso/start'),{})).status,403);
 assert.equal((await proxyHubSso(new Request('https://collective.evorafitness.it/admin/hub-sso/unknown'),{})).status,403);
});
test('SSO proxy preserves callback cookie and redirect without touching other routes',async()=>{
 const env={HUB_COLLECTIVE:{fetch:async()=>new Response(null,{status:303,headers:{location:'https://hub.evorafitness.it/authorize','set-cookie':'__Host-test=opaque; Secure; HttpOnly; Path=/; SameSite=Lax'}})}};
 const r=await proxyHubSso(new Request('https://collective.evorafitness.it/admin/hub-sso/start'),env);assert.equal(r.status,303);assert.match(r.headers.get('set-cookie'),/HttpOnly/);
});
