// Integrazione: endpoint /applications = convalida di Codex + Firestore REST + notifica protetta.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { publicFixture, frontendDocument, currentDocument, frontendScore, fullOcr, JPEG } from '../../server/collective/test/frontend-reference.mjs';
import { fromFirestoreValue, __resetTokenCacheForTests } from '../src/firestore.mjs';
import { freshWorker, baseEnv, post, mockFetch, frontendSource } from './helpers.mjs';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = { client_email: 'synthetic-writer@demo-evora-security.iam.gserviceaccount.com', project_id: 'demo-evora-security',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const env = (over = {}) => baseEnv({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA), ...over });
const ROOT = 'https://firestore.googleapis.com/v1/projects/demo-evora-security/databases/(default)/documents';
beforeEach(() => __resetTokenCacheForTests());

/** Google, Firestore e Telegram simulati. `store` contiene i documenti già esistenti. */
function services({ scoring = null, store = new Map(), write = 200, token = 200, telegram = true } = {}) {
  return mockFetch(({ url, init, body }) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      return token === 200
        ? new Response(JSON.stringify({ access_token: 'ya29.synthetic', expires_in: 3600 }), { status: 200 })
        : new Response('{}', { status: token });
    }
    if (url === `${ROOT}/settings/scoring`) {
      if (!scoring) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify({ fields: { ...encode(scoring) } }), { status: 200 });
    }
    if (url.startsWith(`${ROOT}/candidature?documentId=`)) {
      const id = decodeURIComponent(url.split('documentId=')[1]);
      if (write !== 200) return new Response('{}', { status: write });
      if (store.has(id)) return new Response('{"error":{"status":"ALREADY_EXISTS"}}', { status: 409 });
      store.set(id, body);
      return new Response(JSON.stringify({ name: id }), { status: 200 });
    }
    if (url.startsWith('https://api.telegram.org/')) {
      return new Response(JSON.stringify({ ok: telegram }), { status: telegram ? 200 : 400 });
    }
    throw new Error(`Chiamata inattesa: ${url}`);
  });
}
const encode = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, enc(v)]));
const enc = v => v === null ? { nullValue: null } : typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { booleanValue: v }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : { mapValue: { fields: encode(v) } };
const decodeDoc = body => fromFirestoreValue({ mapValue: body });

async function submit(payload, { opts = {}, environment = env(), svc = {} } = {}) {
  const worker = await freshWorker();
  const mock = services(svc);
  const pending = [];
  try {
    const res = await worker.fetch(post('/applications', payload, opts), environment, { waitUntil: p => pending.push(p) });
    await Promise.all(pending);
    const text = await res.text();
    return { res, text, json: JSON.parse(text), calls: mock.calls };
  } finally { mock.restore(); }
}
const writes = calls => calls.filter(c => c.url.includes('/candidature?documentId='));
const tgCalls = calls => calls.filter(c => c.url.startsWith('https://api.telegram.org/'));

/* ---------- Percorso valido ---------- */
test('Candidatura valida: 201, documento di schema 5 (72 campi) con il punteggio v2, ID casuale', async () => {
  const { res, json, calls } = await submit(await publicFixture());
  assert.equal(res.status, 201);
  assert.equal(json.ok, true);
  assert.match(json.id, /^[A-Za-z0-9]{20}$/);
  const [w] = writes(calls);
  assert.equal(w.url, `${ROOT}/candidature?documentId=${json.id}`);
  assert.equal(w.init.headers.Authorization, 'Bearer ya29.synthetic');
  const saved = decodeDoc(w.body);
  const expected = await currentDocument();
  assert.deepEqual(Object.keys(saved).sort(), Object.keys(expected).sort());
  assert.equal(Object.keys(saved).length, 72);
  const { date, updatedAt, ...rest } = saved;
  const { date: _d, updatedAt: _u, ...expectedRest } = expected;
  assert.deepEqual(rest, expectedRest, 'stessi valori del documento storico, con lo scoring v2 al posto del precedente');
  for (const key of ['perfLevel', 'bandLabel', 'erRate', 'reachRate', 'growthRate']) assert.ok(!(key in saved), key);
  assert.equal(saved.status, 'new', 'nessuna decisione automatica');
  assert.equal(date, updatedAt);
  assert.ok(Math.abs(Date.parse(date) - Date.now()) < 60_000, 'data del server');
});

