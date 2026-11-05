// Candidature e impostazioni SINTETICHE per il solo progetto evora-mcp-staging.
// Senza --apply: nessuna rete, stampa soltanto il riepilogo dei documenti.
// Con --apply: crea i documenti solo se non esistono (mai sovrascritture), usando il token
// dell'utente gcloud letto in memoria e mai stampato.
// Uso: node seed-staging.mjs [--apply --confirm-project=evora-mcp-staging]
import {execFileSync} from 'node:child_process';
import {computeScore, scoreDocumentFields, DEFAULT_SCORING} from '../../../server/collective/scoring.mjs';

const PROJECT = 'evora-mcp-staging';
const STATUSES = ['new', 'new', 'review', 'review', 'approved', 'rejected', 'new', 'review'];
// Casi coperti: base normale, base ridotta, zero visualizzazioni, account raggiunti assenti, follower netti negativi.
const METRICS = [
  {followers: 12400, views: 48200, interactions: 1310, accountsReached: 21900, netFollowers: 240},
  {followers: 3150, views: 9800, interactions: 420, accountsReached: 5100, netFollowers: 35},
  {followers: 860, views: 640, interactions: 7, accountsReached: 410, netFollowers: -4},
  {followers: 27800, views: 152000, interactions: 2950, accountsReached: null, netFollowers: 610},
  {followers: 5400, views: 0, interactions: 0, accountsReached: null, netFollowers: 0},
  {followers: 1900, views: 22100, interactions: 188, accountsReached: 14000, netFollowers: -12},
  {followers: 64000, views: 310000, interactions: 9100, accountsReached: 120500, netFollowers: 1500},
  {followers: 7300, views: 15400, interactions: 610, accountsReached: 9200, netFollowers: 88}
];

export function syntheticApplications(base = Date.UTC(2026, 9, 1, 9)) {
  return METRICS.map((m, i) => {
    const n = String(i + 1).padStart(2, '0');
    const date = new Date(base + i * 86_400_000).toISOString();
    return {id: 'synthetic-' + n, data: {
      // Campi identificativi volutamente finti: i tool MCP non devono mai restituirli.
      name: 'SINTETICO ' + n, email: `sintetico${n}@example.invalid`, instagram: 'sintetico_' + n,
      notes: 'SINTETICO-NOTA', creatorCode: 'SINTETICO-CODICE', screenshotData: 'data:image/png;base64,U0lOVEVUSUNP',
      ...m, schemaVersion: 5, date, updatedAt: date, status: STATUSES[i], evaluation: {}, synthetic: true,
      ...scoreDocumentFields(computeScore(m, null))
    }};
  });
}
// La configurazione resta esattamente nel formato v3: un campo in più la farebbe rifiutare.
export const syntheticSettings = () => [{id: 'scoring', data: structuredClone(DEFAULT_SCORING)}];

const value = v => v === null ? {nullValue: null}
  : typeof v === 'boolean' ? {booleanValue: v}
  : Number.isInteger(v) ? {integerValue: String(v)}
  : typeof v === 'number' ? {doubleValue: v}
  : typeof v === 'string' ? {stringValue: v}
  : Array.isArray(v) ? {arrayValue: {values: v.map(value)}}
  : {mapValue: {fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, value(x)]))}};

async function apply() {
  if (!process.argv.includes('--confirm-project=' + PROJECT)) throw Error('Conferma esplicita del progetto mancante');
  const gcloud = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
  const token = execFileSync(gcloud, ['auth', 'print-access-token'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32'}).trim();
  const root = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
  for (const [collection, docs] of [['candidature', syntheticApplications()], ['settings', syntheticSettings()]]) {
    for (const {id, data} of docs) {
      const r = await fetch(`${root}/${collection}?documentId=${id}`, {method: 'POST',
        headers: {authorization: 'Bearer ' + token, 'content-type': 'application/json'},
        body: JSON.stringify({fields: value(data).mapValue.fields})});
      console.log(`${collection}/${id}: ${r.status === 200 ? 'creato' : r.status === 409 ? 'già presente, non modificato' : 'HTTP ' + r.status}`);
    }
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop())) {
  if (process.argv.includes('--apply')) await apply();
  else {
    for (const {id, data} of syntheticApplications())
      console.log(`candidature/${id}: ${data.status}, views ${data.views}, score ${data.socialScore}, lowBase ${data.lowBase}`);
    for (const {id} of syntheticSettings()) console.log(`settings/${id}: configurazione predefinita v${DEFAULT_SCORING.version}`);
    console.log('Prova senza rete: nessuna scrittura.');
  }
}
