// Verifica degli ID token Firebase (sessione staff) secondo la procedura documentata da Firebase:
// RS256, chiave pubblica securetoken per `kid`, emittente e destinatario del progetto, scadenze.
// Nessuna dipendenza esterna; la chiave pubblica è l'unico dato scaricato.

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const TIMEOUT_MS = 5_000;
const SKEW_S = 60;
const MAX_TOKEN_CHARS = 4096;
const DEFAULT_CACHE_MS = 60 * 60 * 1000;
const MAX_CACHE_MS = 6 * 60 * 60 * 1000;

export class IdTokenError extends Error {
  /** reason: "invalid" (401, token non valido) oppure "unavailable" (503, chiavi non raggiungibili) */
  constructor(reason, detail) {
    super(`ID token ${reason}: ${detail}`);
    this.name = "IdTokenError";
    this.reason = reason;
    this.detail = detail;
  }
}
const invalid = detail => { throw new IdTokenError("invalid", detail); };

function b64urlDecode(part) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) invalid("codifica");
  const s = part.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - s.length % 4) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function decodeJson(part) {
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b64urlDecode(part)));
    if (value === null || typeof value !== "object" || Array.isArray(value)) invalid("struttura");
    return value;
  } catch (e) {
    if (e instanceof IdTokenError) throw e;
    invalid("struttura");
  }
}

let keyCache = null;   // { keys: Map<kid, CryptoKey>, until }
async function publicKeys(now) {
  if (keyCache && keyCache.until > now) return keyCache.keys;
  let r, data;
  try {
    r = await fetch(JWKS_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) throw new Error(String(r.status));
    data = await r.json();
  } catch (e) { throw new IdTokenError("unavailable", "chiavi"); }
  if (!data || !Array.isArray(data.keys)) throw new IdTokenError("unavailable", "chiavi");
  const keys = new Map();
  for (const jwk of data.keys) {
    if (!jwk || jwk.kty !== "RSA" || typeof jwk.kid !== "string" || typeof jwk.n !== "string" || typeof jwk.e !== "string") continue;
    try {
      keys.set(jwk.kid, await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
    } catch (e) { /* chiave malformata: ignorata */ }
  }
  if (!keys.size) throw new IdTokenError("unavailable", "chiavi");
  const maxAge = /max-age=(\d+)/.exec(r.headers.get("Cache-Control") || "");
  const ttl = maxAge ? Math.min(Number(maxAge[1]) * 1000, MAX_CACHE_MS) : DEFAULT_CACHE_MS;
  keyCache = { keys, until: now + ttl };
  return keys;
}

/**
 * Restituisce i claim di un ID token Firebase valido per `projectId`, altrimenti lancia IdTokenError.
 * Non verifica la revoca (richiederebbe l'Admin API): la durata della sessione è limitata da `maxAuthAgeS`.
 */
export async function verifyFirebaseIdToken(token, { projectId, maxAuthAgeS, now = Date.now }) {
  if (typeof token !== "string" || token.length > MAX_TOKEN_CHARS) invalid("formato");
  const parts = token.split(".");
  if (parts.length !== 3) invalid("formato");
  const header = decodeJson(parts[0]);
  const claims = decodeJson(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") invalid("algoritmo");

  const nowMs = now();
  const keys = await publicKeys(nowMs);
  const key = keys.get(header.kid);
  if (!key) invalid("chiave");
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlDecode(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!ok) invalid("firma");

  const t = Math.floor(nowMs / 1000);
  if (claims.iss !== "https://securetoken.google.com/" + projectId) invalid("emittente");
  if (claims.aud !== projectId) invalid("destinatario");
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 128) invalid("soggetto");
  if (!Number.isInteger(claims.exp) || claims.exp <= t - SKEW_S) invalid("scaduto");
  if (!Number.isInteger(claims.iat) || claims.iat > t + SKEW_S) invalid("emissione");
  if (!Number.isInteger(claims.auth_time) || claims.auth_time > t + SKEW_S) invalid("accesso");
  if (maxAuthAgeS && t - claims.auth_time > maxAuthAgeS) invalid("sessione");
  return claims;
}

export function __resetKeyCacheForTests() { keyCache = null; }
