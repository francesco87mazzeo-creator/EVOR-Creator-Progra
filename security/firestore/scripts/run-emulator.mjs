// Only a demo project and local emulator; no login, deployment or real credentials.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../', import.meta.url));
const cache = process.env.FIREBASE_EMULATORS_PATH || `${cwd}.emulator-cache`;
mkdirSync(cache, { recursive: true });
const env = { ...process.env, FIREBASE_EMULATORS_PATH: cache, CI: 'true' };
for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIRESTORE_EMULATOR_HOST']) delete env[key];
const result = spawnSync(process.execPath, ['node_modules/firebase-tools/lib/bin/firebase.js', 'emulators:exec', '--project', 'demo-evora-security', '--only', 'firestore', '--config', 'firebase.json', 'npm run test:rules'], { cwd, env, stdio: 'inherit' });
if (result.error) console.error(result.error);
process.exit(result.status ?? 1);
