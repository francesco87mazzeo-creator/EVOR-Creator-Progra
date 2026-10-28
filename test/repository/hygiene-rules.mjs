// Regole di igiene del repository, senza dipendenze: percorsi compatibili con Windows e
// assenza di password amministrative scritte nel codice. Usate da hygiene.test.mjs.

const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
const INVALID_CHARS = /[<>:"|?*\\\u0000-\u001f]/;

// Problemi di un singolo percorso (separatore "/") che impediscono il checkout su Windows.
export function windowsPathProblems(path) {
  const problems = [];
  for (const part of path.split('/')) {
    if (/[ .]$/.test(part)) problems.push(`"${part}" termina con spazio o punto`);
    if (RESERVED.test(part)) problems.push(`"${part}" è un nome riservato di Windows`);
    if (INVALID_CHARS.test(part)) problems.push(`"${part}" contiene un carattere non valido su Windows`);
  }
  return problems;
}

// Percorsi diversi che su un filesystem senza distinzione tra maiuscole e minuscole coincidono.
export function caseCollisions(paths) {
  const seen = new Map(), collisions = [];
  for (const p of paths) {
    const key = p.toLowerCase();
    if (seen.has(key) && seen.get(key) !== p) collisions.push([seen.get(key), p]);
    else seen.set(key, p);
  }
  return collisions;
}

// File esclusi dal controllo password: test (usano valori sintetici), documentazione e lockfile.
export function scannedForPasswords(path) {
  const parts = path.split('/');
  if (parts.some(p => p === 'test' || p === 'tests' || p === 'node_modules')) return false;
  if (/\.md$/i.test(path) || /(^|\/)package-lock\.json$/.test(path)) return false;
  return true;
}

// Stringa letterale non vuota; le alternative non si sovrappongono, per evitare backtracking esponenziale.
const LITERAL = String.raw`(["'\x60])(?:\\.|(?!\1)[^\\\n])+\1`;
const PASSWORD_RULES = [
  ['assegnazione di una password letterale',
    new RegExp(String.raw`\b(?:const|let|var)\s+[A-Za-z_$]*(?:pass(?:word)?|pwd)[A-Za-z0-9_$]*\s*=\s*` + LITERAL, 'i')],
  ['confronto con una password letterale',
    new RegExp(String.raw`\b[A-Za-z_$.]*pass(?:word)?[A-Za-z0-9_$]*\s*[!=]==?\s*` + LITERAL, 'i')],
  ['confronto con una password letterale',
    new RegExp(LITERAL + String.raw`\s*[!=]==?\s*[A-Za-z_$.]*pass(?:word)?\b`, 'i')],
  ['proprietà password con valore letterale',
    new RegExp(String.raw`\bpass(?:word)?\s*:\s*` + LITERAL, 'i')],
  ['password dimostrativa o predefinita esposta',
    /\b(?:demo|default|admin|test)[\s_-]*pass(?:word)?\s*[:=]/i],
  ['codice staff letterale',
    new RegExp(String.raw`\b(?:ADMIN|MANAGER|STAFF)_CODE\s*[:=]\s*` + LITERAL)],
];

// Restituisce [{ line, rule }] senza mai riportare il valore trovato.
export function hardcodedPasswordFindings(text) {
  const findings = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [rule, re] of PASSWORD_RULES) if (re.test(line)) { findings.push({ line: i + 1, rule }); break; }
  });
  return findings;
}
