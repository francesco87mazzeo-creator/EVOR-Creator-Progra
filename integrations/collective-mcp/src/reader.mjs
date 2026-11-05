import {boundedText} from './bounded.mjs';
import {METRICS, RECENT_FIELDS, DETAIL_FIELDS, validMcpDocumentId} from '../../../server/collective/mcp-read-policy.mjs';
import {INDEX_FIELDS, CANDIDATE_FIELDS, EVALUATION_FIELDS, MAX_INDEX} from '../../../server/collective/mcp-candidate-policy.mjs';
export {METRICS, RECENT_FIELDS, DETAIL_FIELDS};
export const MAX_RECENT = 20;
export const validId = validMcpDocumentId;
export class DataError extends Error { constructor(code='DATA_UNAVAILABLE') { super(code); this.code=code; } }
const allowedSettings = new Set(['scoring','instagramBenchmarks','scoreLevels']);
// Decodes only Firestore REST values; unsupported types fail closed, never echoed to callers.
function value(v) {
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) { const n=Number(v.integerValue); if (!Number.isSafeInteger(n)) throw new DataError(); return n; }
  if ('doubleValue' in v) { if (!Number.isFinite(v.doubleValue)) throw new DataError(); return v.doubleValue; }
  if ('timestampValue' in v) { if (typeof v.timestampValue!=='string' || !Number.isFinite(Date.parse(v.timestampValue))) throw new DataError(); return v.timestampValue; }
  if ('mapValue' in v) return fields(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(value);
  throw new DataError();
}
function fields(input) {
  const output=Object.create(null);
  for (const [key,v] of Object.entries(input)) {
    if (['__proto__','prototype','constructor'].includes(key)) throw new DataError();
    output[key]=value(v);
  }
  // Existing shared validators accept plain objects, not custom class instances.
  return {...output};
}
export function isoDate(date) { return typeof date==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString()===date; }
export function createReader({channel, projectId}) {
  if (!/^[a-z][a-z0-9-]{5,62}$/.test(projectId) || !channel || typeof channel.fetch!=='function') throw new DataError();
  const root=`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const prefix=`projects/${projectId}/databases/(default)/documents/candidature/`;
  async function read(url, options) {
    let response;
    try { response=await channel.fetch(new Request(url,{...options, signal:AbortSignal.timeout(5000)})); } catch { throw new DataError(); }
    if (response.status===404) return null;
    if (!response.ok) throw new DataError();
    // A private, constrained read channel must enforce the same bound upstream.
    try { return JSON.parse(await boundedText(response,262144)); } catch { throw new DataError(); }
  }
  function document(doc) {
    if (!doc || typeof doc.name!=='string' || !doc.name.startsWith(prefix)) throw new DataError();
    const id=doc.name.slice(prefix.length);if (!validId(id)) throw new DataError();
    return {id, data:fields(doc.fields || {})};
  }
  return Object.freeze({
    async recent(limit) {
      if (!Number.isInteger(limit) || limit<1 || limit>MAX_RECENT) throw new DataError('INVALID_LIMIT');
      const rows=await read(root+':runQuery',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({structuredQuery:{select:{fields:RECENT_FIELDS.map(fieldPath=>({fieldPath}))},from:[{collectionId:'candidature'}],orderBy:[{field:{fieldPath:'date'},direction:'DESCENDING'},{field:{fieldPath:'__name__'},direction:'DESCENDING'}],limit}})});
      if (!Array.isArray(rows) || rows.length>limit+1) throw new DataError();
      const documents=rows.filter(row=>row.document).map(row=>document(row.document));
      if (documents.length>limit) throw new DataError();
      const ids=new Set();
      for (let i=0;i<documents.length;i++) {
        const item=documents[i], previous=documents[i-1];
        if (!isoDate(item.data.date) || ids.has(item.id)) throw new DataError('UNVERIFIED_ORDER');
        ids.add(item.id);
        if (previous && (item.data.date>previous.data.date || (item.data.date===previous.data.date && item.id>=previous.id))) throw new DataError('UNVERIFIED_ORDER');
      }
      return documents;
    },
    async application(id) {
      if (!validId(id)) throw new DataError('INVALID_ID');
      const url=new URL(root+'/candidature/'+id);DETAIL_FIELDS.forEach(path=>url.searchParams.append('mask.fieldPaths',path));
      const doc=await read(url);if (doc===null) return null;
      const result=document(doc);if (result.id!==id) throw new DataError();return result;
    },
    /** Names, handles, status and date of at most MAX_INDEX recent applications, for in-server matching. */
    async index() {
      const rows=await read(root+':runQuery',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({structuredQuery:{select:{fields:INDEX_FIELDS.map(fieldPath=>({fieldPath}))},from:[{collectionId:'candidature'}],orderBy:[{field:{fieldPath:'date'},direction:'DESCENDING'},{field:{fieldPath:'__name__'},direction:'DESCENDING'}],limit:MAX_INDEX}})});
      if (!Array.isArray(rows) || rows.length>MAX_INDEX+1) throw new DataError();
      return rows.filter(row=>row.document).map(row=>document(row.document));
    },
    async candidate(id) {
      if (!validId(id)) throw new DataError('INVALID_ID');
      const url=new URL(root+'/candidature/'+id);CANDIDATE_FIELDS.forEach(path=>url.searchParams.append('mask.fieldPaths',path));
      const doc=await read(url);if (doc===null) return null;
      const result=document(doc);if (result.id!==id) throw new DataError();return result;
    },
    /** Original data for an independent AI evaluation; see EVALUATION_FIELDS. */
    async evaluationInput(id) {
      if (!validId(id)) throw new DataError('INVALID_ID');
      const url=new URL(root+'/candidature/'+id);EVALUATION_FIELDS.forEach(path=>url.searchParams.append('mask.fieldPaths',path));
      const doc=await read(url);if (doc===null) return null;
      const result=document(doc);if (result.id!==id) throw new DataError();return result;
    },
    async setting(id) {
      if (!allowedSettings.has(id)) throw new DataError('INVALID_SETTING');
      const doc=await read(root+'/settings/'+id);if (doc===null) return null;
      if (doc.name!==`projects/${projectId}/databases/(default)/documents/settings/${id}`) throw new DataError();
      return fields(doc.fields || {});
    }
  });
}
