// Endpoint /admin/scoring: ID token Firebase verificato, ruolo admin, convalida di Codex, scrittura del service account.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import vm from 'node:vm';
import { DEFAULT_SCORING } from '../../server/collective/scoring.mjs';
import { publicFixture } from '../../server/collective/test/frontend-reference.mjs';
import { fromFirestoreValue, __resetTokenCacheForTests } from '../src/firestore.mjs';
import { __resetKeyCacheForTests } from '../src/firebase-id-token.mjs';
import { freshWorker, baseEnv, post, mockFetch, frontendSource, ORIGIN } from './helpers.mjs';

const PROJECT = 'demo-evora-security';
const saKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
const SA = { client_email: `synthetic-writer@${PROJECT}.iam.gserviceaccount.com`, project_id: PROJECT,
  private_key: saKey.export({ type: 'pkcs8', format: 'pem' }) };
const env = (over = {}) => baseEnv({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA), ...over });
const ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

// Chiavi "securetoken" sintetiche: la pubblica è servita dal JWKS simulato, l'altra non è mai pubblicata.
const KID = 'synthetic-kid-1';
const signer = generateKeyPairSync('rsa', { modulusLength: 2048 });
const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...signer.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };

beforeEach(() => { __resetTokenCacheForTests(); __resetKeyCacheForTests(); });

const b64 = obj => Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)).toString('base64url');
const nowS = () => Math.floor(Date.now() / 1000);
/** ID token come lo emette Firebase Auth dopo signInWithCustomToken del token di /auth. */
function idToken(over = {}, { kid = KID, key = signer.privateKey, alg = 'RS256' } = {}) {
  const t = nowS();
  const claims = {
    iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, auth_time: t - 60, user_id: 'staff-admin',
    sub: 'staff-admin', iat: t - 30, exp: t + 3570, role: 'admin',
    firebase: { identities: {}, sign_in_provider: 'custom' }, ...over
  };
  for (const k of Object.keys(over)) if (over[k] === undefined) delete claims[k];
  const head = b64({ alg, kid, typ: 'JWT' }) + '.' + b64(claims);
  return head + '.' + sign('sha256', Buffer.from(head), key).toString('base64url');
}

/** JWKS, OAuth, Firestore (settings/scoring + candidature) e Telegram simulati. */
function services({ jwks = 200, token = 200, write = 200, stored = null } = {}) {
  const state = { stored };
  const mock = mockFetch(({ url, init, body }) => {
    if (url === JWKS_URL) {
      return jwks === 200
        ? new Response(JSON.stringify({ keys: [JWK] }), { status: 200, headers: { 'Cache-Control': 'public, max-age=20000' } })
        : new Response('{}', { status: jwks });
    }
    if (url === 'https://oauth2.googleapis.com/token') {
      return token === 200 ? new Response(JSON.stringify({ access_token: 'ya29.synthetic', expires_in: 3600 }), { status: 200 })
        : new Response('{}', { status: token });
    }
    if (url === `${ROOT}/settings/scoring`) {
      if ((init.method || 'GET') === 'PATCH') {
        if (write !== 200) return new Response('{}', { status: write });
        state.stored = body;
        return new Response(JSON.stringify({ name: 'settings/scoring', ...body }), { status: 200 });
      }
      return state.stored ? new Response(JSON.stringify(state.stored), { status: 200 }) : new Response('{}', { status: 404 });
    }
    if (url.startsWith(`${ROOT}/candidature?documentId=`)) {
      state.lastApplication = body;
      return new Response('{"name":"x"}', { status: 200 });
    }
    if (url.startsWith('https://api.telegram.org/')) return new Response('{"ok":true}', { status: 200 });
    throw new Error(`Chiamata inattesa: ${url}`);
  });
  return Object.assign(mock, { state });
}

