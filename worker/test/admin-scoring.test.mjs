// Endpoint /admin/scoring: ID token Firebase verificato, ruolo admin, convalida di Codex, scrittura del service account.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import vm from 'node:vm';
import scoreLevels from '../../public/score-levels.js';
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
    if (url === `${ROOT}/settings/instagramBenchmarks`) {
      if(write===200)state.benchmarks=body;return new Response(JSON.stringify(body),{status:write});
    }
    if (url === `${ROOT}/settings/scoreLevels`) {
      if(init.method!=='PATCH')return state.levels?new Response(JSON.stringify(state.levels)):new Response('{}',{status:404});
      if(write!==200)return new Response('{}',{status:write});
      state.levels=body;return new Response(JSON.stringify({name:'settings/scoreLevels',...body}));
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

function adminPost(body, { auth = 'Bearer ' + idToken(), raw, path = '/admin/scoring', ...opts } = {}) {
  const headers = { ...(opts.headers || {}) };
  if (auth !== null) headers.Authorization = auth;
  return post(path, body, { ...opts, headers, raw });
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

/**
 * Configurazione che ScoringPanel.save() invia a FB.saveScoring, ricostruita dal sorgente reale:
 * valori del modulo (stringhe, come negli input) → scoringFromDraft.
 */
function frontendClean(stored = null, edit = draft => draft) {
  const part = (start, end) => { const a = frontendSource.indexOf(start), b = frontendSource.indexOf(end, a); assert.ok(a >= 0 && b > a, start); return frontendSource.slice(a, b); };
  const code = part('const SCORING_VERSION', '/* scoring-core:start') + part('const SCORING_FIELDS = [', 'function ScoringPanel(') +
    '\n    const result = scoringFromDraft(edit(toScoringDraft(normalizeScoring(stored))));\n    JSON.stringify(result);';
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
  const { cfg: clean, errors } = frontendClean(null);
  assert.deepEqual(errors, {});
  assert.deepEqual(clean, config(), 'il pannello invia esattamente la configurazione predefinita');
  const { res, calls } = await save(clean);
  assert.equal(res.status, 200);
  assert.deepEqual(fromFirestoreValue({ mapValue: patches(calls)[0].body }), clean);
});

test('Compatibilità: modifiche tipiche del pannello (pesi decimali, riferimenti, soglie) salvate come inviate', async () => {
  const { cfg: clean, errors } = frontendClean(null, d => ({ ...d,
    'weights.engagement': '70.5', 'weights.visibility': '29.5', 'references.engagementRate': '2,5', 'references.views': '50000', 'lowBase.views': '500' }));
  assert.deepEqual(errors, {});
  const { res, calls } = await save(clean);
  assert.equal(res.status, 200);
  const fields = patches(calls)[0].body.fields;
  assert.deepEqual(fields.weights.mapValue.fields.engagement, { doubleValue: 70.5 });
  assert.deepEqual(fields.references.mapValue.fields.views, { integerValue: '50000' }, "interi come integerValue, come l'SDK web");
  assert.deepEqual(fields.references.mapValue.fields.engagementRate, { doubleValue: 2.5 }, 'virgola decimale accettata dal pannello');
  assert.deepEqual(fromFirestoreValue({ mapValue: patches(calls)[0].body }), clean);
});

test('Il pannello non invia campi vuoti come zero: errori per campo e nessuna richiesta', () => {
  for (const key of ['weights.engagement', 'references.engagementRate', 'references.views', 'lowBase.views']) {
    const { errors } = frontendClean(null, d => ({ ...d, [key]: '' }));
    assert.ok(errors[key], key);
  }
  assert.ok(frontendClean(null, d => ({ ...d, 'weights.engagement': '0', 'weights.visibility': '0' })).errors['weights.engagement']);
  assert.ok(frontendClean(null, d => ({ ...d, 'lowBase.interactions': '2.5' })).errors['lowBase.interactions']);
});

test('Una configurazione del modello precedente salvata su Firestore apre il pannello con i valori predefiniti', () => {
  const old = { version: 2, weights: { er: 45, reach: 35, growth: 20 }, levels: [], bands: [] };
  assert.deepEqual(frontendClean(old).cfg, config());
});

test('Dopo il salvataggio /applications usa subito il nuovo scoring nella stessa istanza', async () => {
  const worker = await freshWorker();
  const mock = services();
  try {
    const apply = async ip => worker.fetch(post('/applications', await publicFixture(), { ip }), env(), { waitUntil() {} });
    assert.equal((await apply('198.51.100.1')).status, 201);
    const before = mock.state.lastApplication.fields.socialScore;
    const custom = config();
    custom.weights = { engagement: 0, visibility: 100 };
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
  bad('configurazione del modello precedente (versione 2)', c => { c.version = 2; }, 'VERSION', '$scoring.version'),
  bad('fasce follower del modello precedente', c => { c.bands = []; }, 'UNKNOWN_FIELD', '$scoring'),
  bad('livelli di classificazione del modello precedente', c => { c.levels = []; }, 'UNKNOWN_FIELD', '$scoring'),
  bad('peso come stringa', c => { c.weights.engagement = '65'; }, 'TYPE', '$scoring.weights.engagement'),
  bad('pesi tutti a zero', c => { c.weights = { engagement: 0, visibility: 0 }; }, 'RANGE', '$scoring.weights'),
  bad('peso oltre 100', c => { c.weights.visibility = 101; }, 'RANGE', '$scoring.weights.visibility'),
  bad('coinvolgimento di riferimento zero', c => { c.references.engagementRate = 0; }, 'RANGE', '$scoring.references.engagementRate'),
  bad('visualizzazioni di riferimento zero', c => { c.references.views = 0; }, 'RANGE', '$scoring.references.views'),
  bad('soglia base ridotta decimale', c => { c.lowBase.views = 99.5; }, 'TYPE', '$scoring.lowBase.views'),
  bad('soglia base ridotta mancante', c => { delete c.lowBase.interactions; }, 'MISSING_FIELD', '$scoring.lowBase.interactions'),
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

/* Isolated display settings: shares the existing authentication, never writes scoring/candidates. */
const levelRequest=over=>({path:'/admin/score-levels',...over});
test('Levels: absent document is created, persisted and reread; scoring/candidates remain untouched',async()=>{
 const worker=await freshWorker(),mock=services();
 try{
  const before=mock.state.stored;
  assert.equal(mock.state.levels,undefined);
  const cfg=scoreLevels.defaults();cfg.social[2].label='Synthetic selection';
  const res=await worker.fetch(adminPost(cfg,levelRequest()),env(),{});
  assert.equal(res.status,200);assert.deepEqual((await res.json()).scoreLevels,cfg);
  assert.deepEqual(fromFirestoreValue({mapValue:mock.state.levels}),cfg);
  const second=scoreLevels.defaults();second.metrics[0].label='Synthetic low';
  assert.equal((await worker.fetch(adminPost(second,levelRequest()),env(),{})).status,200);
  assert.deepEqual(fromFirestoreValue({mapValue:mock.state.levels}),second);
  assert.equal(mock.state.stored,before);assert.equal(mock.state.lastApplication,undefined);
  assert.deepEqual(mock.calls.filter(c=>c.init.method==='PATCH').map(c=>c.url),[ROOT+'/settings/scoreLevels',ROOT+'/settings/scoreLevels']);
 }finally{mock.restore();}
});
for(const [name,auth,status]of [
 ['anonymous',null,401],['expired','Bearer '+idToken({exp:nowS()-120}),401],
 ['manager','Bearer '+idToken({role:'manager'}),403],['viewer','Bearer '+idToken({role:'viewer'}),403],
 ['unknown role','Bearer '+idToken({role:'other'}),403],['Google provider','Bearer '+idToken({firebase:{sign_in_provider:'google.com'}}),403]
])test(`Levels: ${name} cannot save`,async()=>{
 const {res,calls}=await save(scoreLevels.defaults(),{req:levelRequest({auth})});
 assert.equal(res.status,status);assert.equal(calls.some(c=>c.init.method==='PATCH'),false);
});
for(const [name,mutate,code]of [
 ['overlap',c=>c.social[1].min=34,'OVERLAP'],['gap',c=>c.metrics[1].min=26,'GAP'],
 ['color injection',c=>c.social[0].color='red; background:url(x)','COLOR'],['extra fields',c=>c.scoring={},'UNKNOWN_FIELD']
])test(`Levels: ${name} rejected before any write`,async()=>{
 const cfg=scoreLevels.defaults();mutate(cfg);
 const {res,json,calls}=await save(cfg,{req:levelRequest()});
 assert.equal(res.status,400);assert.equal(json.error.code,code);assert.equal(calls.some(c=>c.init.method==='PATCH'),false);
});
test('Levels: Firestore failure is 503, never false success',async()=>{
 const {res}=await save(scoreLevels.defaults(),{req:levelRequest(),svc:{write:403}});assert.equal(res.status,503);
});
test('Levels: configured 100-level groups with long UTF-8 labels fit the dedicated bounded request',async()=>{
 const group=prefix=>Array.from({length:100},(_,i)=>({id:prefix+String(i).padStart(39,'0'),label:'界'.repeat(80),color:'#123456',min:i,max:i+1}));
 const cfg={version:1,maxLevels:{social:100,metrics:100},social:group('s'),metrics:group('m')};
 assert.ok(new TextEncoder().encode(JSON.stringify(cfg)).length>64000);
 const {res,state}=await save(cfg,{req:levelRequest()});
 assert.equal(res.status,200);assert.equal(fromFirestoreValue({mapValue:state.levels}).social.length,100);
 const denied=await save(cfg,{req:levelRequest({headers:{'Content-Length':'128001'}})});
 assert.equal(denied.res.status,413);assert.equal(denied.calls.some(c=>c.init.method==='PATCH'),false);
});
test('Levels: limits cannot be increased beyond the structural ceiling',async()=>{
 const cfg=scoreLevels.defaults();cfg.maxLevels.metrics=101;
 const {res,json,calls}=await save(cfg,{req:levelRequest()});
 assert.equal(res.status,400);assert.equal(json.error.code,'MAX_LEVELS');assert.equal(calls.some(c=>c.init.method==='PATCH'),false);
});
test('Levels: preflight includes Authorization, wrong origin denied, no API calls',async()=>{
 const worker=await freshWorker();
 const pre=new Request('https://worker.test/admin/score-levels',{method:'OPTIONS',headers:{Origin:ORIGIN}});
 const res=await worker.fetch(pre,env(),{});assert.equal(res.status,204);assert.match(res.headers.get('Access-Control-Allow-Headers'),/Authorization/);
 const denied=await save(scoreLevels.defaults(),{req:levelRequest({origin:'https://evil.example.test'})});
 assert.equal(denied.res.status,403);assert.equal(denied.calls.length,0);
});

for(const role of ['admin','manager','viewer'])test(`benchmarks: ${role} authorization and isolated persistence`,async()=>{
 const r=await save(scoreLevels.benchmarks.defaults(),{req:{path:'/admin/benchmarks',auth:'Bearer '+idToken({role})}});
 assert.equal(r.res.status,role==='admin'?200:403);
 if(role==='admin'){assert.deepEqual(r.json.benchmarks,scoreLevels.benchmarks.defaults());assert.equal(r.calls.filter(c=>c.url===`${ROOT}/settings/instagramBenchmarks`&&c.init.method==='PATCH').length,1);}
 else assert.equal(r.state.benchmarks,undefined);
 assert.equal(patches(r.calls).length,0);assert.equal(r.state.lastApplication,undefined);
});
test('benchmarks: anonymous and crossed thresholds rejected before writes',async()=>{
 assert.equal((await save({}, {req:{path:'/admin/benchmarks',auth:null}})).res.status,401);
 const c=scoreLevels.benchmarks.defaults();c.engagement[0]=[20,10,40];
 const r=await save(c,{req:{path:'/admin/benchmarks'}});assert.equal(r.res.status,400);assert.equal(r.state.benchmarks,undefined);
});

test('benchmarks: storage error is not success; expired token cannot write',async()=>{
 const c=scoreLevels.benchmarks.defaults();const r=await save(c,{req:{path:'/admin/benchmarks'},svc:{write:503}});assert.equal(r.res.status,503);assert.equal(r.state.benchmarks,undefined);
 const expired=await save(c,{req:{path:'/admin/benchmarks',auth:'Bearer '+idToken({exp:nowS()-60})}});assert.equal(expired.res.status,401);assert.equal(expired.state.benchmarks,undefined);
});
