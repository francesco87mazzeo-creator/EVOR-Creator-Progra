// Firestore tramite API REST con il service account.
// Le scritture del service account NON passano dalle Security Rules: la convalida avviene prima, nel Worker.
import { signJwt } from "./google-auth.mjs";

const GOOGLE_BASE = "https://firestore.googleapis.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/datastore";
const TIMEOUT_MS = 10_000;

export class FirestoreError extends Error {
  constructor(stage, status) {
    super(`Firestore ${stage} non riuscito (${status})`);
    this.name = "FirestoreError";
    this.stage = stage;
    this.status = status;
  }
}

/* ---------- Conversione valori (stesse regole dell'SDK web: interi → integerValue) ---------- */
export function toFirestoreValue(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new TypeError("Numero non finito");
    return Number.isSafeInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: v.length ? { values: v.map(toFirestoreValue) } : {} };
  if (typeof v === "object") return { mapValue: toFirestoreFields(v) };
  throw new TypeError("Tipo non supportato");
}
function toFirestoreFields(obj) {
  const keys = Object.keys(obj);
  return keys.length ? { fields: Object.fromEntries(keys.map(k => [k, toFirestoreValue(obj[k])])) } : {};
}
export function toFirestoreDocument(obj) { return toFirestoreFields(obj); }

export function fromFirestoreValue(v) {
  if ("nullValue" in v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in v) return fromFirestoreFields(v.mapValue.fields || {});
  throw new TypeError("Tipo Firestore non supportato");
}
function fromFirestoreFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fromFirestoreValue(v)]));
}

/* ---------- Accesso ---------- */
function isLoopback(base) {
  try { const u = new URL(base); return u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname); }
  catch { return false; }
}

const tokenCache = new Map();
async function accessToken(sa, now) {
  const cached = tokenCache.get(sa.client_email);
  if (cached && cached.expiresAt - 60_000 > now()) return cached.token;
  const iat = Math.floor(now() / 1000);
  const assertion = await signJwt(sa.private_key, {
    iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!r.ok) throw new FirestoreError("token", r.status);
  const data = await r.json();
  if (typeof data.access_token !== "string") throw new FirestoreError("token", "risposta");
  tokenCache.set(sa.client_email, { token: data.access_token, expiresAt: now() + (Number(data.expires_in) || 3600) * 1000 });
  return data.access_token;
}

/**
 * @param serviceAccount JSON del service account (contiene la chiave: non registrarlo mai)
 * @param baseUrl solo per i test con l'Emulator su loopback; in produzione resta Google
 */
export function createFirestoreClient({ serviceAccount, projectId, baseUrl, now = Date.now }) {
  const base = baseUrl || GOOGLE_BASE;
  if (base !== GOOGLE_BASE && !isLoopback(base)) throw new Error("Indirizzo Firestore non consentito");
  const project = projectId || serviceAccount.project_id;
  if (!/^[a-z0-9-]{4,40}$/.test(project || "")) throw new Error("Progetto Firestore non valido");
  const root = `${base}/v1/projects/${project}/databases/(default)/documents`;
  // L'Emulator accetta "owner" come amministratore; non esiste un equivalente in produzione.
  const auth = async () => "Bearer " + (isLoopback(base) ? "owner" : await accessToken(serviceAccount, now));

  return {
    async getDocument(path) {
      const r = await fetch(`${root}/${path}`, {
        headers: { Authorization: await auth() }, signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      if (r.status === 404) return null;
      if (!r.ok) throw new FirestoreError("lettura", r.status);
      const doc = await r.json();
      return fromFirestoreFields(doc.fields || {});
    },
    /** Crea senza mai sovrascrivere: "created" oppure "exists". */
    async createDocument(collection, id, data) {
      const r = await fetch(`${root}/${collection}?documentId=${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { Authorization: await auth(), "Content-Type": "application/json" },
        body: JSON.stringify(toFirestoreDocument(data)),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      if (r.status === 409) return "exists";
      if (!r.ok) throw new FirestoreError("scrittura", r.status);
      return "created";
    },
    /** Sostituisce l'intero documento (lo crea se manca), come `set()` dell'SDK web senza merge. */
    async setDocument(path, data) {
      const r = await fetch(`${root}/${path}`, {
        method: "PATCH",
        headers: { Authorization: await auth(), "Content-Type": "application/json" },
        body: JSON.stringify(toFirestoreDocument(data)),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      if (!r.ok) throw new FirestoreError("scrittura", r.status);
    }
  };
}

export function __resetTokenCacheForTests() { tokenCache.clear(); }
