// Strumenti comuni ai test: Worker isolato per test, fetch simulato, frammenti reali del frontend.
import vm from 'node:vm';
import { legacyNotifyTelegram } from './legacy-notify-reference.mjs';

export const ORIGIN = 'https://collective.evorafitness.it';
export const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2Q==';

let instance = 0;
/** Ogni test riceve un modulo nuovo: i limiti in memoria non si sommano tra test. */
export async function freshWorker() {
  instance += 1;
  // WORKER_UNDER_TEST=worker.original.js esegue gli stessi test sul Worker attuale, per confronto.
  const file = process.env.WORKER_UNDER_TEST || 'src/worker.js';
  return (await import(`../${file}?instance=${instance}`)).default;
}

export function baseEnv(overrides = {}) {
  return {
    ALLOWED_ORIGIN: ORIGIN,
    ANTHROPIC_KEY: 'test-anthropic-key-not-real',
    TG_TOKEN: 'test-telegram-token-not-real',
    TG_CHAT: '-100000',
    ...overrides,
  };
}

export function post(path, body, { origin = ORIGIN, ip = '203.0.113.10', headers = {}, raw } = {}) {
  const h = { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...headers };
  if (origin) h.Origin = origin;
  return new Request(`https://worker.test${path}`, {
    method: 'POST', headers: h, body: raw !== undefined ? raw : JSON.stringify(body),
  });
}

/** Sostituisce fetch globale e registra ogni chiamata in uscita. */
export function mockFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    let body = init.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* form-urlencoded: resta stringa */ } }
    const call = { url: String(url), init, body };
    calls.push(call);
    return handler(call);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

export const anthropicOk = (text = '{"readable":true,"value":"1.234"}') => () =>
  new Response(JSON.stringify({
    id: 'msg_test', model: 'claude-sonnet-4-5', usage: { input_tokens: 10, output_tokens: 5 },
    content: [{ type: 'text', text }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

export const telegramOk = () => () =>
  new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });

/* ---------- Frammenti reali del frontend ---------- */
import { frontendSource as html } from '../../test/frontend/app-source.mjs'; // pagine e moduli app/
export const frontendSource = html;

function fragment(start, end) {
  const a = html.indexOf(start);
  const b = html.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`Frontend cambiato: ${start}`);
  return html.slice(a, b);
}

export const frontendProgram = /program:\s*"([^"]+)"/.exec(html)[1];
export const frontendOcrModel = /const OCR_MODEL\s*=\s*"([^"]+)"/.exec(html)[1];

/** Messaggio Telegram della funzione notifyTelegram del frontend (oracolo storico) con le utilità attuali. */
export function frontendApplicationMessage(doc, s) {
  const code = [
    `const BRAND = { program: ${JSON.stringify(frontendProgram)} };`,
    fragment('const CATEGORIES =', '/* ---- Stati candidatura'),
    fragment('const fmtInt', 'const fmtShort'),
    fragment('const cleanHandle', '/**'),
    fragment('const parseSocial =', '/**\n * Converte'),
    'let captured; const sendTelegram = async m => { captured = m; return { ok: true }; };',
    legacyNotifyTelegram,
    'notifyTelegram(doc, s).then(() => captured);',
  ].join('\n');
  return vm.runInNewContext(code, { doc, s, console });
}

/** Messaggio di prova della scheda Impostazioni, ricostruito dal sorgente del frontend. */
export function frontendTestMessage() {
  const m = /sendTelegram\("([^"]*)"\+BRAND\.program\+"([^"]*)"\)/.exec(html);
  if (!m) throw new Error('Messaggio di prova non trovato nel frontend');
  return vm.runInNewContext(`"${m[1]}"`) + frontendProgram + vm.runInNewContext(`"${m[2]}"`);
}

/** Documento come lo prepara submit() per la notifica. */
export function applicationDoc(over = {}) {
  const parse = (raw, network) => vm.runInNewContext(`${fragment('const parseSocial =', '/** Sfugge')}; parseSocial(raw, network)`, { raw, network });
  const ig = parse(over.instagram ?? '@profilo_prova', 'instagram');
  const tt = parse(over.tiktok ?? '@profilo_prova', 'tiktok');
  return {
    fullName: 'Candidato Prova', profileCategories: ['coach', 'creator'],
    instagram: ig.handle ? '@' + ig.handle : '', instagramHandle: ig.handle, instagramUrl: ig.url,
    tiktok: tt.handle ? '@' + tt.handle : '', tiktokHandle: tt.handle, tiktokUrl: tt.url,
    followers: 8500, views: 24800, accountsReached: 18400, interactions: 1120, netFollowers: 260,
    ...over,
  };
}
export const score = (over = {}) => ({
  bandLabel: '5K–20K', er: 13.176, reach: 216.47, growth: 3.0588, socialScore: 87, perfLabel: 'Performance numerica alta', ...over,
});