function adminPost(body, { auth = 'Bearer ' + idToken(), raw, ...opts } = {}) {
  const headers = { ...(opts.headers || {}) };
  if (auth !== null) headers.Authorization = auth;
  return post('/admin/scoring', body, { ...opts, headers, raw });
}
async function save(body, { req = {}, environment = env(), svc = {}, worker } = {}) {
  worker = worker || await freshWorker();
  const mock = services(svc);
  try {
    const res = await worker.fetch(adminPost(body, req), environment, { waitUntil() {} });
    const text = await res.text();
    return { res, text, json: JSON.parse(text), calls: mock.calls, state: mock.state };
  } finally { mock.restore(); }
}
const patches = calls => calls.filter(c => c.url === `${ROOT}/settings/scoring` && c.init.method === 'PATCH');
const outbound = calls => calls.map(c => c.url);
const config = () => structuredClone(DEFAULT_SCORING);

/** Oggetto `clean` che ScoringPanel.save() invia oggi a FB.saveScoring, ricostruito dal sorgente reale. */
function frontendClean(stored = null, edit = cfg => cfg) {
  const a = frontendSource.indexOf('const SCORING_VERSION');
  const b = frontendSource.indexOf('const bandFor', a);
  const code = frontendSource.slice(a, b) + `
    const cfg = edit(JSON.parse(JSON.stringify(normalizeScoring(stored))));
    const clean = { ...cfg, version: SCORING_VERSION, bands: cfg.bands.map(b=>({ ...b, max: b.max===Infinity ? null : b.max })) };
    JSON.stringify(clean);`;
  return JSON.parse(vm.runInNewContext(code, { stored, edit }));
}