test('I numeri interi sono salvati come integerValue, come fa l\'SDK web', async () => {
  const { calls } = await submit(await publicFixture());
  const f = writes(calls)[0].body.fields;
  assert.deepEqual(f.followers, { integerValue: '8500' });
  assert.deepEqual(f.age, { integerValue: '27' });
  assert.ok('doubleValue' in f.engagementRate || 'integerValue' in f.engagementRate);
  assert.deepEqual(f.scoringVersion, { integerValue: '3' });
  assert.deepEqual(f.accountsReached, { integerValue: '18400' });
  assert.deepEqual(f.evaluation, { mapValue: {} });
  assert.deepEqual(f.status, { stringValue: 'new' });
});

test('Asserzione OAuth: firmata dal service account, scope datastore, durata 1 ora', async () => {
  const { calls } = await submit(await publicFixture());
  const tok = calls.find(c => c.url === 'https://oauth2.googleapis.com/token');
  const form = new URLSearchParams(tok.init.body);
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const claims = JSON.parse(Buffer.from(form.get('assertion').split('.')[1], 'base64url').toString());
  assert.equal(claims.iss, SA.client_email);
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/datastore');
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claims.exp - claims.iat, 3600);
});

test('Il token di accesso viene riusato tra richieste della stessa istanza', async () => {
  const worker = await freshWorker();
  const mock = services();
  try {
    for (let i = 0; i < 3; i++) assert.equal((await worker.fetch(post('/applications', await publicFixture(), { ip: `192.0.2.${i}` }), env(), { waitUntil() {} })).status, 201);
    assert.equal(mock.calls.filter(c => c.url.includes('oauth2')).length, 1);
    assert.equal(mock.calls.filter(c => c.url.endsWith('/settings/scoring')).length, 1, 'scoring in cache per 60 s');
  } finally { mock.restore(); }
});

test('OCR completo con quattro conflitti accettato e salvato', async () => {
  const ocr = fullOcr();
  ocr.ocrInsights.conflicts = ['views', 'netFollowers', 'interactions', 'accountsReached'].map(key => ({ key, valueA: 1, valueB: 2 }));
  const { res, calls } = await submit(await publicFixture(ocr));
  assert.equal(res.status, 201);
  const saved = decodeDoc(writes(calls)[0].body);
  assert.equal(saved.ocrInsights.conflicts.length, 4);
  assert.deepEqual(saved.ocrProfile, ocr.ocrProfile);
});

test('Notifica Telegram con il punteggio v2, inviata una volta dopo il salvataggio', async () => {
  const { calls } = await submit(await publicFixture());
  const sent = tgCalls(calls);
  assert.equal(sent.length, 1);
  const doc = await currentDocument();
  const s = frontendScore(doc);
  const pct = v => v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  assert.equal(sent[0].body.text, [
    '🔔 <b>EVORΛ COLLECTIVE</b>', 'Nuova candidatura', '',
    '👤 <b>Candidato Prova</b>',
    '📱 Instagram: <a href="https://www.instagram.com/profilo_prova/">@profilo_prova</a>',
    '🎵 TikTok: <a href="https://www.tiktok.com/@profilo_prova">@profilo_prova</a>',
    '🏷 Coach / Personal trainer, Creator fitness',
    '👥 ' + (8500).toLocaleString('it-IT') + ' follower', '',
    '👁 Visualizzazioni: 24.800', '💬 Interazioni: ' + (1120).toLocaleString('it-IT'), '📈 Follower netti: +260', '🎯 Account raggiunti: 18.400', '',
    '📊 Punteggio quantitativo: <b>' + s.socialScore + '/100</b> (scoring v2)',
    'Coinvolgimento ' + pct(s.engagementRate) + ' · Indicatore B ' + pct(s.reachEngagementRate) + ' (non incide)'
  ].join('\n'));
  assert.equal(sent[0].body.parse_mode, 'HTML');
  assert.ok(!/ER |Reach |Growth |fascia|Social Performance/.test(sent[0].body.text), 'nessun riferimento al modello precedente');
  assert.ok(calls.indexOf(sent[0]) > calls.indexOf(writes(calls)[0]), 'notifica dopo la scrittura');
});

