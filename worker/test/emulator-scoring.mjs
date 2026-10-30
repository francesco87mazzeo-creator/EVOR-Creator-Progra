// Prova /admin/scoring con il vero Firestore Emulator (progetto demo, loopback). Non fa parte di `npm test`.
// Le chiavi securetoken sono sintetiche e servite da un JWKS simulato; Firestore è reale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { DEFAULT_SCORING, computeScore } from '../../server/collective/scoring.mjs';
import scoreLevels from '../../public/score-levels.js';
import { publicFixture } from '../../server/collective/test/frontend-reference.mjs';
import { fromFirestoreValue, toFirestoreDocument } from '../src/firestore.mjs';
import { freshWorker, baseEnv, post } from './helpers.mjs';

const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.equal(host, '127.0.0.1:8089', 'solo Emulator locale');
const PROJECT = 'demo-evora-security';
const BASE = `http://${host}`;
const ROOT = `${BASE}/v1/projects/${PROJECT}/databases/(default)/documents`;
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const sa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
const securetoken = generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = baseEnv({
  FIRESTORE_BASE_URL: BASE,
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ client_email: `synthetic@${PROJECT}.iam.gserviceaccount.com`,
    project_id: PROJECT, private_key: sa.export({ type: 'pkcs8', format: 'pem' }) }),
});

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) === JWKS_URL) return new Response(JSON.stringify({ keys: [{ ...securetoken.publicKey.export({ format: 'jwk' }), kid: 'k1' }] }));
  if (String(url).startsWith('https://api.telegram.org/')) return new Response('{"ok":true}');
  if (!String(url).startsWith(BASE)) throw new Error(`Uscita non ammessa nel test: ${url}`);
  return realFetch(url, init);
};
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken(role) {
  const t = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', kid: 'k1' }) + '.' + b64({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT,
    sub: 'staff-' + role, auth_time: t - 60, iat: t - 30, exp: t + 3500, role, firebase: { sign_in_provider: 'custom' } });
  return head + '.' + sign('sha256', Buffer.from(head), securetoken.privateKey).toString('base64url');
}
const saveScoring = (worker, cfg, role, ip) => worker.fetch(post('/admin/scoring', cfg,
  { ip, headers: { Authorization: 'Bearer ' + idToken(role) } }), env, {});
const readScoring = async () => {
  const r = await realFetch(`${ROOT}/settings/scoring`, { headers: { Authorization: 'Bearer owner' } });
  return r.status === 404 ? null : fromFirestoreValue({ mapValue: { fields: (await r.json()).fields } });
};

test('Emulator: admin salva lo scoring, il documento riletto è identico e /applications lo applica', async () => {
  const worker = await freshWorker();
  const cfg = structuredClone(DEFAULT_SCORING);
  cfg.weights = { engagement: 10.5, visibility: 89.5 };
  cfg.references.views = 5000;
  const res = await saveScoring(worker, cfg, 'admin', '192.0.2.90');
  assert.equal(res.status, 200);
  assert.deepEqual(await readScoring(), cfg);

  const app = await worker.fetch(post('/applications', await publicFixture(), { ip: '192.0.2.91' }), env, { waitUntil() {} });
  assert.equal(app.status, 201);
  const { id } = await app.json();
  const r = await realFetch(`${ROOT}/candidature/${id}`, { headers: { Authorization: 'Bearer owner' } });
  const saved = fromFirestoreValue({ mapValue: { fields: (await r.json()).fields } });
  assert.equal(saved.socialScore, computeScore(saved, cfg).socialScore);
  assert.notEqual(saved.socialScore, computeScore(saved, null).socialScore, 'score diverso da quello predefinito');
});

test('Emulator: manager e token alterato non modificano il documento', async () => {
  const worker = await freshWorker();
  const before = await readScoring();
  const changed = structuredClone(DEFAULT_SCORING);
  changed.weights = { engagement: 100, visibility: 0 };
  assert.equal((await saveScoring(worker, changed, 'manager', '192.0.2.92')).status, 403);
  const forged = idToken('manager').split('.');
  forged[1] = b64({ ...JSON.parse(Buffer.from(forged[1], 'base64url')), role: 'admin' });
  const res = await worker.fetch(post('/admin/scoring', changed,
    { ip: '192.0.2.93', headers: { Authorization: 'Bearer ' + forged.join('.') } }), env, {});
  assert.equal(res.status, 401);
  assert.deepEqual(await readScoring(), before);
});

