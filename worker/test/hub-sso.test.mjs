// EVORΛ HUB SSO on the real COLLECTIVE Worker: private binding, evora-athletes token minted here.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createPublicKey, verify } from 'node:crypto';
import { __resetKeyCacheForTests } from '../src/firebase-id-token.mjs';
import { __resetTokenCacheForTests } from '../src/firestore.mjs';
import { freshWorker, baseEnv, post, mockFetch } from './helpers.mjs';

const PROJECT = 'demo-evora-security';
const saKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
const SA = { client_email: `synthetic-writer@${PROJECT}.iam.gserviceaccount.com`, project_id: PROJECT, private_key: saKey.export({ type: 'pkcs8', format: 'pem' }) };
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const KID = 'synthetic-kid-hub';
const signer = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...signer.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
const UID = 'hub-00112233445566778899aabbccddeeff';
const CODE = Buffer.alloc(32, 7).toString('base64url'), VERIFIER = Buffer.alloc(32, 9).toString('base64url');
const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const nowS = () => Math.floor(Date.now() / 1000);

beforeEach(() => { __resetKeyCacheForTests(); __resetTokenCacheForTests(); });

function idToken(over = {}) {
  const t = nowS();
  const claims = { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, auth_time: t - 60, sub: UID, user_id: UID, iat: t - 30, exp: t + 3570,
    role: 'manager', evoraHub: true, evoraVersion: 1, firebase: { identities: {}, sign_in_provider: 'custom' }, ...over };
  const head = b64({ alg: 'RS256', kid: KID, typ: 'JWT' }) + '.' + b64(claims);
  return head + '.' + sign('sha256', Buffer.from(head), signer.privateKey).toString('base64url');
}

/** Google endpoints (JWKS, OAuth, Identity Toolkit) are mocked; the HUB is a mocked service binding. */
function setup({ hub = {}, binding = true } = {}) {
  const google = mockFetch(({ url }) => {
    if (url === JWKS_URL) return new Response(JSON.stringify({ keys: [JWK] }), { status: 200, headers: { 'Cache-Control': 'public, max-age=20000' } });
    if (url === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: 'ya29.synthetic', expires_in: 3600 }), { status: 200 });
    if (url.endsWith('/accounts:update')) return new Response('{}', { status: 200 });
    return new Response('{}', { status: 599 });
  });
  const rpc = [];
  const HUB_IDENTITY = { fetch: async req => {
    const name = new URL(req.url).pathname.replace('/internal/collective/', ''); const body = await req.json(); rpc.push({ name, body, origin: new URL(req.url).origin });
    const r = hub[name] ?? 200; if (r === 'throw') throw new Error('binding down');
    if (r !== 200) return new Response('{}', { status: r });
    const user = hub.user ?? { uid: UID, role: 'manager', version: 1, displayName: 'Federica' };
    return Response.json(name === 'logout' ? { ok: true } : { user });
  } };
  const env = baseEnv({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA), FIRESTORE_PROJECT_ID: PROJECT, ...(binding ? { HUB_IDENTITY } : {}) });
  return { env, rpc, google, done: () => google.restore() };
}
const bearer = t => ({ headers: { Authorization: 'Bearer ' + t } });
const decode = jwt => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

test('exchange redeems code+verifier through the binding and mints an individual evora-athletes token', async () => {
  const s = setup(); const w = await freshWorker();
  try {
    const r = await w.fetch(post('/hub-sso/exchange', { code: CODE, verifier: VERIFIER }), s.env);
    assert.equal(r.status, 200); const d = await r.json();
    assert.deepEqual(s.rpc, [{ name: 'exchange', body: { code: CODE, verifier: VERIFIER }, origin: 'https://hub.internal' }]);
    const [h, p, sig] = d.customToken.split('.');
    assert.ok(verify('sha256', Buffer.from(h + '.' + p), createPublicKey(saKey), Buffer.from(sig, 'base64url')), 'signed by the evora-athletes service account');
    const payload = decode(d.customToken);
    assert.equal(payload.uid, UID); assert.equal(payload.iss, SA.client_email);
    assert.deepEqual(payload.claims, { role: 'manager', evoraHub: true, evoraVersion: 1 });
    assert.deepEqual(d.user, { uid: UID, role: 'manager', displayName: 'Federica' });
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://collective.evorafitness.it');
  } finally { s.done(); }
});