test('Account raggiunti non indicati: 201, salvati come null (mai zero), indicatore B non disponibile', async () => {
  const { res, calls } = await submit(await publicFixture({ accountsReached: null }));
  assert.equal(res.status, 201);
  const saved = decodeDoc(writes(calls)[0].body);
  assert.equal(saved.accountsReached, null);
  assert.equal(saved.reachEngagementRate, null);
  assert.equal(saved.socialScore, (await currentDocument()).socialScore, 'il punteggio principale non dipende dagli account raggiunti');
  const text = tgCalls(calls)[0].body.text;
  assert.match(text, /🎯 Account raggiunti: non indicati/);
  assert.match(text, /Indicatore B n\/d/);
});

test('Base di osservazione ridotta: segnalata nella notifica, punteggio non corretto', async () => {
  const { res, calls } = await submit(await publicFixture({ views: 400, interactions: 6, accountsReached: 300 }));
  assert.equal(res.status, 201);
  const saved = decodeDoc(writes(calls)[0].body);
  assert.equal(saved.lowBase, true);
  assert.equal(saved.socialScore, frontendScore({ ...saved }).socialScore);
  assert.match(tgCalls(calls)[0].body.text, /⚠️ Base di osservazione molto ridotta$/);
});

test('Un errore Telegram non annulla la candidatura', async () => {
  const { res } = await submit(await publicFixture(), { svc: { telegram: false } });
  assert.equal(res.status, 201);
});

test('Nome con link e menzioni: salvato com\'è, neutralizzato solo nella notifica', async () => {
  const name = 'Promo https://evil.example @admin';
  const { res, calls } = await submit(await publicFixture({ fullName: name }));
  assert.equal(res.status, 201);
  assert.equal(decodeDoc(writes(calls)[0].body).fullName, name);
  const line = tgCalls(calls)[0].body.text.split('\n').find(l => l.startsWith('👤'));
  assert.ok(!/https?:\/\/|evil\.example|@admin/.test(line), line);
});

/* ---------- Scoring del server ---------- */
test('Scoring personalizzato letto da Firestore e applicato come nel frontend', async () => {
  const custom = JSON.parse(JSON.stringify((await import('../../server/collective/scoring.mjs')).DEFAULT_SCORING));
  custom.weights = { engagement: 10, visibility: 90 };
  custom.references.views = 5000;
  const { res, calls } = await submit(await publicFixture(), { svc: { scoring: custom } });
  assert.equal(res.status, 201);
  const saved = decodeDoc(writes(calls)[0].body);
  const doc = await currentDocument();
  assert.equal(saved.socialScore, frontendScore(doc, custom).socialScore);
  assert.notEqual(saved.socialScore, frontendScore(doc).socialScore, 'lo scoring personalizzato cambia davvero il risultato');
});

test('Configurazione del modello precedente ancora su Firestore: ignorata, si applicano i valori predefiniti v2', async () => {
  const old = { version: 2, weights: { er: 45, reach: 35, growth: 20 }, levels: [], bands: [] };
  const { res, calls } = await submit(await publicFixture(), { svc: { scoring: old } });
  assert.equal(res.status, 201);
  const saved = decodeDoc(writes(calls)[0].body);
  assert.equal(saved.socialScore, (await currentDocument()).socialScore);
  assert.equal(saved.scoringVersion, 3);
});

test('Scoring su Firestore non valido → 503, nessuna scrittura', async () => {
  const { res, json, calls } = await submit(await publicFixture(), { svc: { scoring: { version: 3, weights: 'x' } } });
  assert.equal(res.status, 503);
  assert.deepEqual(json, { ok: false, error: { code: 'SERVICE_UNAVAILABLE', path: '$' } });
  assert.equal(writes(calls).length, 0);
});

