// EVORΛ HUB -> real COLLECTIVE. The HUB is reached ONLY through the private service binding
// HUB_IDENTITY (no HTTP fallback). This Worker mints the evora-athletes token itself, so no
// token of another Firebase project is ever used here. The legacy /auth login stays untouched.
import { signJwt } from "./google-auth.mjs";

const HUB_RPC = "https://hub.internal/internal/collective/";
const TIMEOUT_MS = 5000;

export class HubError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

const opaque = v => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);

/** Individual HUB identity only: no shared legacy UID, no unknown role. */
export function validPrincipal(u) {
  return !!u && typeof u.uid === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(u.uid) && !u.uid.startsWith("staff-")
    && ["admin", "manager"].includes(u.role) && Number.isInteger(u.version) && u.version >= 1;
}

async function rpc(env, name, body) {
  if (!env.HUB_IDENTITY || typeof env.HUB_IDENTITY.fetch !== "function") throw new HubError(503, "HUB_NOT_CONFIGURED");
  let r;
  try {
    r = await env.HUB_IDENTITY.fetch(new Request(HUB_RPC + name, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS)
    }));
  } catch { throw new HubError(503, "HUB_UNAVAILABLE"); }
  if (r.status === 400 || r.status === 401 || r.status === 403) throw new HubError(403, "HUB_ACCESS_DENIED");
  if (!r.ok) throw new HubError(503, "HUB_UNAVAILABLE");
  try { return await r.json(); } catch { throw new HubError(503, "HUB_INVALID"); }
}

/** One-time HUB code + PKCE verifier (held only by the admin page) -> current HUB principal. */
export async function exchangeHubCode(env, code, verifier) {
  if (!opaque(code) || !opaque(verifier)) throw new HubError(400, "HUB_SSO_INVALID");
  const d = await rpc(env, "exchange", { code, verifier });
  if (!validPrincipal(d && d.user)) throw new HubError(503, "HUB_INVALID");
  return d.user;
}

/** Claims of an evora-athletes ID token minted with hubClaims(): still enabled with the same role/version? */
export async function checkHubClaims(env, claims) {
  if (claims.evoraHub !== true || !claims.firebase || claims.firebase.sign_in_provider !== "custom") throw new HubError(403, "NOT_HUB");
  const d = await rpc(env, "check", { uid: claims.sub, role: claims.role, version: claims.evoraVersion });
  const u = d && d.user;
  if (!validPrincipal(u) || u.uid !== claims.sub || u.role !== claims.role || u.version !== claims.evoraVersion) throw new HubError(403, "HUB_IDENTITY_MISMATCH");
  return u;
}

/** Global HUB logout for this exact identity (bumps the HUB version: every session is denied). */
export async function logoutHub(env, claims) {
  await rpc(env, "logout", { uid: claims.sub, role: claims.role, version: claims.evoraVersion });
}

/** Claims carried by the evora-athletes custom token; Firestore Rules read `role`. */
export const hubClaims = user => ({ role: user.role, evoraHub: true, evoraVersion: user.version });

/**
 * Invalidates this person's evora-athletes refresh tokens. Best effort: the HUB check stays
 * authoritative for the Worker; an already issued ID token can remain valid up to ~1 hour.
 */
export async function revokeFirebaseSessions(sa, projectId, uid, fetchImpl = (i, n) => fetch(i, n)) {
  try {
    const iat = Math.floor(Date.now() / 1000);
    const assertion = await signJwt(sa.private_key, {
      iss: sa.client_email, scope: "https://www.googleapis.com/auth/identitytoolkit",
      aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600
    });
    const t = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!t.ok) return false;
    const { access_token } = await t.json();
    if (typeof access_token !== "string") return false;
    const r = await fetchImpl(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:update`, {
      method: "POST", headers: { Authorization: "Bearer " + access_token, "Content-Type": "application/json" },
      body: JSON.stringify({ localId: uid, validSince: String(iat) }), signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    return r.ok;
  } catch { return false; }
}
