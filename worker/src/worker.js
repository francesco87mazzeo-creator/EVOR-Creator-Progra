/**
 * EVORΛ COLLECTIVE — Cloudflare Worker throbbing-feather-957f
 *
 * Sorgente della versione in produzione 381ad99c-3756-4335-9391-84cd2ad5eb4c (pubblicata il 2026-10-27):
 * provenienza, hash e verifica riproducibile in worker/README.md. Questo commento è l'unica differenza
 * dal sorgente pubblicato e non compare nel bundle.
 * Integra la convalida server (server/collective) con le protezioni OCR/Telegram.
 * /auth mantiene la logica originale dei codici staff (da sostituire con EVORΛ Identity).
 * Più moduli: va pubblicato con wrangler (bundle), non incollato nell'editor della dashboard.
 *
 * Endpoint
 *   POST /applications  candidatura pubblica (54 campi) → { ok, id }   convalida + Firestore + notifica
 *   POST /admin/scoring configurazione scoring    → { ok, scoring }   solo admin (ID token Firebase verificato)
 *   POST /auth          { code }                   → { ok, role, token }   invariato
 *   POST /ocr           richiesta OCR del frontend  → { content:[{type,text}] }
 *   POST /              alias di /ocr, usato dal frontend attuale (stessi controlli)
 *   POST /notify        messaggio del frontend      → { ok }   solo i due modelli previsti (transizione)
 *
 * Secret
 *   ANTHROPIC_KEY, ADMIN_CODE, MANAGER_CODE, FIREBASE_SERVICE_ACCOUNT, TG_TOKEN, TG_CHAT
 *   TURNSTILE_SECRET (facoltativo: se presente, /ocr e /notify richiedono X-Turnstile-Token)
 *
 * Variabili
 *   ALLOWED_ORIGIN   OBBLIGATORIA per /ocr e /notify, es. https://collective.evorafitness.it
 *                    (più origini separate da virgola). Se assente, /ocr e /notify rispondono 503.
 *   OCR_MODEL        facoltativa, predefinita claude-sonnet-4-5 (deve coincidere con il frontend)
 *
 *   FIRESTORE_PROJECT_ID  facoltativa, altrimenti project_id del service account
 *   FIRESTORE_BASE_URL    solo test locali con l'Emulator (loopback); assente in produzione
 *
 * Binding facoltativi (Workers Rate Limiting API). Se assenti vale il limite in memoria, per istanza.
 *   OCR_LIMITER, NOTIFY_LIMITER, APPLICATION_LIMITER, ADMIN_LIMITER
 */
import { parsePublicApplicationJson, prepareApplication, ValidationError, MAX_JSON_BYTES } from "../../server/collective/application.mjs";
import { computeScore, validateScoringConfig } from "../../server/collective/scoring.mjs";
import { createFirestoreClient, FirestoreError } from "./firestore.mjs";
import { b64url, importPrivateKey } from "./google-auth.mjs";
import { verifyFirebaseIdToken, IdTokenError } from "./firebase-id-token.mjs";

/* ---------- Limiti ---------- */
const LIMITS = {
  applicationBodyBytes: MAX_JSON_BYTES,   // 1 MiB, come il validatore di Codex
  applicationPerIp: { max: 10, windowMs: 60 * 60 * 1000 },
  applicationPerIsolate: { max: 100, windowMs: 60 * 60 * 1000 },
  scoringCacheMs: 60 * 1000,
  adminBodyBytes: 64_000,       // la configurazione completa occupa circa 2 KB
  adminPerIp: { max: 30, windowMs: 10 * 60 * 1000 },
  adminPerIsolate: { max: 120, windowMs: 60 * 60 * 1000 },
  adminSessionS: 8 * 3600,      // come SESSION_HOURS del pannello, ma imposto dal server
  ocrBodyBytes: 1_000_000,      // il frontend comprime a ≤ 700.000 caratteri di base64
  ocrImageChars: 700_000,
  ocrPromptChars: 8_000,
  ocrMaxTokens: 256,            // il frontend usa 100, 200 e 220
  ocrResponseChars: 4_000,
  notifyBodyBytes: 8_000,
  authBodyBytes: 2_000,
  upstreamTimeoutMs: 25_000,
  // Limiti in memoria (per istanza): sono un freno, non una quota globale.
  ocrPerIp: { max: 20, windowMs: 10 * 60 * 1000 },
  ocrPerIsolate: { max: 300, windowMs: 60 * 60 * 1000 },
  notifyPerIp: { max: 3, windowMs: 10 * 60 * 1000 },
  notifyPerIsolate: { max: 60, windowMs: 60 * 60 * 1000 }
};
const DEFAULT_OCR_MODEL = "claude-sonnet-4-5";

