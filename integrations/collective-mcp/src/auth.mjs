// DRAFT resource-server boundary, exercised with synthetic authorities only.
// NOT an implementation of HUB OAuth; default Worker cannot activate this module.
import {jwtVerify, createRemoteJWKSet} from 'jose';

export const READ_SCOPE = 'collective:read';
export const EVALUATE_SCOPE = 'collective:evaluate';
// The only two grants the HUB issues: read alone, or read plus AI-evaluation saving.
const GRANTS = new Set([READ_SCOPE, READ_SCOPE+' '+EVALUATE_SCOPE]);
export const MAX_TOKEN_SECONDS = 300;
export class AccessError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const deny = () => { throw new AccessError(401, 'invalid_token'); };
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
export function configuration(input, {local = false} = {}) {
  const resource = new URL(input.resource), issuer = new URL(input.issuer);
  for (const url of [resource, issuer]) {
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(local && loopback && url.protocol === 'http:'))) throw new AccessError(503, 'configuration_required');
    if (url.hostname.endsWith('.invalid')) throw new AccessError(503, 'configuration_required');
  }
  if (resource.pathname !== '/mcp' || !opaque(input.founderUid) || input.founderUid.startsWith('staff-')) throw new AccessError(503, 'configuration_required');
  return Object.freeze({resource: resource.href, issuer: issuer.href.replace(/\/$/, ''), founderUid: input.founderUid, origin: resource.origin});
}
// The issuer's public JWKS endpoint is configured server-side, never taken from JWT jku/x5u.
export function remoteKeySet(jwksUrl, config) {
  const url = new URL(jwksUrl);
  if (url.protocol !== 'https:' || url.origin !== new URL(config.issuer).origin || url.username || url.password || url.search || url.hash) throw new AccessError(503, 'configuration_required');
  return createRemoteJWKSet(url, {timeoutDuration: 5000, cooldownDuration: 30000});
}
async function privateJson(binding, path, body) {
  if (!binding || typeof binding.fetch !== 'function') throw new AccessError(503, 'authority_unavailable');
  let response;
  try {
    response = await binding.fetch(new Request(path, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body), signal:AbortSignal.timeout(5000)}));
    if (!response.ok) throw new Error();
    const text = await response.text();
    if (text.length > 8192) throw new Error();
    return JSON.parse(text);
  } catch { throw new AccessError(503, 'authority_unavailable'); }
}
export function authorizer({config, keySet, oauthAuthority, hubIdentity, now = Date.now}) {
  return async request => {
    const match = /^Bearer ([A-Za-z0-9_.-]{1,8192})$/.exec(request.headers.get('authorization') || '');
    if (!match) deny();
    let claims;
    try {
      const verified = await jwtVerify(match[1], keySet, {algorithms:['ES256'], typ:'at+jwt', issuer:config.issuer, audience:config.resource, currentDate:new Date(now()), clockTolerance:0, requiredClaims:['sub','exp','iat','jti','scope','hub_version','role']});
      claims = verified.payload;
    } catch { deny(); }
    const time = Math.floor(now()/1000);
    if (claims.aud !== config.resource || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.iat > time || claims.exp - claims.iat > MAX_TOKEN_SECONDS || claims.exp <= claims.iat || !opaque(claims.jti)) deny();
    if (!GRANTS.has(claims.scope)) throw new AccessError(403, 'insufficient_scope');
    // UID is the personal HUB UID, not a client-provided role/email or a shared Firebase UID.
    if (claims.sub !== config.founderUid || claims.role !== 'admin' || !Number.isInteger(claims.hub_version) || claims.hub_version < 1) throw new AccessError(403, 'founder_required');
    // New OAuth authority contract: NOT implemented by the existing HUB SSO service.
    const status = await privateJson(oauthAuthority, 'https://oauth.internal/introspect', {token:match[1], token_type_hint:'access_token'});
    if (status.active !== true || status.sub !== claims.sub || status.aud !== config.resource || status.scope !== claims.scope || status.exp !== claims.exp || status.jti !== claims.jti || status.iss !== config.issuer) deny();
    // Existing private HUB check contract, verified in worker/src/hub-sso.mjs.
    const state = await privateJson(hubIdentity, 'https://hub.internal/internal/collective/check', {uid:claims.sub, role:'admin', version:claims.hub_version});
    const user = state?.user;
    if (!user || user.uid !== config.founderUid || user.role !== 'admin' || user.version !== claims.hub_version) throw new AccessError(403, 'founder_required');
    return Object.freeze({uid:claims.sub, role:claims.role, version:claims.hub_version, scope:claims.scope, scopes:Object.freeze(claims.scope.split(' '))});
  };
}
