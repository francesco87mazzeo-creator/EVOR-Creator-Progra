import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateKeyPairSync } from 'node:crypto';
import { allowedPromptHashes, prompts } from '../tools/frontend-prompts.mjs';
import { freshWorker, baseEnv, post, mockFetch, anthropicOk, telegramOk, ORIGIN, JPEG, frontendSource, frontendOcrModel, frontendProgram } from './helpers.mjs';

const workerSource = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
const ocr = () => ({ model: frontendOcrModel, max_tokens: 200, messages: [{ role: 'user', content: [
  { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: JPEG } }, { type: 'text', text: prompts.insights }] }] });

/* ---------- Origine e CORS ---------- */
for (const path of ['/', '/ocr', '/notify']) {
  test(`${path}: senza Origin o da un'altra origine → 403, nessuna chiamata esterna`, async () => {
    const worker = await freshWorker();
    const mock = mockFetch(anthropicOk());
    try {
      const missing = await worker.fetch(post(path, ocr(), { origin: null }), baseEnv());
      const foreign = await worker.fetch(post(path, ocr(), { origin: 'https://evil.example' }), baseEnv());
      assert.equal(missing.status, 403);
      assert.equal(foreign.status, 403);
      assert.equal(foreign.headers.get('Access-Control-Allow-Origin'), null, 'origine estranea mai riflessa');
      assert.equal(mock.calls.length, 0);
    } finally { mock.restore(); }
  });

  test(`${path}: ALLOWED_ORIGIN assente → 503 (chiuso per impostazione predefinita)`, async () => {
    const worker = await freshWorker();
    const mock = mockFetch(anthropicOk());
    try {
      const res = await worker.fetch(post(path, ocr()), baseEnv({ ALLOWED_ORIGIN: '' }));
      assert.equal(res.status, 503);
      assert.equal(mock.calls.length, 0);
    } finally { mock.restore(); }
  });
}

test('Preflight: origine consentita 204 con header corretti; origine estranea 403', async () => {
  const worker = await freshWorker();
  const pre = origin => new Request('https://worker.test/', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } });
  const ok = await worker.fetch(pre(ORIGIN), baseEnv());
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.ok(!/x-api-key/i.test(ok.headers.get('Access-Control-Allow-Headers')), 'x-api-key non più ammesso');
  assert.equal((await worker.fetch(pre('https://evil.example'), baseEnv())).status, 403);
});

test('Più origini configurabili separate da virgola', async () => {
  const worker = await freshWorker();
  const mock = mockFetch(anthropicOk());
  try {
    const env = baseEnv({ ALLOWED_ORIGIN: `${ORIGIN}, https://admin.example` });
    assert.equal((await worker.fetch(post('/', ocr(), { origin: 'https://admin.example' }), env)).status, 200);
  } finally { mock.restore(); }
});

test('Metodi diversi da POST → 405; percorso sconosciuto → 404', async () => {
  const worker = await freshWorker();
  assert.equal((await worker.fetch(new Request('https://worker.test/ocr', { method: 'GET', headers: { Origin: ORIGIN } }), baseEnv())).status, 405);
  assert.equal((await worker.fetch(post('/admin', {}), baseEnv())).status, 404);
});

test('Le risposte non sono memorizzabili in cache', async () => {
  const worker = await freshWorker();
  const mock = mockFetch(anthropicOk());
  try {
    const res = await worker.fetch(post('/', ocr()), baseEnv());
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
  } finally { mock.restore(); }
});

/* ---------- /auth: regressione ---------- */
test('/auth invariato: codice valido → custom token Firebase con ruolo; codice errato → 401', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sa = JSON.stringify({ client_email: 'synthetic@demo.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const env = baseEnv({ ADMIN_CODE: 'codice-admin-di-prova', MANAGER_CODE: 'codice-manager-di-prova', FIREBASE_SERVICE_ACCOUNT: sa });
  const worker = await freshWorker();
  const ok = await worker.fetch(post('/auth', { code: 'codice-admin-di-prova' }), env);
  const body = await ok.json();
  assert.equal(ok.status, 200);
  assert.equal(body.role, 'admin');
  const claims = JSON.parse(Buffer.from(body.token.split('.')[1], 'base64url').toString());
  assert.deepEqual(claims.claims, { role: 'admin' });
  assert.equal(claims.uid, 'staff-admin');
  const bad = await worker.fetch(post('/auth', { code: 'sbagliato' }, { ip: '192.0.2.50' }), env);
  assert.equal(bad.status, 401);
});

/* ---------- Contratto con il frontend ---------- */
test('Gli hash dei prompt nel Worker coincidono con i prompt del frontend', () => {
  const inWorker = [...workerSource.matchAll(/\["([0-9a-f]{64})", "([^"]+)"\]/g)].map(m => [m[2], m[1]]);
  assert.deepEqual(Object.fromEntries(inWorker), allowedPromptHashes());
});

test('Modello, programma e limiti del Worker sono coerenti con il frontend', () => {
  assert.match(workerSource, new RegExp(`DEFAULT_OCR_MODEL = "${frontendOcrModel}"`));
  assert.match(workerSource, new RegExp(`const PROGRAM = "${frontendProgram}"`));
  const maxTokens = [...frontendSource.matchAll(/max_tokens:\s*(\d+)/g)].map(m => Number(m[1]));
  assert.deepEqual(maxTokens.sort((a, b) => a - b), [100, 200, 220]);
  assert.ok(Math.max(...maxTokens) <= 256);
  assert.match(frontendSource, /c\.toDataURL\("image\/jpeg", q\)/, 'il frontend invia solo JPEG compressi');
  assert.match(frontendSource, /const MAX_STORED_BYTES = 700000;/);
});

test('Il frontend chiama solo gli endpoint del Worker previsti', () => {
  assert.match(frontendSource, /const OCR_PROXY\s*=\s*WORKER_BASE;/);
  assert.deepEqual([...frontendSource.matchAll(/WORKER_BASE \+ "([^"]+)"/g)].map(m => m[1]).sort(), ['/admin/scoring', '/applications', '/auth', '/notify']);
});

test('Nessun segreto scritto nel codice del Worker', () => {
  assert.ok(!/sk-ant-|BEGIN (RSA )?PRIVATE KEY|\d{8,10}:[A-Za-z0-9_-]{30,}/.test(workerSource));
  assert.ok(!/request\.headers\.get\("x-api-key"\)/.test(workerSource), 'nessuna chiave Anthropic accettata dal client');
});

test('Il Worker non inoltra mai il corpo ricevuto così com\'è', () => {
  assert.ok(!/body:\s*JSON\.stringify\(body\)/.test(workerSource));
});

test('Telegram: nessun dato della richiesta usato come destinatario o token', async () => {
  const worker = await freshWorker();
  const mock = mockFetch(telegramOk());
  try {
    await worker.fetch(post('/notify', { text: '✅ <b>' + frontendProgram + '</b> — canale di notifica attivo.' }), baseEnv());
    assert.equal(mock.calls[0].url, 'https://api.telegram.org/bottest-telegram-token-not-real/sendMessage');
    assert.equal(mock.calls[0].body.chat_id, '-100000');
  } finally { mock.restore(); }
});