/* SHA-256 dei soli prompt OCR inviati dal frontend (index.html @ 479213a).
   Rigenerabili con `npm run hashes`; i test verificano che coincidano con il frontend. */
const OCR_PROMPTS = new Map([
  ["2dea2bf57a430850da7d512740e5c8e3e303303adf669e65a25d361a61d7f79b", "insights"],
  ["d0ccf33b257582fdf51e6a6941a909197eb77cbffe577af6b7bfa2e599a481eb", "profile"],
  ["05e43f92b7dadb41d368ba45c89cbd8e2c3ee6bb0d7edb6aa436738ae3bb430d", "verify:Visualizzazioni"],
  ["1c12cf071c4c3bcae35cddb173362a7253e87e5e71d0b1d6fef481a770daa9eb", "verify:Follower netti"],
  ["d0304d49c2c846e3fd54cfd83508cddf6267cd821ea0f8507301e9d088b2c582", "verify:Interazioni"],
  ["441b34dfcbe42db90643cf87d25deae8d42994ec19e6256737d636a1d4132eab", "verify:Account raggiunti"]
]);

const PROGRAM = "EVORΛ COLLECTIVE";
const TEST_MESSAGE = "✅ <b>" + PROGRAM + "</b> — canale di notifica attivo.";

/* ---------- Risposte e CORS ---------- */
function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }, headers || {})
  });
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGIN || "")
    .split(",").map(s => s.trim()).filter(s => /^https:\/\/[^\s/]+$/.test(s));
}

/** CORS degli endpoint protetti: solo le origini configurate, mai riflesse. */
function strictCors(env, request) {
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, anthropic-version, X-Turnstile-Token, Idempotency-Key, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  if (allowedOrigins(env).includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

/** CORS originale, mantenuto solo per /auth (fuori perimetro di questa revisione). */
function legacyCors(env, request) {
  const allowed = env.ALLOWED_ORIGIN;
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowed ? allowed : (origin || "*"),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

/* ---------- Lettura del corpo con limite ---------- */
/** Legge lo stream fermandosi appena supera il limite: non si fida del solo Content-Length. */
async function readLimitedText(request, maxBytes) {
  const type = request.headers.get("Content-Type") || "";
  if (!/^application\/json\b/i.test(type)) return { error: [415, "Formato non supportato"] };
  const declared = Number(request.headers.get("Content-Length") || "0");
  if (declared > maxBytes) return { error: [413, "Richiesta troppo grande"] };
  if (!request.body) return { text: "" };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch (e) {}
      return { error: [413, "Richiesta troppo grande"] };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) }; }
  catch (e) { return { error: [400, "Richiesta non valida"] }; }
}

async function readJson(request, maxBytes) {
  const read = await readLimitedText(request, maxBytes);
  if (read.error) return read;
  try { return { value: JSON.parse(read.text) }; }
  catch (e) { return { error: [400, "Richiesta non valida"] }; }
}

/* ---------- Limite di frequenza ---------- */
const windows = new Map();
function memoryLimited(key, rule) {
  const now = Date.now();
  if (windows.size > 5000) {
    for (const [k, w] of windows) if (now > w.until) windows.delete(k);
    if (windows.size > 5000) return true; // memoria piena: si nega, non si apre
  }
  const w = windows.get(key);
  if (!w || now > w.until) {
    windows.set(key, { count: 1, until: now + rule.windowMs });
    return false;
  }
  w.count++;
  return w.count > rule.max;
}