/* ---------- Percorso valido ---------- */
test('Admin salva la configurazione: 200, PATCH completo di settings/scoring, nessun updateMask', async () => {
  const { res, json, calls } = await save(config());
  assert.equal(res.status, 200);
  assert.deepEqual(json, { ok: true, scoring: config() });
  const [p] = patches(calls);
  assert.ok(p, 'scrittura eseguita');
  assert.ok(!p.url.includes('updateMask'), 'sostituzione completa come set()');
  assert.equal(p.init.headers.Authorization, 'Bearer ya29.synthetic', 'scrive il service account, non il browser');
  assert.deepEqual(fromFirestoreValue({ mapValue: p.body }), config());
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('Compatibilità: il payload reale di ScoringPanel.save() (default e "Ripristina") è accettato', async () => {
  const clean = frontendClean(null);
  assert.equal(clean.bands[4].max, null, 'Infinity convertito in null dal pannello');
  const { res, calls } = await save(clean);
  assert.equal(res.status, 200);
  assert.deepEqual(fromFirestoreValue({ mapValue: patches(calls)[0].body }), clean);
});

test('Compatibilità: modifiche tipiche del pannello (pesi decimali, soglie, livelli) salvate come inviate', async () => {
  const clean = frontendClean(null, cfg => {
    cfg.weights = { er: 50.5, reach: 30, growth: 19.5 };
    cfg.levels[0].min = 80; cfg.levels[1].min = 60;
    cfg.bands[2].er = { avg: 2.2, good: 4.4, excellent: 7.7 };
    return cfg;
  });
  const { res, calls } = await save(clean);
  assert.equal(res.status, 200);
  const fields = patches(calls)[0].body.fields;
  assert.deepEqual(fields.weights.mapValue.fields.er, { doubleValue: 50.5 });
  assert.deepEqual(fields.weights.mapValue.fields.reach, { integerValue: '30' }, 'interi come integerValue, come l\'SDK web');
  assert.deepEqual(fields.bands.arrayValue.values[4].mapValue.fields.max, { nullValue: null });
  assert.deepEqual(fromFirestoreValue({ mapValue: patches(calls)[0].body }), clean);
});

test('Dopo il salvataggio /applications usa subito il nuovo scoring nella stessa istanza', async () => {
  const worker = await freshWorker();
  const mock = services();
  try {
    const apply = async ip => worker.fetch(post('/applications', await publicFixture(), { ip }), env(), { waitUntil() {} });
    assert.equal((await apply('198.51.100.1')).status, 201);
    const before = mock.state.lastApplication.fields.socialScore;
    const custom = config();
    custom.weights = { er: 0, reach: 0, growth: 100 };
    assert.equal((await worker.fetch(adminPost(custom), env(), {})).status, 200);
    assert.equal((await apply('198.51.100.2')).status, 201);
    assert.notDeepEqual(mock.state.lastApplication.fields.socialScore, before, 'cache dello scoring invalidata');
  } finally { mock.restore(); }
});

test('Chiavi pubbliche e token di accesso riusati tra due salvataggi', async () => {
  const worker = await freshWorker();
  const mock = services();
  try {
    assert.equal((await worker.fetch(adminPost(config()), env(), {})).status, 200);
    assert.equal((await worker.fetch(adminPost(config(), { ip: '203.0.113.11' }), env(), {})).status, 200);
    assert.equal(mock.calls.filter(c => c.url === JWKS_URL).length, 1);
    assert.equal(mock.calls.filter(c => c.url.startsWith('https://oauth2.')).length, 1);
  } finally { mock.restore(); }
});

test('Turnstile non si applica all\'endpoint amministrativo', async () => {
  const { res, calls } = await save(config(), { environment: env({ TURNSTILE_SECRET: 'synthetic' }) });
  assert.equal(res.status, 200);
  assert.ok(!outbound(calls).some(u => u.includes('turnstile')));
});

/* ---------- Autorizzazione (sicurezza) ---------- */
const authCases = [
  ['header Authorization assente', null, 401, 'AUTH_REQUIRED'],
  ['schema Basic', 'Basic YWRtaW46YWRtaW4=', 401, 'AUTH_REQUIRED'],
  ['codice di accesso al posto del token', 'Bearer codice admin', 401, 'AUTH_REQUIRED'],
  ['token non JWT', 'Bearer abc.def', 401, 'AUTH_INVALID'],
  ['firma di un\'altra chiave con lo stesso kid', () => 'Bearer ' + idToken({}, { key: stranger.privateKey }), 401, 'AUTH_INVALID'],
  ['kid sconosciuto', () => 'Bearer ' + idToken({}, { kid: 'altro' }), 401, 'AUTH_INVALID'],
  ['alg none', () => { const [h, p] = idToken().split('.'); return 'Bearer ' + b64({ alg: 'none', kid: KID }) + '.' + p + '.x'; }, 401, 'AUTH_INVALID'],
  ['alg HS256', () => 'Bearer ' + idToken({}, { alg: 'HS256' }), 401, 'AUTH_INVALID'],
  ['ruolo alterato dopo la firma', () => {
    const [h, , s] = idToken({ role: 'manager' }).split('.');
    const forged = JSON.parse(Buffer.from(idToken().split('.')[1], 'base64url'));
    return 'Bearer ' + h + '.' + b64(forged) + '.' + s;
  }, 401, 'AUTH_INVALID'],
  ['token scaduto', () => 'Bearer ' + idToken({ exp: nowS() - 120, iat: nowS() - 3720 }), 401, 'AUTH_INVALID'],
  ['emesso nel futuro', () => 'Bearer ' + idToken({ iat: nowS() + 600 }), 401, 'AUTH_INVALID'],
  ['altro progetto (aud)', () => 'Bearer ' + idToken({ aud: 'altro-progetto' }), 401, 'AUTH_INVALID'],
  ['emittente errato', () => 'Bearer ' + idToken({ iss: 'https://accounts.google.com' }), 401, 'AUTH_INVALID'],
  ['soggetto mancante', () => 'Bearer ' + idToken({ sub: undefined }), 401, 'AUTH_INVALID'],
  ['sessione oltre 8 ore (auth_time)', () => 'Bearer ' + idToken({ auth_time: nowS() - 8 * 3600 - 120 }), 401, 'AUTH_INVALID'],
  ['ruolo manager', () => 'Bearer ' + idToken({ role: 'manager', sub: 'staff-manager' }), 403, 'FORBIDDEN'],
  ['nessun ruolo (utente qualsiasi del progetto)', () => 'Bearer ' + idToken({ role: undefined, sub: 'u1' }), 403, 'FORBIDDEN'],
  ['ruolo "admin" su un accesso Google, non da /auth', () => 'Bearer ' + idToken({ firebase: { sign_in_provider: 'google.com' } }), 403, 'FORBIDDEN'],
  ['ruolo admin in maiuscolo', () => 'Bearer ' + idToken({ role: 'ADMIN' }), 403, 'FORBIDDEN'],
];
for (const [name, auth, status, code] of authCases) {
  test(`Negato: ${name} → ${status} ${code}, nessuna scrittura`, async () => {
    const { res, json, calls, text } = await save(config(), { req: { auth: typeof auth === 'function' ? auth() : auth } });
    assert.equal(res.status, status);
    assert.deepEqual(json, { ok: false, error: { code, path: '$' } });
    assert.equal(patches(calls).length, 0);
    assert.ok(!outbound(calls).some(u => u.startsWith('https://oauth2.')), 'nessun token di accesso richiesto');
    assert.ok(!/eyJ|ya29/.test(text), 'nessun token nella risposta');
  });
}

test('Senza token il corpo non viene nemmeno letto: JSON rotto o enorme → 401, non 400/413', async () => {
  for (const raw of ['{rotto', 'x'.repeat(200_000)]) {
    const { res, json } = await save(null, { req: { auth: null, raw } });
    assert.equal(res.status, 401);
    assert.equal(json.error.code, 'AUTH_REQUIRED');
  }
});

test('Origine estranea → 403 prima di qualsiasi verifica; ALLOWED_ORIGIN assente → 503', async () => {
  const foreign = await save(config(), { req: { origin: 'https://evil.example' } });
  assert.equal(foreign.res.status, 403);
  assert.equal(foreign.calls.length, 0);
  assert.equal(foreign.res.headers.get('Access-Control-Allow-Origin'), null);
  const unset = await save(config(), { environment: env({ ALLOWED_ORIGIN: '' }) });
  assert.equal(unset.res.status, 503);
  assert.equal(unset.calls.length, 0);
});

test('Chiavi pubbliche non raggiungibili → 503, chiusura in sicurezza', async () => {
  const { res, json, calls } = await save(config(), { svc: { jwks: 500 } });
  assert.equal(res.status, 503);
  assert.equal(json.error.code, 'SERVICE_UNAVAILABLE');
  assert.equal(patches(calls).length, 0);
});

test('Service account mancante → 503 senza chiamate esterne', async () => {
  const { res, json, calls } = await save(config(), { environment: env({ FIREBASE_SERVICE_ACCOUNT: '' }) });
  assert.equal(res.status, 503);
  assert.equal(json.error.code, 'NOT_CONFIGURED');
  assert.equal(calls.length, 0);
});

test('Limite per IP: 31ª richiesta in 10 minuti → 429, anche con token non valido', async () => {
  const worker = await freshWorker();
  const mock = services();
  try {
    for (let i = 0; i < 30; i++) await worker.fetch(adminPost(config(), { auth: 'Bearer x.y.z' }), env(), {});
    const res = await worker.fetch(adminPost(config()), env(), {});
    assert.equal(res.status, 429);
    assert.equal(patches(mock.calls).length, 0);
  } finally { mock.restore(); }
});

test('CORS: il preflight autorizza l\'header Authorization solo per l\'origine consentita', async () => {
  const worker = await freshWorker();
  const pre = origin => new Request('https://worker.test/admin/scoring', { method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type' } });
  const ok = await worker.fetch(pre(ORIGIN), env(), {});
  assert.equal(ok.status, 204);
  assert.match(ok.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  assert.equal(ok.headers.get('Access-Control-Allow-Credentials'), null);
  assert.equal((await worker.fetch(pre('https://evil.example'), env(), {})).status, 403);
});

test('Metodo GET → 405 (la lettura resta tramite SDK e Rules)', async () => {
  const worker = await freshWorker();
  const res = await worker.fetch(new Request('https://worker.test/admin/scoring', { headers: { Origin: ORIGIN } }), env(), {});
  assert.equal(res.status, 405);
});

/* ---------- Convalida della configurazione ---------- */
const bad = (name, mutate, code, path) => [name, mutate, code, path];
const invalidCases = [
  bad('versione precedente', c => { c.version = 1; }, 'VERSION', '$scoring.version'),
  bad('chiave aggiuntiva (tiers)', c => { c.tiers = []; }, 'UNKNOWN_FIELD', '$scoring'),
  bad('metadati di autore inviati dal client', c => { c.updatedBy = 'x'; }, 'UNKNOWN_FIELD', '$scoring'),
  bad('peso come stringa', c => { c.weights.er = '45'; }, 'TYPE', '$scoring.weights.er'),
  bad('pesi tutti a zero', c => { c.weights = { er: 0, reach: 0, growth: 0 }; }, 'RANGE', '$scoring.weights'),
  bad('peso oltre 100', c => { c.weights.er = 101; }, 'RANGE', '$scoring.weights.er'),
  bad('soglia vuota nel pannello (diventa 0)', c => { c.bands[0].er.avg = 0; }, 'ORDER', '$scoring.bands[0].er'),
  bad('soglie non crescenti', c => { c.bands[1].reach = { avg: 50, good: 40, excellent: 160 }; }, 'ORDER', '$scoring.bands[1].reach'),
  bad('livelli non decrescenti', c => { c.levels[1].min = 80; }, 'ORDER', '$scoring.levels[1].min'),
  bad('livello minimo diverso da 0', c => { c.levels[3].min = 5; }, 'RANGE', '$scoring.levels[3].min'),
  bad('livello decimale', c => { c.levels[0].min = 75.5; }, 'TYPE', '$scoring.levels[0].min'),
  bad('colore non esadecimale', c => { c.levels[0].c = 'red'; }, 'FORMAT', '$scoring.levels[0].c'),
  bad('ultima fascia limitata', c => { c.bands[4].max = 1e9; }, 'RANGE', '$scoring.bands[4].max'),
  bad('fascia intermedia illimitata', c => { c.bands[1].max = null; }, 'TYPE', '$scoring.bands[1].max'),
  bad('quattro fasce', c => { c.bands.pop(); }, 'LENGTH', '$scoring.bands'),
  bad('corpo non oggetto', () => [], 'TYPE', '$scoring'),
];
for (const [name, mutate, code, path] of invalidCases) {
  test(`Configurazione rifiutata: ${name} → 400 ${code}, nessuna scrittura`, async () => {
    const c = config();
    const body = mutate(c) || c;
    const { res, json, calls } = await save(body);
    assert.equal(res.status, 400);
    assert.deepEqual(json.error, { code, path });
    assert.equal(patches(calls).length, 0);
  });
}

test('Chiave __proto__ nel JSON rifiutata', async () => {
  const raw = JSON.stringify(config()).replace('{"version"', '{"__proto__":{"admin":true},"version"');
  const { res, json } = await save(null, { req: { raw } });
  assert.equal(res.status, 400);
  assert.equal(json.error.code, 'UNKNOWN_FIELD');
});

test('Corpo oltre 64 KB → 413; Content-Type errato → 415; JSON malformato → 400', async () => {
  assert.equal((await save(null, { req: { raw: '{"a":"' + 'x'.repeat(70_000) + '"}' } })).res.status, 413);
  assert.equal((await save(null, { req: { raw: '{}', headers: { 'Content-Type': 'text/plain' } } })).res.status, 415);
  const broken = await save(null, { req: { raw: '{rotto' } });
  assert.equal(broken.res.status, 400);
  assert.equal(broken.json.error.code, 'INVALID_REQUEST');
});

/* ---------- Guasti dei servizi ---------- */
test('OAuth rifiutato o scrittura Firestore fallita → 503', async () => {
  for (const svc of [{ token: 401 }, { write: 403 }]) {
    const { res, json } = await save(config(), { svc });
    assert.equal(res.status, 503);
    assert.equal(json.error.code, 'SERVICE_UNAVAILABLE');
  }
});
