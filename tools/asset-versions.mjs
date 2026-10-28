// Versioni degli asset app/ nelle pagine: ogni riferimento porta ?v=<primi 16 caratteri esadecimali dello SHA-256 del file>.
// Un file modificato cambia indirizzo; un file invariato mantiene il suo (e la sua cache).
// Uso dalla radice:  node tools/asset-versions.mjs           controlla (codice di uscita 1 se un valore non coincide)
//                    node tools/asset-versions.mjs --write   aggiorna index.html e admin/index.html
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const PAGES = ['index.html', 'admin/index.html'];
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root));
// Riferimenti a app/: <script type="text/babel" src="…"> e <link rel="stylesheet" href="…">, con o senza "../".
const REFERENCE = /(?<attr>src|href)="(?<prefix>(?:\.\.\/)?)(?<file>app\/[a-z0-9-]+\.(?:jsx|css))\?v=(?<version>[^"]*)"/g;

export const assetVersion = file => createHash('sha256').update(read(file)).digest('hex').slice(0, 16);

/** Riferimenti app/ di una pagina con versione attuale e attesa. */
export function references(page) {
  return [...read(page).toString('utf8').matchAll(REFERENCE)].map(m => ({ page, file: m.groups.file, version: m.groups.version, expected: assetVersion(m.groups.file) }));
}

export function updatePages() {
  for (const page of PAGES) {
    const html = read(page).toString('utf8');
    const next = html.replace(REFERENCE, (...args) => { const g = args.at(-1); return `${g.attr}="${g.prefix}${g.file}?v=${assetVersion(g.file)}"`; });
    if (next !== html) writeFileSync(new URL(page, root), next);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--write')) updatePages();
  const wrong = PAGES.flatMap(references).filter(r => r.version !== r.expected);
  for (const r of wrong) console.error(`${r.page}: ${r.file}?v=${r.version} → atteso ?v=${r.expected}`);
  console.log(wrong.length ? 'Versioni da aggiornare: node tools/asset-versions.mjs --write' : 'Versioni degli asset app/ allineate al contenuto.');
  process.exitCode = wrong.length ? 1 : 0;
}