/* ---------- Rifiuti della convalida (Codex) ---------- */
const invalid = {
  'campo del server (status)': [{ status: 'approved' }, 'SERVER_CONTROLLED_FIELD'],
  'campo del server (socialScore)': [{ socialScore: 100 }, 'SERVER_CONTROLLED_FIELD'],
  'campo sconosciuto': [{ role: 'admin' }, 'UNKNOWN_FIELD'],
  'età 15': [{ age: 15 }, 'RANGE'],
  'età come stringa': [{ age: '27' }, 'TYPE'],
  'email non valida': [{ email: 'non-una-email' }, 'FORMAT'],
  'consenso privacy falso': [{ privacyConsent: false }, 'ENUM'],
  'screenshot non JPEG': [{ screenshotData: 'data:image/png;base64,iVBORw0KGgo=' }, 'FORMAT'],
  'Instagram di un altro sito': [{ instagram: 'https://evil.example/profilo' }, 'FORMAT'],
};
for (const [name, [over, code]] of Object.entries(invalid)) {
  test(`Rifiutata: ${name} → 400 ${code}, nessuna chiamata a Google/Firestore/Telegram`, async () => {
    const { res, json, text, calls } = await submit(await publicFixture(over));
    assert.equal(res.status, 400);
    assert.equal(json.ok, false);
    assert.equal(json.error.code, code);
    assert.equal(calls.length, 0);
    for (const v of Object.values(over)) if (typeof v === 'string' && v.length > 3) assert.ok(!text.includes(v), 'il valore rifiutato non torna nella risposta');
  });
}

test('Campo obbligatorio mancante → 400 MISSING_FIELD con percorso', async () => {
  const { screenshotData, ...rest } = await publicFixture();
  const { res, json } = await submit(rest);
  assert.equal(res.status, 400);
  assert.deepEqual(json.error, { code: 'MISSING_FIELD', path: '$.screenshotData' });
});

test('Documento completo del frontend attuale (71 campi) rifiutato: va inviato il formato pubblico', async () => {
  const { res, json } = await submit(await frontendDocument());
  assert.equal(res.status, 400);
  assert.equal(json.error.code, 'SERVER_CONTROLLED_FIELD');
});

test('JSON malformato e Content-Type errato', async () => {
  assert.equal((await submit(null, { opts: { raw: '{rotto' } })).json.error.code, 'INVALID_JSON');
  assert.equal((await submit(null, { opts: { raw: '{}', headers: { 'Content-Type': 'text/plain' } } })).res.status, 415);
});

test('Corpo oltre 1 MiB rifiutato durante la lettura dello stream (senza Content-Length)', async () => {
  const big = JSON.stringify(await publicFixture({ extra: 'a'.repeat(1_100_000) }));
  const worker = await freshWorker();
  const mock = services();
  try {
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
    const req = new Request('https://worker.test/applications', { method: 'POST', body: stream, duplex: 'half',
      headers: { 'Content-Type': 'application/json', Origin: 'https://collective.evorafitness.it', 'CF-Connecting-IP': '203.0.113.99' } });
    const res = await worker.fetch(req, env(), { waitUntil() {} });
    assert.equal(res.status, 413);
    assert.equal(mock.calls.length, 0);
  } finally { mock.restore(); }
});

/* ---------- Idempotenza ---------- */
test('Stessa Idempotency-Key due volte: un solo documento, una sola notifica, stesso ID', async () => {
  const worker = await freshWorker();
  const store = new Map();
  const mock = services({ store });
  try {
    const send = async () => worker.fetch(post('/applications', await publicFixture(), { headers: { 'Idempotency-Key': 'a1b2c3d4-e5f6-4711-8899-aabbccddeeff' } }), env(), { waitUntil() {} });
    const first = await send(); const firstJson = await first.json();
    const second = await send(); const secondJson = await second.json();
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(secondJson.duplicate, true);
    assert.equal(firstJson.id, secondJson.id);
    assert.equal(store.size, 1);
    assert.equal(tgCalls(mock.calls).length, 1);
  } finally { mock.restore(); }
});

