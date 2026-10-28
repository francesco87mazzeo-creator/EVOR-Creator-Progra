// Regole di igiene del repository, senza dipendenze: percorsi compatibili con Windows e
// assenza di password amministrative scritte nel codice. Usate da hygiene.test.mjs.
//
// Il controllo password è EURISTICO: individua le forme tipiche (assegnazioni, proprietà,
// confronti, stato iniziale React, testo "demo password") ma non valori offuscati o costruiti
// a runtime (atob, fromCharCode, concatenazioni da variabili, file JSON di configurazione)
// né secret di altro tipo. Non sostituisce un audit dei secret né la scansione di GitHub.

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

// File e directory (anche intermedie) che su Windows coincidono ignorando maiuscole/minuscole:
// due grafie diverse dello stesso nome, oppure un file e una directory con nomi equivalenti.
export function caseConflicts(paths) {
  const entries = new Map(); // nome in minuscolo → Set("tipo grafia")
  const add = (spelling, kind) => {
    const key = spelling.toLowerCase();
    if (!entries.has(key)) entries.set(key, new Set());
    entries.get(key).add(`${kind} "${spelling}"`);
  };
  for (const p of paths) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) add(parts.slice(0, i).join('/'), 'directory');
    add(p, 'file');
  }
  return [...entries.values()].filter(s => s.size > 1).map(s => [...s].sort().join(' ↔ '));
}

// File esclusi dal controllo password: test (usano valori sintetici), documentazione e lockfile.
export function scannedForPasswords(path) {
  const parts = path.split('/');
  if (parts.some(p => p === 'test' || p === 'tests' || p === 'node_modules')) return false;
  if (/\.md$/i.test(path) || /(^|\/)package-lock\.json$/.test(path)) return false;
  return true;
}

// Parole di un identificatore: camelCase, snake_case e kebab-case.
const words = name => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean).map(w => w.toLowerCase());
const PASSWORD_WORDS = new Set(['pass', 'password', 'passwd', 'passphrase', 'pwd']);
const STAFF_ROLES = new Set(['admin', 'manager', 'staff']);
// Ultima parola che indica un'etichetta o un riferimento, non il valore: passwordLabel, PASS_KEY, pwdInput…
const DESCRIPTIVE = new Set(['label', 'placeholder', 'text', 'title', 'hint', 'message', 'msg', 'error', 'err',
  'field', 'input', 'selector', 'id', 'name', 'type', 'class', 'prompt', 'help', 'description', 'desc', 'caption',
  'heading', 'key', 'attr', 'el', 'element', 'ref', 'regex', 'pattern', 'min', 'max', 'length', 'len', 'policy',
  'rule', 'rules', 'url', 'endpoint', 'path', 'icon', 'visible', 'shown', 'show', 'toggle']);

// Nome (ultimo segmento di a.b.c) che indica una password o un codice staff.
export function sensitiveName(name) {
  const w = words(name.split('.').pop());
  if (!w.length || DESCRIPTIVE.has(w[w.length - 1])) return false;
  if (w.some(x => PASSWORD_WORDS.has(x))) return true;
  return w.some((x, i) => x === 'code' && i > 0 && STAFF_ROLES.has(w[i - 1]));
}

// Stringa letterale non vuota su una riga; le alternative non si sovrappongono (niente backtracking esponenziale).
const LITERAL = String.raw`(?:"(?:\\.|[^"\\\n])+"|'(?:\\.|[^'\\\n])+'|\x60(?:\\.|[^\x60\\\n])+\x60)`;
const NAME = String.raw`(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*`;
// Ogni regola: [descrizione, regex globale con gruppo "name", posizione segnalata]. \s comprende gli a capo.
const RULES = [
  ['assegnazione di una password letterale', new RegExp(String.raw`(?<![\w$.\-])(?<name>${NAME})\s*=(?![=>])\s*${LITERAL}`, 'g')],
  ['proprietà password con valore letterale', new RegExp(String.raw`(?<![\w$.\-]|\?\s*)(?<q>["']?)(?<name>[A-Za-z_$][\w$\-]*)\k<q>\s*:\s*${LITERAL}`, 'g')],
  ['confronto con una password letterale', new RegExp(String.raw`(?<![\w$.\-])(?<name>${NAME})\s*[!=]==?\s*${LITERAL}`, 'g')],
  ['confronto con una password letterale', new RegExp(String.raw`${LITERAL}\s*[!=]==?\s*(?<name>${NAME})(?![\w$.])`, 'g')],
  ['stato iniziale con una password letterale', new RegExp(String.raw`\[\s*(?<name>[A-Za-z_$][\w$]*)\s*,[^\]\n]*\]\s*=\s*(?:React\.)?useState\(\s*${LITERAL}`, 'g')],
];
// Testo visibile del tipo "DEMO PASSWORD: …" (le assegnazioni sono già coperte da RULES).
const DEMO_TEXT = /\b(?:demo|default)[ \t]+pass(?:word)?[ \t]*:/gi;

// Restituisce [{ line, rule }] senza mai riportare il valore trovato.
export function hardcodedPasswordFindings(text) {
  const lineStarts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lineStarts.push(i + 1);
  const lineOf = index => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= index) lo = mid; else hi = mid - 1; } return lo + 1; };
  const byLine = new Map();
  for (const [rule, re] of RULES) {
    for (const m of text.matchAll(re)) if (sensitiveName(m.groups.name)) {
      const line = lineOf(m.index);
      if (!byLine.has(line)) byLine.set(line, rule);
    }
  }
  for (const m of text.matchAll(DEMO_TEXT)) {
    const line = lineOf(m.index);
    if (!byLine.has(line)) byLine.set(line, 'password dimostrativa o predefinita esposta');
  }
  return [...byLine].sort((a, b) => a[0] - b[0]).map(([line, rule]) => ({ line, rule }));
}