async function rateLimited(env, bindingName, scope, ip, perIp, perIsolate) {
  const binding = env[bindingName];
  if (binding && typeof binding.limit === "function") {
    try {
      const { success } = await binding.limit({ key: scope + ":" + ip });
      if (!success) return true;
    } catch (e) { /* binding non disponibile: resta il limite in memoria */ }
  }
  return memoryLimited(scope + ":ip:" + ip, perIp) || memoryLimited(scope + ":all", perIsolate);
}

/* ---------- Turnstile (facoltativo) ---------- */
async function turnstileFailed(env, request, ip) {
  if (!env.TURNSTILE_SECRET) return false;
  const token = request.headers.get("X-Turnstile-Token") || "";
  if (!token || token.length > 2048) return true;
  try {
    const form = new FormData();
    form.append("secret", env.TURNSTILE_SECRET);
    form.append("response", token);
    if (ip) form.append("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body: form, signal: AbortSignal.timeout(5000)
    });
    const data = await r.json();
    return !data.success;
  } catch (e) { return true; }
}

/* ---------- Guardia comune (origine, frequenza, Turnstile facoltativo) ---------- */
async function guard(env, request, opts) {
  const headers = strictCors(env, request);
  if (allowedOrigins(env).length === 0) return { response: json({ ok: false, error: "Servizio non configurato" }, 503, headers) };
  if (!headers["Access-Control-Allow-Origin"]) return { response: json({ ok: false, error: "Origine non consentita" }, 403, headers) };
  const ip = request.headers.get("CF-Connecting-IP") || "sconosciuto";
  if (await rateLimited(env, opts.binding, opts.scope, ip, opts.perIp, opts.perIsolate)) {
    return { response: json({ ok: false, error: "Troppe richieste, riprova più tardi" }, 429, Object.assign({ "Retry-After": "600" }, headers)) };
  }
  if (opts.turnstile !== false && await turnstileFailed(env, request, ip)) return { response: json({ ok: false, error: "Verifica non superata" }, 403, headers) };
  return { headers };
}

/* ---------- OCR ---------- */
const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);
const hasExactKeys = (o, keys) => isObject(o) && Object.keys(o).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(o, k));

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function isJpegBase64(data) {
  if (typeof data !== "string" || data.length < 8 || data.length > LIMITS.ocrImageChars) return false;
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return false;
  try {
    const head = atob(data.slice(0, 8));
    return head.charCodeAt(0) === 0xFF && head.charCodeAt(1) === 0xD8 && head.charCodeAt(2) === 0xFF;
  } catch (e) { return false; }
}

/**
 * Accetta solo la forma esatta delle richieste del frontend e ricostruisce il corpo
 * inviato ad Anthropic: modello fisso, max_tokens limitato, un'immagine JPEG e uno dei prompt previsti.
 */
async function buildOcrRequest(body, env) {
  const model = env.OCR_MODEL || DEFAULT_OCR_MODEL;
  if (!hasExactKeys(body, ["model", "max_tokens", "messages"])) return null;
  if (body.model !== model) return null;
  if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > LIMITS.ocrMaxTokens) return null;
  if (!Array.isArray(body.messages) || body.messages.length !== 1) return null;
  const msg = body.messages[0];
  if (!hasExactKeys(msg, ["role", "content"]) || msg.role !== "user") return null;
  if (!Array.isArray(msg.content) || msg.content.length !== 2) return null;
  const [image, prompt] = msg.content;
  if (!hasExactKeys(image, ["type", "source"]) || image.type !== "image") return null;
  if (!hasExactKeys(image.source, ["type", "media_type", "data"])) return null;
  if (image.source.type !== "base64" || image.source.media_type !== "image/jpeg") return null;
  if (!isJpegBase64(image.source.data)) return null;
  if (!hasExactKeys(prompt, ["type", "text"]) || prompt.type !== "text") return null;
  if (typeof prompt.text !== "string" || prompt.text.length > LIMITS.ocrPromptChars) return null;
  if (!OCR_PROMPTS.has(await sha256Hex(prompt.text))) return null;
  return {
    model,
    max_tokens: body.max_tokens,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image.source.data } },
        { type: "text", text: prompt.text }
      ]
    }]
  };
}

