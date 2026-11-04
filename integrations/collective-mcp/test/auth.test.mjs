import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authorityFixture, bearer, config, NOW} from './helpers.mjs';
import {configuration, remoteKeySet} from '../src/auth.mjs';
// These tests validate the candidate resource-server boundary. They do NOT establish
// that HUB implements this OAuth grant, JWT format or introspection contract.
const cases=[
 ['different admin UID',{sub:'synthetic_other_admin_001'},403],
 ['manager',{role:'manager'},403],['SMM viewer',{role:'viewer'},403],['owner role alone',{role:'owner'},403],
 ['shared legacy UID',{sub:'staff-admin'},403],
 ['wrong issuer',{iss:'https://other.synthetic.test'},401],['wrong audience',{aud:'https://other.synthetic.test/mcp'},401],
 ['multi-audience token',{aud:[config.resource,'https://other.synthetic.test']},401],
 ['write scope',{scope:'collective:write'},403],['mixed scopes',{scope:'collective:read collective:write'},403],
 ['expired',{exp:Math.floor(NOW/1000)-1},401],['future issuance',{iat:Math.floor(NOW/1000)+1},401],
 ['excessive lifetime',{exp:Math.floor(NOW/1000)+301},401],['bad identifier',{jti:'bad'},401],
 ['missing session version',{hub_version:undefined},401],['invalid session version',{hub_version:0},403],
 ['fractional session version',{hub_version:1.5},403],['not-yet-active',{nbf:Math.floor(NOW/1000)+30},401]
];
for(const [name,overrides,status] of cases)test(`DRAFT auth boundary rejects ${name}`,async()=>{
 const f=await authorityFixture();
 const token=await f.token(overrides);await assert.rejects(()=>f.authorize(bearer(token)),error=>error.status===status);
 assert.equal(f.calls.hub,0);assert.equal(f.calls.introspection,0);
});
test('DRAFT auth boundary accepts exact Founder only after grant and current HUB version checks',async()=>{
 const f=await authorityFixture();const result=await f.authorize(bearer(await f.token()));assert.equal(result.uid,config.founderUid);assert.equal(f.calls.hub,1);assert.equal(f.calls.introspection,1);
 f.hub.version++;
 await assert.rejects(async()=>f.authorize(bearer(await f.token())),error=>error.status===503||error.status===403);
});
for(const header of [{typ:'JWT'},{kid:'unknown-key'}])test('DRAFT auth boundary rejects wrong token type or key',async()=>{
 const f=await authorityFixture(),token=await f.token({},header);await assert.rejects(()=>f.authorize(bearer(token)),error=>error.status===401);
});
test('DRAFT auth boundary rejects missing, forged and malformed bearer tokens',async()=>{
 const f=await authorityFixture();for(const request of [new Request(config.resource),bearer('forged'),bearer((await f.token()).slice(0,-10)+'tampered00')])await assert.rejects(()=>f.authorize(request),error=>error.status===401);
 assert.equal(f.calls.hub,0);
});
test('DRAFT auth boundary fails closed on grant revocation, mismatched identity and missing authorities',async()=>{
 const f=await authorityFixture(),token=await f.token();f.setActive(false);await assert.rejects(()=>f.authorize(bearer(token)),e=>e.status===401);f.setActive(true);f.hub.uid='synthetic_other_admin_001';await assert.rejects(()=>f.authorize(bearer(token)),e=>e.status===403||e.status===503);f.setOffline(true);await assert.rejects(()=>f.authorize(bearer(token)),e=>e.status===503);
});
test('resource config is server-controlled, HTTPS and individual-UID only',()=>{
 for(const input of [{...config,founderUid:'staff-admin'},{...config,resource:'https://mcp.synthetic.test/mcp?token=unsafe'},{...config,issuer:'http://public.test'},{...config,resource:'https://mcp.synthetic.test/other'},{...config,issuer:'https://user:password@hub.synthetic.test'}])assert.throws(()=>configuration(input));
 assert.doesNotThrow(()=>configuration({resource:'http://127.0.0.1:8791/mcp',issuer:'http://localhost:8792',founderUid:config.founderUid},{local:true}));
 assert.throws(()=>remoteKeySet('https://evil.test/jwks',config));assert.throws(()=>remoteKeySet('http://hub.synthetic.test/jwks',config));
});
