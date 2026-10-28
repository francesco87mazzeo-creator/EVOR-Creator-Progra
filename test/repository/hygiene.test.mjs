// Igiene del repository: nessun percorso incompatibile con Windows e nessuna password amministrativa nel codice.
// Esecuzione: node --test test/repository/*.test.mjs  (dalla radice; nessuna rete, nessuna dipendenza)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';
// Il controllo password è euristico (vedi hygiene-rules.mjs): non sostituisce un audit dei secret.
import { windowsPathProblems, caseConflicts, scannedForPasswords, sensitiveName, hardcodedPasswordFindings } from './hygiene-rules.mjs';

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

test('No tracked files or directories collide on case-insensitive filesystems', () => {
  assert.deepEqual(caseConflicts(files), []);
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
});

test('Case conflicts cover files, directories and file-versus-directory names', () => {
  assert.deepEqual(caseConflicts(['README.md', 'docs/a.md', 'readme.md']), ['file "README.md" ↔ file "readme.md"']);
  assert.deepEqual(caseConflicts(['Docs/a.md', 'docs/b.md']), ['directory "Docs" ↔ directory "docs"']);
  assert.deepEqual(caseConflicts(['public/App.js', 'Public/app.js/x']), [
    'directory "Public" ↔ directory "public"', 'directory "Public/app.js" ↔ file "public/App.js"']);
  assert.deepEqual(caseConflicts(['docs', 'DOCS/a.md']), ['directory "DOCS" ↔ file "docs"']);
  assert.deepEqual(caseConflicts(['a/b/c.md', 'a/b/d.md', 'a/e.md', 'index.html']), []);
});

test('Password rules catch legacy-style admin gates and their variants', () => {
  const samples = [
    'const PASS = "synthetic-not-a-secret";',
    'let adminPassword = \'synthetic\';',
    'var pwd = `synthetic`;',
    'onClick={() => password === PASS || password === "synthetic" ? ok() : no()}',
    'if ("synthetic" == input.password) open();',
    'if (form.adminPassword !== \'synthetic\') deny();',
    'login({ user: "x", password: "synthetic" })',
    '{ "adminPassword": "synthetic" }',
    'this.passwd = "synthetic";',
    'window.ADMIN_PASSPHRASE = "synthetic";',
    'function unlock({ password = "synthetic" }) {}',
    'const [password, setPassword] = useState("synthetic");',
    'const PASS = "syn" + "thetic";',
    'DEMO PASSWORD: synthetic',
    'Default password: synthetic',
    'const ADMIN_CODE = "synthetic";',
    'const staffCode = "synthetic";',
    'managerCode: \'synthetic\'',
  ];
  for (const s of samples) assert.equal(hardcodedPasswordFindings(s).length, 1, s);
});

test('Password rules follow multiline assignments, properties and comparisons', () => {
  const multiline = [
    ['const ADMIN_PASSWORD =\n  "synthetic";', 1],
    ['const config = {\n  user: "x",\n  password:\n    "synthetic",\n};', 3],
    ['if (\n  password\n  ===\n  "synthetic"\n) ok();', 2],
    ['const [password, setPassword] =\n  useState(\n    "synthetic");', 1],
    ['let ok = 1;\nconst ADMIN_CODE\n  = \'synthetic\';', 2],
  ];
  for (const [s, line] of multiline) assert.deepEqual(hardcodedPasswordFindings(s), [{ line, rule: hardcodedPasswordFindings(s)[0]?.rule }], s);
  const text = 'line1\nconst PASS = "a";\nline3\nDEMO PASSWORD: b\n';
  assert.deepEqual(hardcodedPasswordFindings(text).map(f => f.line), [2, 4]);
});

test('Password rules ignore labels, empty state, input types, public Firebase keys and runtime values', () => {
  const clean = [
    'const passwordLabel = "Password";',
    'const PASSWORD_PLACEHOLDER = "Inserisci la password";',
    'labels: { passwordLabel: "Password", passwordHint: "Almeno 12 caratteri" }',
    'const PASS_KEY = "evora_pass_visible";',
    'const passwordError = "Password errata.";',
    'const [password, setPassword] = useState("");',
    '<input type="password" placeholder="Password" autoComplete="current-password" value={password}/>',
    '<input data-password="masked" name="password"/>',
    'if (input.type === "password") toggle();',
    'apiKey: "AIzaSy-synthetic-public-web-key", authDomain: "example.firebaseapp.com",',
    'const code = document.getElementById("code").value;',
    'body: JSON.stringify({ code })',
    'if (env.ADMIN_CODE && code === env.ADMIN_CODE) role = "admin";',
    'const passwordField = form.querySelector("input");',
    'const password = await askUser();',
    'const bypass = "yes"; const compass = "N"; const passport = "IT";',
    'creatorCode: "",',
    'const shown = ok ? password : "••••";',
    '<button>Admin password: inserisci il codice</button>',
  ];
  for (const s of clean) assert.deepEqual(hardcodedPasswordFindings(s), [], s);
  assert.equal(sensitiveName('passwordLabel'), false);
  assert.equal(sensitiveName('form.adminPassword'), true);
  assert.equal(sensitiveName('ADMIN_CODE'), true);
  assert.equal(sensitiveName('creatorCode'), false);
  assert.equal(scannedForPasswords('test/frontend/browser.test.mjs'), false);
  assert.equal(scannedForPasswords('docs/frontend-staging-tests.md'), false);
  assert.equal(scannedForPasswords('index.html'), true);
  assert.equal(scannedForPasswords('html '), true);
});