async function handleOcr(request, env) {
  const g = await guard(env, request, {
    binding: "OCR_LIMITER", scope: "ocr", perIp: LIMITS.ocrPerIp, perIsolate: LIMITS.ocrPerIsolate
  });
  if (g.response) return g.response;
  const headers = g.headers;
  const fail = (status, message) => json({ error: { message } }, status, headers);

  if (!env.ANTHROPIC_KEY) return fail(503, "Servizio non configurato");
  const parsed = await readJson(request, LIMITS.ocrBodyBytes);
  if (parsed.error) return fail(parsed.error[0], parsed.error[1]);
  const outgoing = await buildOcrRequest(parsed.value, env);
  if (!outgoing) return fail(400, "Richiesta non consentita");

  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(outgoing),
      signal: AbortSignal.timeout(LIMITS.upstreamTimeoutMs)
    });
  } catch (e) { return fail(502, "Servizio non disponibile"); }

  if (!r.ok) return fail(r.status === 429 ? 429 : 502, "Servizio non disponibile");
  let data;
  try { data = await r.json(); } catch (e) { return fail(502, "Servizio non disponibile"); }
  const block = Array.isArray(data && data.content) ? data.content.find(c => c && c.type === "text" && typeof c.text === "string") : null;
  if (!block) return fail(502, "Servizio non disponibile");
  // Solo il testo: nessun dettaglio di modello, utilizzo o identificativi.
  return json({ content: [{ type: "text", text: block.text.slice(0, LIMITS.ocrResponseChars) }] }, 200, headers);
}

