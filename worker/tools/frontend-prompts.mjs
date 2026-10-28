// Legge da fixtures/index.html i testi esatti dei prompt OCR del frontend.
// Usato solo dai test e per rigenerare gli hash ammessi nel Worker: il Worker non legge questo file.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

export const FIELD_LABELS = ['Visualizzazioni', 'Follower netti', 'Interazioni', 'Account raggiunti'];

const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

function literalAt(quote) {
  let k = quote + 1;
  while (html[k] !== '"') k += html[k] === '\\' ? 2 : 1;
  return [vm.runInNewContext(html.slice(quote, k + 1)), k];
}
function promptAfter(marker) {
  const anchor = `{ type:"text", text:"${marker}`;
  const i = html.indexOf(anchor);
  if (i < 0 || html.indexOf(anchor, i + 1) >= 0) throw new Error(`Prompt non trovato o ambiguo nel frontend: ${marker}`);
  return literalAt(i + anchor.length - marker.length - 1);
}

const [insights] = promptAfter('Analizza questo screenshot Instagram');
const [profile] = promptAfter('Analizza questo screenshot e classificalo');
const [verifyHead, end] = promptAfter('In questo screenshot cerca il dato');
const [verifyTail] = literalAt(html.indexOf('"', html.indexOf('+fieldLabel+', end) + 12));

export const prompts = {
  insights,
  profile,
  verify: label => verifyHead + label + verifyTail,
};
export const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
export function allowedPromptHashes() {
  return {
    insights: sha256(prompts.insights),
    profile: sha256(prompts.profile),
    ...Object.fromEntries(FIELD_LABELS.map(l => [`verify:${l}`, sha256(prompts.verify(l))])),
  };
}