test('exchange fails closed: no binding, HUB denial, malformed input, foreign origin, unsafe principal', async () => {
  const cases = [
    [{ binding: false }, post('/hub-sso/exchange', { code: CODE, verifier: VERIFIER }), 503, 0],
    [{ hub: { exchange: 403 } }, post('/hub-sso/exchange', { code: CODE, verifier: VERIFIER }), 403, 1],
    [{ hub: { exchange: 'throw' } }, post('/hub-sso/exchange', { code: CODE, verifier: VERIFIER }), 503, 1],
    [{}, post('/hub-sso/exchange', { code: CODE, verifier: 'short' }), 400, 0],
    [{}, post('/hub-sso/exchange', { code: CODE, verifier: VERIFIER, role: 'admin' }), 400, 0],
    [{}, post('/hub-sso/exchange', { code: CODE, verifier: VERIFIER }, { origin: 'https://evil.example' }), 403, 0],
    [{ hub: { user: { uid: 'staff-admin-legacy-uid', role: 'admin', version: 1 } } }, post('/hub-sso/exchange', { code: CODE, verifier: VERIFIER }), 503, 1],
    [{ hub: { user: { uid: UID, role: 'owner', version: 1 } } }, post('/hub-sso/exchange', { code: CODE, verifier: VERIFIER }), 503, 1],
  ];
  for (const [opts, req, status, calls] of cases) {
    const s = setup(opts); const w = await freshWorker();
    try {
      const r = await w.fetch(req, s.env); assert.equal(r.status, status, JSON.stringify(opts));
      assert.equal((await r.json()).customToken, undefined); assert.equal(s.rpc.length, calls);
    } finally { s.done(); }
  }
});

test('status re-checks the exact HUB identity; a denied identity loses its Firebase sessions', async () => {
  let s = setup(); let w = await freshWorker();
  try {
    const r = await w.fetch(post('/hub-sso/status', {}, bearer(idToken())), s.env); assert.equal(r.status, 200);
    assert.deepEqual(s.rpc[0], { name: 'check', body: { uid: UID, role: 'manager', version: 1 }, origin: 'https://hub.internal' });
  } finally { s.done(); }
  s = setup({ hub: { check: 403 } }); w = await freshWorker();
  try {
    const r = await w.fetch(post('/hub-sso/status', {}, bearer(idToken())), s.env); assert.equal(r.status, 403);
    const update = s.google.calls.find(c => c.url.endsWith('/accounts:update'));
    assert.ok(update, 'evora-athletes refresh tokens invalidated'); assert.equal(update.body.localId, UID);
  } finally { s.done(); }
});

test('status rejects legacy, forged, mismatched and unsigned tokens', async () => {
  const s = setup({ hub: { user: { uid: UID, role: 'admin', version: 1 } } }); const w = await freshWorker();
  try {
    assert.equal((await w.fetch(post('/hub-sso/status', {}, bearer(idToken({ evoraHub: undefined, role: 'admin', sub: 'staff-admin' }))), s.env)).status, 403);
    assert.equal((await w.fetch(post('/hub-sso/status', {}, bearer(idToken({ role: 'manager' }))), s.env)).status, 403, 'HUB says admin, token says manager');
    assert.equal((await w.fetch(post('/hub-sso/status', {}, bearer(idToken().slice(0, -4) + 'AAAA')), s.env)).status, 401);
    assert.equal((await w.fetch(post('/hub-sso/status', {}), s.env)).status, 401);
  } finally { s.done(); }
});

test('logout revokes globally in the HUB and this person\'s evora-athletes sessions', async () => {
  const s = setup(); const w = await freshWorker();
  try {
    const r = await w.fetch(post('/hub-sso/logout', {}, bearer(idToken())), s.env); assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, firebaseRevoked: true });
    assert.equal(s.rpc[0].name, 'logout'); assert.equal(s.google.calls.find(c => c.url.endsWith('/accounts:update')).body.localId, UID);
  } finally { s.done(); }
});

test('admin scoring: HUB Manager stays forbidden, HUB denial blocks even an Admin claim', async () => {
  for (const [token, hub, status] of [
    [idToken(), {}, 403],
    [idToken({ role: 'admin' }), { check: 403, user: { uid: UID, role: 'admin', version: 1 } }, 403],
    [idToken({ role: 'admin' }), { check: 'throw' }, 503],
  ]) {
    const s = setup({ hub }); const w = await freshWorker();
    try { assert.equal((await w.fetch(post('/admin/scoring', {}, bearer(token)), s.env)).status, status); } finally { s.done(); }
  }
});

test('legacy /auth emergency login is unchanged and independent of the HUB binding', async () => {
  const s = setup({ binding: false }); const w = await freshWorker();
  try {
    const r = await w.fetch(post('/auth', { code: 'admin-code-not-real' }), { ...s.env, ADMIN_CODE: 'admin-code-not-real' });
    assert.equal(r.status, 200); const d = await r.json(); assert.equal(d.role, 'admin'); assert.equal(decode(d.token).uid, 'staff-admin');
  } finally { s.done(); }
});