/* ---------- Notifiche Telegram ---------- */
function unescapeTg(s) {
  return String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
function escapeTg(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
/** Testo libero del candidato: niente link, menzioni o comandi cliccabili su Telegram. */
function plain(s, max) {
  const t = unescapeTg(s).replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, max)
    .replace(/:\/\//g, ":⁄⁄")
    .replace(/\./g, "․")
    .replace(/@/g, "＠")
    .replace(/^\//, "⁄");
  return escapeTg(t);
}

// toLocaleString("it-IT"): "8500", "24.800", "1.250.000" (sotto 10.000 il separatore può mancare).
const NUM = "-?\\d{1,4}(?:\\.\\d{3})*";
const DEC = "(?:-?\\d+(?:\\.\\d+)?|NaN|-?Infinity)";
const FREE = "[^\\n<>]";
const APPLICATION_TEMPLATE = new RegExp(
  "^🔔 <b>" + PROGRAM + "</b>\\nNuova candidatura\\n\\n" +
  "👤 <b>(?<name>" + FREE + "{1,300})</b>\\n" +
  "(?:📱 Instagram: (?:<a href=\"https://www\\.instagram\\.com/(?<igUrl>[A-Za-z0-9._]{1,100})/\">@(?<igHandle>[A-Za-z0-9._]{1,100})</a>|(?<igText>" + FREE + "{1,300}))\\n)?" +
  "(?:🎵 TikTok: <a href=\"https://www\\.tiktok\\.com/@(?<ttUrl>[A-Za-z0-9._]{1,100})\">@(?<ttHandle>[A-Za-z0-9._]{1,100})</a>\\n)?" +
  "🏷 (?<cats>" + FREE + "{1,500})\\n" +
  "👥 (?<followers>" + NUM + ") follower · fascia (?<band>" + FREE + "{1,60})\\n\\n" +
  "👁 Visualizzazioni: (?<views>" + NUM + ")\\n" +
  "🎯 Account raggiunti: (?<reached>" + NUM + ")\\n" +
  "💬 Interazioni: (?<interactions>" + NUM + ")\\n" +
  "📈 Follower netti: (?<net>\\+?" + NUM + ")\\n\\n" +
  "ER (?<er>" + DEC + ")% · Reach (?<reach>" + DEC + ")% · Growth (?<growth>" + DEC + ")%\\n" +
  "📊 Social Performance Score: <b>(?<score>\\d{1,3})/100</b> · (?<perf>" + FREE + "{1,100})$"
);

/**
 * Ricostruisce il messaggio lato server. Accetta solo il messaggio di prova e il modello
 * "Nuova candidatura" del frontend; i link sono rigenerati dagli handle, il testo libero è neutralizzato.
 */
function renderNotification(text) {
  if (text === TEST_MESSAGE) return TEST_MESSAGE;
  const m = APPLICATION_TEMPLATE.exec(text);
  if (!m) return null;
  const g = m.groups;
  if (g.igUrl && g.igUrl !== g.igHandle) return null;
  if (g.ttUrl && g.ttUrl !== g.ttHandle) return null;
  if (Number(g.score) > 100) return null;
  const lines = [
    "🔔 <b>" + PROGRAM + "</b>", "Nuova candidatura", "",
    "👤 <b>" + plain(g.name, 200) + "</b>"
  ];
  if (g.igHandle) lines.push("📱 Instagram: <a href=\"https://www.instagram.com/" + g.igHandle + "/\">@" + g.igHandle + "</a>");
  else if (g.igText) lines.push("📱 Instagram: " + plain(g.igText, 200));
  if (g.ttHandle) lines.push("🎵 TikTok: <a href=\"https://www.tiktok.com/@" + g.ttHandle + "\">@" + g.ttHandle + "</a>");
  lines.push(
    "🏷 " + plain(g.cats, 400),
    "👥 " + g.followers + " follower · fascia " + plain(g.band, 40), "",
    "👁 Visualizzazioni: " + g.views,
    "🎯 Account raggiunti: " + g.reached,
    "💬 Interazioni: " + g.interactions,
    "📈 Follower netti: " + g.net, "",
    "ER " + g.er + "% · Reach " + g.reach + "% · Growth " + g.growth + "%",
    "📊 Social Performance Score: <b>" + g.score + "/100</b> · " + plain(g.perf, 80)
  );
  return lines.join("\n");
}

async function handleNotify(request, env) {
  const g = await guard(env, request, {
    binding: "NOTIFY_LIMITER", scope: "notify", perIp: LIMITS.notifyPerIp, perIsolate: LIMITS.notifyPerIsolate
  });
  if (g.response) return g.response;
  const headers = g.headers;

  const parsed = await readJson(request, LIMITS.notifyBodyBytes);
  if (parsed.error) return json({ ok: false, description: parsed.error[1] }, parsed.error[0], headers);
  const body = parsed.value;
  if (!hasExactKeys(body, ["text"]) || typeof body.text !== "string") {
    return json({ ok: false, description: "Richiesta non valida" }, 400, headers);
  }
  const message = renderNotification(body.text);
  if (!message) return json({ ok: false, description: "Messaggio non consentito" }, 400, headers);
  if (!env.TG_TOKEN || !env.TG_CHAT) {
    return json({ ok: false, description: "Notifiche non configurate" }, 503, headers);
  }
  const sent = await sendTelegram(env, message);
  return json({ ok: sent, description: sent ? "" : "Notifica non inviata" }, sent ? 200 : 502, headers);
}

/** Invio al canale staff; destinatario e token vengono solo dai secret. */
async function sendTelegram(env, message) {
  if (!env.TG_TOKEN || !env.TG_CHAT) return false;
  try {
    const r = await fetch("https://api.telegram.org/bot" + env.TG_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TG_CHAT,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true
      }),
      signal: AbortSignal.timeout(LIMITS.upstreamTimeoutMs)
    });
    const data = await r.json();
    return !!data.ok;
  } catch (err) {
    return false;
  }
}

/* ---------- Candidature pubbliche ---------- */
// Etichette delle categorie come in index.html (CATEGORIES); i test le confrontano con il frontend.
const CATEGORY_LABELS = {
  creator: "Creator fitness", coach: "Coach / Personal trainer", agonista: "Atleta agonista",
  non_agonista: "Atleta non agonista", lifestyle: "Lifestyle creator",
  palestra: "Titolare o collaboratore di palestra", professionista: "Professionista del settore", altro: "Altro"
};

const fmtInt = n => (parseInt(n) || 0).toLocaleString("it-IT");

const fmtPct = v => v === null ? "n/d" : v.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";

