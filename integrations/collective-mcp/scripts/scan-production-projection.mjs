// Read-only check of what the production facade would return from evora-athletes.
// Uses the dedicated read-only service account and the real request builder; prints only counts, types and
// pattern hits, never values. Also confirms the account holds no write or Auth permission.
// Usage: node scan-production-projection.mjs <private key file of evora-mcp-read>
import fs from 'node:fs';
import {buildPrivateFirestoreRequest} from '../../../worker/src/mcp-private-read.mjs';
import {accessToken} from '../../../worker/src/firestore.mjs';
import {SETTING_FIELDS} from '../../../server/collective/mcp-read-policy.mjs';
import {MCP_PROD_DATA_PROJECT as PROJECT} from '../../../server/collective/mcp-profiles.mjs';

const account = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (account.project_id !== PROJECT || !account.client_email.startsWith('evora-mcp-read@')) throw Error('Not the dedicated production read account');
const bearer = await accessToken(account, Date.now);

// Every string the projection may legitimately return; anything else is reported.
const TOKEN = /^[a-z][a-z0-9_-]{0,31}$/;
const ENUMS = {status: /^(new|review|approved|rejected)$/, screenType: TOKEN, visibility: TOKEN, interpolation: TOKEN, storageFormat: TOKEN, key: /^(followers|views|interactions|accountsReached|netFollowers)$/};
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const PERSONAL = [/@/, /https?:\/\//i, /instagram|tiktok/i, /data:image|base64/i, /\+?\d[\d\s]{8,}/];
const stats = {documents: 0, fields: {}, unexpectedStrings: 0, personalHits: 0, longStrings: 0};
const plain = (v, path) => {
  if (v.mapValue) return Object.entries(v.mapValue.fields || {}).forEach(([k, x]) => plain(x, path + '.' + k));
  if (v.arrayValue) return (v.arrayValue.values || []).forEach(x => plain(x, path + '[]'));
  const type = Object.keys(v)[0];
  stats.fields[path] = stats.fields[path] || {};
  stats.fields[path][type] = (stats.fields[path][type] || 0) + 1;
  if (type !== 'stringValue' && type !== 'timestampValue') return;
  const s = v.stringValue ?? v.timestampValue, leaf = path.split('.').pop().replace('[]', '');
  if (PERSONAL.some(p => p.test(s))) stats.personalHits++;
  if (s.length > 64) stats.longStrings++;
  if (!(ISO.test(s) || ENUMS[leaf]?.test(s))) stats.unexpectedStrings++;
};

const recent = await (await fetch(buildPrivateFirestoreRequest(PROJECT, 'recent', {limit: 20}, bearer))).json();
const ids = recent.filter(r => r.document).map(r => r.document.name.split('/').pop());
for (const r of recent.filter(r => r.document)) { stats.documents++; Object.entries(r.document.fields || {}).forEach(([k, v]) => plain(v, 'recent.' + k)); }
for (const id of ids) {
  const d = await (await fetch(buildPrivateFirestoreRequest(PROJECT, 'application', {id}, bearer))).json();
  Object.entries(d.fields || {}).forEach(([k, v]) => plain(v, 'detail.' + k));
}
for (const id of Object.keys(SETTING_FIELDS)) {
  const r = await fetch(buildPrivateFirestoreRequest(PROJECT, 'setting', {id}, bearer));
  if (r.ok) Object.entries((await r.json()).fields || {}).forEach(([k, v]) => plain(v, 'setting.' + id + '.' + k));
}
// Permissions actually held by this account on the production project.
const want = ['datastore.entities.get', 'datastore.entities.list', 'datastore.entities.create', 'datastore.entities.update', 'datastore.entities.delete',
  'firebaseauth.users.get', 'firebaseauth.users.update', 'resourcemanager.projects.setIamPolicy', 'firebaserules.releases.update'];
const perms = await (await fetch(`https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:testIamPermissions`, {method: 'POST',
  headers: {authorization: 'Bearer ' + bearer, 'content-type': 'application/json'}, body: JSON.stringify({permissions: want})})).json();
// ID shape only: length and character classes, never the value.
const idShapes = {};
for (const id of ids) { const shape = id.length + ':' + [/[a-z]/, /[A-Z]/, /\d/, /[_-]/].map(p => p.test(id) ? 1 : 0).join('') + (/^[a-z]+(-[a-z]+)+/.test(id) ? ':parole' : '') + (/^k[0-9a-f]{31}$/.test(id) ? ':hash' : '') + (/^\d{13}$/.test(id) ? ':timestamp-ms' : ''); idShapes[shape] = (idShapes[shape] || 0) + 1; }
console.log(JSON.stringify({documents: stats.documents, ids: ids.length, idShapes, idsLookRandom: ids.every(id => /^[A-Za-z0-9_-]{16,40}$/.test(id) && !/@/.test(id)),
  personalHits: stats.personalHits, longStrings: stats.longStrings, unexpectedStrings: stats.unexpectedStrings,
  fieldTypes: stats.fields, permissions: perms.permissions || [], permissionsStatus: perms.error?.status || 'OK'}, null, 1));