test('Idempotency-Key non valida → 400', async () => {
  const { res, calls } = await submit(await publicFixture(), { opts: { headers: { 'Idempotency-Key': 'x' } } });
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

/* ---------- Guardie e guasti ---------- */
test('Origine assente o estranea → 403; ALLOWED_ORIGIN mancante → 503', async () => {
  assert.equal((await submit(await publicFixture(), { opts: { origin: null } })).res.status, 403);
  assert.equal((await submit(await publicFixture(), { opts: { origin: 'https://evil.example' } })).res.status, 403);
  assert.equal((await submit(await publicFixture(), { environment: env({ ALLOWED_ORIGIN: '' }) })).res.status, 503);
});

test('Limite per IP: 11ª candidatura in un\'ora → 429', async () => {
  const worker = await freshWorker();
  const mock = services();
  try {
    for (let i = 0; i < 10; i++) assert.equal((await worker.fetch(post('/applications', await publicFixture(), { ip: '198.51.100.20' }), env(), { waitUntil() {} })).status, 201);
    assert.equal((await worker.fetch(post('/applications', await publicFixture(), { ip: '198.51.100.20' }), env(), { waitUntil() {} })).status, 429);
  } finally { mock.restore(); }
});

test('Service account mancante → 503 senza chiamate esterne', async () => {
  const { res, calls } = await submit(await publicFixture(), { environment: baseEnv() });
  assert.equal(res.status, 503);
  assert.equal(calls.length, 0);
});

test('Indirizzo Firestore non Google e non locale → 503 (il token non esce verso altri host)', async () => {
  const { res, calls } = await submit(await publicFixture(), { environment: env({ FIRESTORE_BASE_URL: 'https://evil.example' }) });
  assert.equal(res.status, 503);
  assert.equal(calls.length, 0);
});

test('OAuth rifiutato → 503; scrittura Firestore fallita → 503 senza notifica', async () => {
  assert.equal((await submit(await publicFixture(), { svc: { token: 403 } })).res.status, 503);
  const failed = await submit(await publicFixture(), { svc: { write: 500 } });
  assert.equal(failed.res.status, 503);
  assert.equal(tgCalls(failed.calls).length, 0);
});

test('La risposta contiene solo esito e ID, mai i dati della candidatura', async () => {
  const { json } = await submit(await publicFixture());
  assert.deepEqual(Object.keys(json).sort(), ['id', 'ok']);
});

/* ---------- Contratto ---------- */
test('Etichette delle categorie del Worker uguali a CATEGORIES del frontend', async () => {
  const { readFile } = await import('node:fs/promises');
  const worker = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
  const fromFrontend = Object.fromEntries([...frontendSource.matchAll(/\{v:"([a-z_]+)",\s*l:"([^"]+)"\}/g)].filter(m => /creator|coach|agonista|lifestyle|palestra|professionista|altro/.test(m[1])).map(m => [m[1], m[2]]));
  const block = /const CATEGORY_LABELS = \{([\s\S]*?)\};/.exec(worker)[1];
  const fromWorker = Object.fromEntries([...block.matchAll(/([a-z_]+): "([^"]+)"/g)].map(m => [m[1], m[2]]));
  assert.deepEqual(fromWorker, fromFrontend);
});

test('Zero visualizzazioni: 201, zero salvato come dato, punteggio non disponibile (null) anche nella notifica', async () => {
  const { res, calls } = await submit(await publicFixture({ views: 0, interactions: 0 }));
  assert.equal(res.status, 201);
  const saved = decodeDoc(writes(calls)[0].body);
  assert.equal(saved.views, 0);
  assert.equal(saved.socialScore, null);
  assert.equal(saved.engagementRate, null);
  assert.equal(saved.visibilityScore, 0);
  assert.deepEqual(writes(calls)[0].body.fields.socialScore, { nullValue: null });
  const text = tgCalls(calls)[0].body.text;
  assert.match(text, /📊 Punteggio quantitativo: non disponibile \(zero visualizzazioni\)/);
  assert.match(text, /👁 Visualizzazioni: 0/);
});