/**
 * Notifica della candidatura appena salvata, con il punteggio quantitativo v2 (configurazione 3).
 * Il testo libero passa da plain() come in renderNotification; i link sono rigenerati dagli handle convalidati.
 * Il modello del vecchio frontend resta solo in renderNotification, per /notify.
 */
function applicationMessage(doc, s) {
  const cats = doc.profileCategories.length ? doc.profileCategories.map(c => CATEGORY_LABELS[c] || "—").join(", ") : "—";
  const lines = [
    "🔔 <b>" + PROGRAM + "</b>", "Nuova candidatura", "",
    "👤 <b>" + plain(doc.fullName, 200) + "</b>"
  ];
  if (doc.instagramHandle) lines.push("📱 Instagram: <a href=\"https://www.instagram.com/" + doc.instagramHandle + "/\">@" + doc.instagramHandle + "</a>");
  if (doc.tiktokHandle) lines.push("🎵 TikTok: <a href=\"https://www.tiktok.com/@" + doc.tiktokHandle + "\">@" + doc.tiktokHandle + "</a>");
  lines.push(
    "🏷 " + plain(cats, 400),
    "👥 " + fmtInt(doc.followers) + " follower", "",
    "👁 Visualizzazioni: " + fmtInt(doc.views),
    "💬 Interazioni: " + fmtInt(doc.interactions),
    "📈 Follower netti: " + (doc.netFollowers > 0 ? "+" : "") + fmtInt(doc.netFollowers),
    "🎯 Account raggiunti: " + (doc.accountsReached === null ? "non indicati" : fmtInt(doc.accountsReached)), "",
    "📊 Punteggio quantitativo: <b>" + s.socialScore + "/100</b> (scoring v2)",
    "Coinvolgimento " + fmtPct(s.engagementRate) + " · Indicatore B " + fmtPct(s.reachEngagementRate) + " (non incide)"
  );
  if (s.lowBase) lines.push("⚠️ Base di osservazione molto ridotta");
  return lines.join("\n");
}

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return [...bytes].map(b => ID_ALPHABET[b % 62]).join("");
}

let scoringCache = null;
async function loadScoring(client) {
  const now = Date.now();
  if (scoringCache && scoringCache.until > now) return scoringCache.value;
  const value = await client.getDocument("settings/scoring");
  scoringCache = { value, until: now + LIMITS.scoringCacheMs };
  return value;
}

async function handleApplication(request, env, ctx) {
  const g = await guard(env, request, {
    binding: "APPLICATION_LIMITER", scope: "application",
    perIp: LIMITS.applicationPerIp, perIsolate: LIMITS.applicationPerIsolate
  });
  if (g.response) return g.response;
  const headers = g.headers;
  const fail = (status, error) => json({ ok: false, error }, status, headers);

  const idemKey = request.headers.get("Idempotency-Key");
  if (idemKey !== null && !/^[A-Za-z0-9-]{16,64}$/.test(idemKey)) return fail(400, { code: "IDEMPOTENCY_KEY", path: "$" });

  const read = await readLimitedText(request, LIMITS.applicationBodyBytes);
  if (read.error) return fail(read.error[0], { code: read.error[0] === 413 ? "BODY_TOO_LARGE" : "INVALID_REQUEST", path: "$" });

  // 1 · convalida del candidato (Codex): errori con codice e percorso, mai il valore rifiutato
  let candidate;
  try { candidate = parsePublicApplicationJson(read.text); }
  catch (e) {
    if (e instanceof ValidationError) return fail(400, { code: e.code, path: e.path });
    return fail(400, { code: "INVALID_REQUEST", path: "$" });
  }

  if (!env.FIREBASE_SERVICE_ACCOUNT) return fail(503, { code: "NOT_CONFIGURED", path: "$" });
  let client;
  try {
    client = createFirestoreClient({
      serviceAccount: JSON.parse(env.FIREBASE_SERVICE_ACCOUNT),
      projectId: env.FIRESTORE_PROJECT_ID,
      baseUrl: env.FIRESTORE_BASE_URL
    });
  } catch (e) { return fail(503, { code: "NOT_CONFIGURED", path: "$" }); }

  // 2 · documento preparato con orologio e scoring del server; un errore qui non è colpa del candidato
  let doc, social;
  try {
    const scoring = await loadScoring(client);
    doc = prepareApplication(candidate, { now: new Date().toISOString(), scoring });
    social = computeScore(doc, scoring);
  } catch (e) {
    console.error(JSON.stringify({ evt: "application_prepare_failed", kind: e instanceof FirestoreError ? e.stage : (e.code || e.name) }));
    return fail(503, { code: "SERVICE_UNAVAILABLE", path: "$" });
  }

  // 3 · creazione senza sovrascrittura; la stessa Idempotency-Key produce lo stesso ID
  const id = idemKey ? "k" + (await sha256Hex("collective-application:" + idemKey)).slice(0, 31) : randomId();
  let outcome;
  try { outcome = await client.createDocument("candidature", id, doc); }
  catch (e) {
    console.error(JSON.stringify({ evt: "application_write_failed", status: e.status || e.name }));
    return fail(503, { code: "SERVICE_UNAVAILABLE", path: "$" });
  }
  if (outcome === "exists") {
    if (idemKey) return json({ ok: true, id, duplicate: true }, 200, headers);
    return fail(503, { code: "SERVICE_UNAVAILABLE", path: "$" }); // collisione di un ID casuale: non sovrascrive
  }

  // 4 · notifica allo staff: separata, un errore non annulla la candidatura
  const message = applicationMessage(doc, social);
  const notify = message ? sendTelegram(env, message) : Promise.resolve(false);
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(notify);
  else await notify;

  return json({ ok: true, id }, 201, headers);
}

