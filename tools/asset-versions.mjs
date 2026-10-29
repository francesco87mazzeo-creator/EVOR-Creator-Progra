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
// Riferimenti a app/ (<script src="…">, <link href="…">), con o senza "../", con o senza ?v= o altra query:
// un riferimento senza versione o con una query diversa da ?v=<hash> risulta da correggere.
const REFERENCE = /(?<attr>src|href)="(?<prefix>(?:\.\.\/)?)(?<file>(?:app\/[a-z0-9-]+\.(?:jsx|css)|public\/(?:score-levels|admin-scoring-client)\.js))(?<query>\?[^"]*)?"/g;
const versionOf = query => (/^\?v=([^&]*)$/.exec(query || '') || [])[1] ?? null;

export const assetVersion = file => createHash('sha256').update(read(file)).digest('hex').slice(0, 16);
const BOOT_REFERENCE = /(public\/(?:score-levels|admin-scoring-client)\.js)\?v=([0-9a-f]{16})/g;
export const bootReferences = () => [...read('app/admin.jsx').toString('utf8').matchAll(BOOT_REFERENCE)]
  .map(m=>({page:'app/admin.jsx',file:m[1],version:m[2],expected:assetVersion(m[1])}));

/** Riferimenti app/ di una pagina con versione attuale (null se assente) e attesa. */
export function references(page) {
  return [...read(page).toString('utf8').matchAll(REFERENCE)].map(m => ({ page, file: m.groups.file, version: versionOf(m.groups.query), expected: assetVersion(m.groups.file) }));
}

export function updatePages() {
  const boot=read('app/admin.jsx').toString('utf8');
  const nextBoot=boot.replace(BOOT_REFERENCE,(_,file)=>`${file}?v=${assetVersion(file)}`);
  if(nextBoot!==boot)writeFileSync(new URL('app/admin.jsx',root),nextBoot);
  for (const page of PAGES) {
    const html = read(page).toString('utf8');
    const next = html.replace(REFERENCE, (...args) => { const g = args.at(-1); return `${g.attr}="${g.prefix}${g.file}?v=${assetVersion(g.file)}"`; });
    if (next !== html) writeFileSync(new URL(page, root), next);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--write')) updatePages();
  const wrong = [...PAGES.flatMap(references),...bootReferences()].filter(r => r.version !== r.expected);
  for (const r of wrong) console.error(`${r.page}: ${r.file}${r.version === null ? ' senza versione' : `?v=${r.version}`} → atteso ?v=${r.expected}`);
  console.log(wrong.length ? 'Versioni da aggiornare: node tools/asset-versions.mjs --write' : 'Versioni degli asset app/ allineate al contenuto.');
  process.exitCode = wrong.length ? 1 : 0;
}