test('Emulator: scoreLevels is created/replaced independently, scoring and candidates unchanged',async()=>{
  const worker=await freshWorker(),scoringBefore=await readScoring();
  const candidatesBefore=await (await realFetch(`${ROOT}/candidature`,{headers:{Authorization:'Bearer owner'}})).json();
  await realFetch(`${ROOT}/settings/scoreLevels`,{method:'DELETE',headers:{Authorization:'Bearer owner'}});
  assert.equal((await realFetch(`${ROOT}/settings/scoreLevels`,{headers:{Authorization:'Bearer owner'}})).status,404);
  const cfg=scoreLevels.defaults();cfg.social[2].label='Synthetic emulator classification';
  const request=(role,body)=>post('/admin/score-levels',body,{ip:'192.0.2.99',headers:{Authorization:'Bearer '+idToken(role)}});
  assert.equal((await worker.fetch(request('admin',cfg),env,{})).status,200);
  const read=async()=>{
    const response=await realFetch(`${ROOT}/settings/scoreLevels`,{headers:{Authorization:'Bearer owner'}});
    assert.equal(response.status,200);return fromFirestoreValue({mapValue:{fields:(await response.json()).fields}});
  };
  assert.deepEqual(await read(),cfg);
  cfg.metrics[0].label='Synthetic replacement';
  assert.equal((await worker.fetch(request('admin',cfg),env,{})).status,200);
  assert.deepEqual(await read(),cfg);
  assert.equal((await worker.fetch(request('manager',scoreLevels.defaults()),env,{})).status,403);
  assert.equal((await worker.fetch(request('viewer',scoreLevels.defaults()),env,{})).status,403);
  assert.deepEqual(await read(),cfg);assert.deepEqual(await readScoring(),scoringBefore);
  const candidatesAfter=await (await realFetch(`${ROOT}/candidature`,{headers:{Authorization:'Bearer owner'}})).json();
  assert.deepEqual(candidatesAfter,candidatesBefore);
});

test('Emulator: benchmarks are created/replaced independently, scoring and candidates unchanged',async()=>{
  const worker=await freshWorker(),scoringBefore=await readScoring();
  const candidatesBefore=await (await realFetch(`${ROOT}/candidature`,{headers:{Authorization:'Bearer owner'}})).json();
  await realFetch(`${ROOT}/settings/instagramBenchmarks`,{method:'DELETE',headers:{Authorization:'Bearer owner'}});
  assert.equal((await realFetch(`${ROOT}/settings/instagramBenchmarks`,{headers:{Authorization:'Bearer owner'}})).status,404);
  const cfg=scoreLevels.benchmarks.defaults();cfg.reach[2][0]=31;
  const request=(role,body)=>post('/admin/benchmarks',body,{ip:'192.0.2.100',headers:{Authorization:'Bearer '+idToken(role)}});
  assert.equal((await worker.fetch(request('admin',cfg),env,{})).status,200);
  const read=async()=>{
    const response=await realFetch(`${ROOT}/settings/instagramBenchmarks`,{headers:{Authorization:'Bearer owner'}});
    assert.equal(response.status,200);const stored=fromFirestoreValue({mapValue:{fields:(await response.json()).fields}});assert.equal(stored.storageFormat,'named-thresholds-v1');return scoreLevels.benchmarks.fromDocument(stored);
  };
  assert.deepEqual(await read(),cfg);
  cfg.growth[2][0]=0.35;
  assert.equal((await worker.fetch(request('admin',cfg),env,{})).status,200);
  assert.deepEqual(await read(),cfg);
  assert.equal((await worker.fetch(request('manager',scoreLevels.benchmarks.defaults()),env,{})).status,403);
  assert.equal((await worker.fetch(request('viewer',scoreLevels.benchmarks.defaults()),env,{})).status,403);
  assert.deepEqual(await read(),cfg);assert.deepEqual(await readScoring(),scoringBefore);
  const candidatesAfter=await (await realFetch(`${ROOT}/candidature`,{headers:{Authorization:'Bearer owner'}})).json();
  assert.deepEqual(candidatesAfter,candidatesBefore);
});

test('Emulator: legacy custom benchmark values survive explicit v2 migration and old-client saves',async()=>{
 const B=scoreLevels.benchmarks,legacy={...B.defaults(),interpolation:'log-smoothstep-v1'};legacy.engagement[2]=[900,906,918];legacy.reach[0]=[61,122,255];
 const scoringBefore=await readScoring();
 const seed=await realFetch(`${ROOT}/settings/instagramBenchmarks`,{method:'PATCH',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify(toFirestoreDocument(B.toDocument(legacy)))});assert.equal(seed.status,200);
 const read=async()=>{const r=await realFetch(`${ROOT}/settings/instagramBenchmarks`,{headers:{Authorization:'Bearer owner'}});assert.equal(r.status,200);return B.fromDocument(fromFirestoreValue({mapValue:{fields:(await r.json()).fields}}));};
 assert.deepEqual(await read(),legacy);
 const worker=await freshWorker(),request=cfg=>post('/admin/benchmarks',cfg,{ip:'192.0.2.101',headers:{Authorization:'Bearer '+idToken('admin')}}),upgraded=B.upgrade(legacy);
 assert.deepEqual(await read(),legacy,'loading a new Worker never rewrites saved values');
 assert.equal((await worker.fetch(request(upgraded),env,{})).status,200);assert.deepEqual(await read(),upgraded);
 assert.equal((await worker.fetch(request(legacy),env,{})).status,200);assert.deepEqual(await read(),legacy,'previous payload method remains accepted');
 assert.deepEqual(await readScoring(),scoringBefore);
});