/* ---------- Scoring amministrativo ---------- */
/**
 * Sostituisce settings/scoring come FB.saveScoring del pannello, ma dal server:
 * ID token Firebase verificato con claim role "admin", configurazione convalidata (Codex), scrittura del service account.
 * Turnstile non si applica: l'autorizzazione è il token dello staff.
 */
async function handleAdminScoring(request, env) {
  const g = await guard(env, request, {
    binding: "ADMIN_LIMITER", scope: "admin", perIp: LIMITS.adminPerIp, perIsolate: LIMITS.adminPerIsolate, turnstile: false
  });
  if (g.response) return g.response;
  const headers = g.headers;
  const fail = (status, error) => json({ ok: false, error }, status, headers);
  const deny = (status, code, reason) => {
    console.warn(JSON.stringify({ evt: "scoring_denied", reason }));
    return fail(status, { code, path: "$" });
  };

  // 1 · autorizzazione, prima di leggere il corpo
  const m = /^Bearer ([A-Za-z0-9_.-]{1,4096})$/.exec(request.headers.get("Authorization") || "");
  if (!m) return deny(401, "AUTH_REQUIRED", "assente");
  if (!env.FIREBASE_SERVICE_ACCOUNT) return fail(503, { code: "NOT_CONFIGURED", path: "$" });
  let sa, client;
  try {
    sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    client = createFirestoreClient({ serviceAccount: sa, projectId: env.FIRESTORE_PROJECT_ID, baseUrl: env.FIRESTORE_BASE_URL });
  } catch (e) { return fail(503, { code: "NOT_CONFIGURED", path: "$" }); }
  let claims;
  try {
    claims = await verifyFirebaseIdToken(m[1], {
      projectId: env.FIRESTORE_PROJECT_ID || sa.project_id, maxAuthAgeS: LIMITS.adminSessionS
    });
  } catch (e) {
    if (e instanceof IdTokenError && e.reason === "invalid") return deny(401, "AUTH_INVALID", e.detail);
    return fail(503, { code: "SERVICE_UNAVAILABLE", path: "$" });
  }
  // Il ruolo arriva solo da /auth (token personalizzato firmato dal service account).
  const provider = claims.firebase && claims.firebase.sign_in_provider;
  if (claims.role !== "admin" || provider !== "custom") return deny(403, "FORBIDDEN", "ruolo");

  // 2 · convalida della configurazione: la stessa che /applications applica in lettura
  const parsed = await readJson(request, LIMITS.adminBodyBytes);
  if (parsed.error) return fail(parsed.error[0], { code: parsed.error[0] === 413 ? "BODY_TOO_LARGE" : "INVALID_REQUEST", path: "$" });
  let config;
  try { config = validateScoringConfig(parsed.value); }
  catch (e) {
    if (e instanceof ValidationError) return fail(400, { code: e.code, path: e.path });
    return fail(400, { code: "INVALID_REQUEST", path: "$" });
  }

  // 3 · scrittura completa, come set() senza merge
  try { await client.setDocument("settings/scoring", config); }
  catch (e) {
    console.error(JSON.stringify({ evt: "scoring_write_failed", status: e.status || e.name }));
    return fail(503, { code: "SERVICE_UNAVAILABLE", path: "$" });
  }
  scoringCache = null;   // le altre istanze si allineano entro scoringCacheMs
  console.log(JSON.stringify({ evt: "scoring_saved", uid: claims.sub, role: claims.role }));
  return json({ ok: true, scoring: config }, 200, headers);
}

