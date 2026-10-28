// Igiene del repository: nessun percorso incompatibile con Windows e nessuna password amministrativa nel codice.
// Esecuzione: node --test test/repository/*.test.mjs  (dalla radice; nessuna rete, nessuna dipendenza)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';
import { windowsPathProblems, caseCollisions, scannedForPasswords, hardcodedPasswordFindings } from './hygiene-rules.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

// File tracciati da Git; in una copia senza .git si ricade sui file presenti su disco.
function trackedFiles() {
  if (existsSync(join(root, '.git'))) {
    return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  }
  const out = [];
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules', '.emulator-cache'].includes(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full); else out.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(root);
  return out;
}
const files = trackedFiles();

test('Repository file list is available', () => {
  assert.ok(files.includes('index.html'), 'index.html deve essere presente');
});

test('No tracked path is incompatible with a Windows checkout', () => {
  const bad = files.flatMap(p => windowsPathProblems(p).map(problem => `${JSON.stringify(p)}: ${problem}`));
  assert.deepEqual(bad, []);
});

test('No tracked paths collide on case-insensitive filesystems', () => {
  assert.deepEqual(caseCollisions(files), []);
});

test('The legacy prototype with a trailing-space name is not tracked', () => {
  assert.ok(!files.includes('html '));
});

test('Checked-out text files keep LF line endings, including on Windows', () => {
  assert.match(readFileSync(join(root, '.gitattributes'), 'utf8'), /^\* text=auto eol=lf$/m);
  const crlf = files.filter(p => /\.(html|js|mjs|json|rules|md|yml)$/.test(p) && readFileSync(join(root, p), 'utf8').includes('\r\n'));
  assert.deepEqual(crlf, []);
});

test('No hardcoded admin password or staff code in application code', () => {
  const findings = [];
  for (const p of files.filter(scannedForPasswords)) {
    const text = readFileSync(join(root, p), 'utf8');
    for (const f of hardcodedPasswordFindings(text)) findings.push(`${p}:${f.line} ${f.rule}`);
  }
  assert.deepEqual(findings, []);
});

test('Path rules reject trailing spaces/dots, reserved names and invalid characters', () => {
  for (const p of ['html ', 'docs/a.', 'CON', 'public/aux.js', 'nul.txt', 'LPT1', 'a:b', 'a|b', 'a?b', 'a*b', 'a<b', 'a"b', 'tab\there', 'dir /x'])
    assert.notDeepEqual(windowsPathProblems(p), [], p);
  for (const p of ['index.html', 'public/worker-config.js', 'security/firestore/A1.md', 'console.js', 'auxiliary.md', '.github/workflows/x.yml', 'CNAME'])
    assert.deepEqual(windowsPathProblems(p), [], p);
  assert.deepEqual(caseCollisions(['README.md', 'docs/a.md', 'readme.md']), [['README.md', 'readme.md']]);
});

test('Password rules catch legacy-style admin gates', () => {
  const samples = [
    'const PASS = "synthetic-not-a-secret";',
    'let adminPassword = \'synthetic\';',
    'onClick={() => password === PASS || password === "synthetic" ? ok() : no()}',
    'if ("synthetic" == input.password) open();',
    'login({ user: "x", password: "synthetic" })',
    'DEMO PASSWORD: synthetic',
    'const ADMIN_CODE = "synthetic";',
  ];
  for (const s of samples) assert.equal(hardcodedPasswordFindings(s).length, 1, s);
});

test('Password rules ignore empty state, input types, public Firebase keys and runtime values', () => {
  const clean = [
    'const [password, setPassword] = useState("");',
    '<input type="password" placeholder="Password" value={password}/>',
    'apiKey: "AIzaSy-synthetic-public-web-key", authDomain: "example.firebaseapp.com",',
    'const code = document.getElementById("code").value;',
    'body: JSON.stringify({ code })',
    'if (env.ADMIN_CODE && code === env.ADMIN_CODE) role = "admin";',
    'const passwordField = form.querySelector("input");',
  ];
  for (const s of clean) assert.deepEqual(hardcodedPasswordFindings(s), [], s);
  assert.equal(scannedForPasswords('test/frontend/browser.test.mjs'), false);
  assert.equal(scannedForPasswords('docs/frontend-staging-tests.md'), false);
  assert.equal(scannedForPasswords('index.html'), true);
  assert.equal(scannedForPasswords('html '), true);
});
