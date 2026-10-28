// Prova con il vero Firestore Emulator (progetto demo, loopback). Non fa parte di `npm test`:
// si avvia con `firebase emulators:exec` (vedi README). Telegram è simulato; Firestore no.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { publicFixture, currentDocument, fullOcr } from '../../server/collective/test/frontend-reference.mjs';
import { fromFirestoreValue } from '../src/firestore.mjs';
import { freshWorker, baseEnv, post } from './helpers.mjs';

const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.equal(host, '127.0.0.1:8089', 'solo Emulator locale');
const BASE = `http://${host}`;
const ROOT = `${BASE}/v1/projects/demo-evora-security/databases/(default)/documents`;
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = baseEnv({
  FIRESTORE_BASE_URL: BASE,
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'synthetic@demo-evora-security.iam.gserviceaccount.com',
    project_id: 'demo-evora-security', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }),
});

const realFetch = globalThis.fetch;
const telegram = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.telegram.org/')) { telegram.push(JSON.parse(init.body)); return new Response('{"ok":true}'); }
  if (!String(url).startsWith(BASE)) throw new Error(`Uscita non ammessa nel test: ${url}`);
  return realFetch(url, init);
};
const readBack = async id => {
  const r = await realFetch(`${ROOT}/candidature/${id}`, { headers: { Authorization: 'Bearer owner' } });
  assert.equal(r.status, 200);
  return fromFirestoreValue({ mapValue: { fields: (await r.json()).fields } });
};

test('Emulator: candidatura scritta via REST e riletta identica al documento del frontend', async () => {
  const worker = await freshWorker();
  const res = await worker.fetch(post('/applications', await publicFixture()), env, { waitUntil() {} });
  assert.equal(res.status, 201);
  const { id } = await res.json();
  const saved = await readBack(id);
  const { date, updatedAt, ...rest } = saved;
  const { date: _d, updatedAt: _u, ...expected } = await currentDocument();
  assert.equal(Object.keys(saved).length, 72);
  assert.deepEqual(rest, expected);
  assert.equal(telegram.length, 1);
});

test('Emulator: OCR completo con quattro conflitti salvato e riletto', async () => {
  const worker = await freshWorker();
  const ocr = fullOcr();
  ocr.ocrInsights.conflicts = ['views', 'netFollowers', 'interactions', 'accountsReached'].map(key => ({ key, valueA: 1, valueB: 2.5 }));
  const res = await worker.fetch(post('/applications', await publicFixture(ocr), { ip: '192.0.2.77' }), env, { waitUntil() {} });
  assert.equal(res.status, 201);
  const saved = await readBack((await res.json()).id);
  assert.deepEqual(saved.ocrInsights, ocr.ocrInsights);
  assert.deepEqual(saved.ocrProfile, ocr.ocrProfile);
});

test('Emulator: stessa Idempotency-Key → nessuna sovrascrittura, un solo documento', async () => {
  const worker = await freshWorker();
  const send = async name => worker.fetch(post('/applications', await publicFixture({ fullName: name }),
    { ip: '192.0.2.78', headers: { 'Idempotency-Key': 'emulator-key-0000-1111-2222' } }), env, { waitUntil() {} });
  const first = await send('Primo invio');
  const second = await send('Secondo invio con altro nome');
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  const { id } = await second.json();
  assert.equal((await readBack(id)).fullName, 'Primo invio', 'il secondo invio non ha sovrascritto il primo');
});