/* ---------- /auth: logica originale invariata ---------- */
function safeEqual(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

// b64url e importPrivateKey: stesso codice di prima, spostato in google-auth.mjs e condiviso con Firestore.
async function mintCustomToken(serviceAccount, uid, claims) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat: now,
    exp: now + 3600,
    uid: uid,
    claims: claims
  }));
  const key = await importPrivateKey(serviceAccount.private_key);
  const data = new TextEncoder().encode(header + "." + payload);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, data);
  return header + "." + payload + "." + b64url(sig);
}

const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now > rec.until) {
    attempts.set(ip, { count: 1, until: now + 15 * 60 * 1000 });
    return false;
  }
  rec.count++;
  return rec.count > 12;
}
function clearAttempts(ip) { attempts.delete(ip); }

async function handleAuth(request, env, headers) {
  const ip = request.headers.get("CF-Connecting-IP") || "sconosciuto";
  if (tooManyAttempts(ip)) {
    return json({ ok: false, error: "Troppi tentativi" }, 429, headers);
  }
  const declared = Number(request.headers.get("Content-Length") || "0");
  if (declared > LIMITS.authBodyBytes) return json({ ok: false, error: "Richiesta troppo grande" }, 413, headers);

  let body = {};
  try { body = await request.json(); } catch (e) {}
  const code = String(body.code || "").trim();
  if (!code) return json({ ok: false, error: "Codice mancante" }, 401, headers);

  let role = null;
  if (env.ADMIN_CODE && safeEqual(code, env.ADMIN_CODE)) role = "admin";
  else if (env.MANAGER_CODE && safeEqual(code, env.MANAGER_CODE)) role = "manager";

  if (!role) {
    await new Promise(r => setTimeout(r, 600));
    return json({ ok: false, error: "Codice non riconosciuto" }, 401, headers);
  }
  if (!env.FIREBASE_SERVICE_ACCOUNT) {
    return json({ ok: false, error: "Credenziale server non configurata" }, 500, headers);
  }
  try {
    const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    const token = await mintCustomToken(sa, "staff-" + role, { role: role });
    clearAttempts(ip);
    return json({ ok: true, role: role, token: token }, 200, headers);
  } catch (err) {
    return json({ ok: false, error: "Firma non riuscita: " + err.message }, 500, headers);
  }
}

/* ---------- Handler ---------- */
export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    const isAuth = path === "/auth";
    const headers = isAuth ? legacyCors(env, request) : strictCors(env, request);

    if (request.method === "OPTIONS") {
      if (!isAuth && !headers["Access-Control-Allow-Origin"]) return new Response(null, { status: 403, headers });
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") {
      return json({ ok: false, error: "Metodo non consentito" }, 405, Object.assign({ Allow: "POST, OPTIONS" }, headers));
    }
    if (isAuth) return handleAuth(request, env, headers);
    if (path === "/applications") return handleApplication(request, env, ctx);
    if (path === "/admin/scoring") return handleAdminScoring(request, env);
    if (path === "/notify") return handleNotify(request, env);
    if (path === "" || path === "/ocr") return handleOcr(request, env);
    return json({ ok: false, error: "Endpoint non trovato" }, 404, headers);
  }
};
