// Local demo project only. No login, deployment, real credentials or proxy changes.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expressionBudgetExceeded, currentLogText } from './emulator-diagnostics.mjs';
const cwd = fileURLToPath(new URL('../', import.meta.url));
const cache = process.env.FIREBASE_EMULATORS_PATH || `${cwd}.emulator-cache`;
mkdirSync(cache, { recursive: true });
const env = { ...process.env, FIREBASE_EMULATORS_PATH: cache, CI: 'true', EVORA_DIAGNOSTICS_GUARD: '1' };
for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIRESTORE_EMULATOR_HOST']) delete env[key];
const logs = ['firestore-debug.log', 'firebase-debug.log'];
const read = name => { try { return readFileSync(`${cwd}${name}`, 'utf8'); } catch { return ''; } };
const previous = new Map(logs.map(name => [name, read(name)]));
// Explicit offline option for environments where downloading has been prohibited.
if (process.env.EVORA_EMULATOR_OFFLINE === '1' &&
    !existsSync(`${cache}/cloud-firestore-emulator-v1.22.0.jar`)) {
  console.error('Emulator v1.22.0 is not cached. Offline mode: no download attempted; rules tests NOT RUN.');
  process.exit(2);
}
let exhausted = false;
const tails = { stdout: '', stderr: '' };
function inspect(stream, chunk) {
  const text = tails[stream] + chunk.toString();
  exhausted ||= expressionBudgetExceeded(text);
  tails[stream] = text.slice(-8192);
}
const child = spawn(process.execPath, ['node_modules/firebase-tools/lib/bin/firebase.js', 'emulators:exec', '--project', 'demo-evora-security', '--only', 'firestore', '--config', 'firebase.json', 'npm run test:rules'], { cwd, env, stdio: ['inherit', 'pipe', 'pipe'] });
child.stdout.on('data', chunk => { process.stdout.write(chunk); inspect('stdout', chunk); });
child.stderr.on('data', chunk => { process.stderr.write(chunk); inspect('stderr', chunk); });
child.on('error', error => { console.error(error.message); });
child.on('close', code => {
  let currentFirestoreLog = false;
  for (const name of logs) {
    const current = currentLogText(previous.get(name), read(name));
    if (name === 'firestore-debug.log' && current.length > 0) currentFirestoreLog = true;
    exhausted ||= expressionBudgetExceeded(current);
  }
  if (exhausted) console.error('INVALID SECURITY RESULT: expression budget exhausted. Expected denials are not accepted as proof of validation.');
  if (code === 0 && !currentFirestoreLog) console.error('INVALID SECURITY RESULT: no current Firestore emulator log available to check evaluation errors.');
  process.exit(exhausted || (code === 0 && !currentFirestoreLog) ? 1 : (code ?? 1));
});
