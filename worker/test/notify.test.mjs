import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  freshWorker, baseEnv, post, mockFetch, telegramOk,
  frontendApplicationMessage, frontendTestMessage, applicationDoc, score,
} from './helpers.mjs';

async function notify(body, opts = {}, env = baseEnv()) {
  const worker = await freshWorker();
  const mock = mockFetch(opts.upstream || telegramOk());
  try {
    const res = await worker.fetch(post('/notify', body, opts), env);
    return { res, json: await res.json().catch(() => null), calls: mock.calls };
  } finally { mock.restore(); }
}

test('Telegram: messaggio reale "Nuova candidatura" del frontend inoltrato identico', async () => {
  const text = await frontendApplicationMessage(applicationDoc(), score());
  const { res, json, calls } = await notify({ text });
  assert.equal(res.status, 200);
  assert.deepEqual(json, { ok: true, description: '' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.text, text);
  assert.equal(calls[0].body.parse_mode, 'HTML');
  assert.equal(calls[0].body.disable_web_page_preview, true);
  assert.equal(calls[0].body.chat_id, '-100000');
});

test('Telegram: varianti reali del frontend (senza TikTok, Instagram non riconosciuto, follower netti negativi, decimali)', async () => {
  const variants = [
    [applicationDoc({ tiktok: '' }), score()],
    [{ ...applicationDoc({ tiktok: '' }), instagram: '???', instagramHandle: '', instagramUrl: '' }, score()],
    [applicationDoc({ netFollowers: -1234, followers: 1250000 }), score({ growth: -0.5, er: 0 })],
    [applicationDoc({ profileCategories: ['altro'] }), score({ socialScore: 0, perfLabel: 'Performance numerica bassa' })],
  ];
  for (const [doc, s] of variants) {
    const text = await frontendApplicationMessage(doc, s);
    const { res, calls } = await notify({ text });
    assert.equal(res.status, 200, text);
    assert.equal(calls[0].body.text, text);
  }
});

test('Telegram: messaggio di prova della scheda Impostazioni accettato', async () => {
  const text = frontendTestMessage();
  const { res, calls } = await notify({ text });
  assert.equal(res.status, 200);
  assert.equal(calls[0].body.text, text);
});

test('Telegram: nome con link, menzioni e tag viene neutralizzato', async () => {
  const doc = applicationDoc({ fullName: 'Promo https://evil.example/login <a href="https://evil.example">clicca</a> @admin /start' });
  const text = await frontendApplicationMessage(doc, score());
  const { res, calls } = await notify({ text });
  assert.equal(res.status, 200);
  const sent = calls[0].body.text;
  const nameLine = sent.split('\n').find(l => l.startsWith('👤'));
  assert.ok(!/https?:\/\//.test(nameLine), nameLine);
  assert.ok(!/evil\.example/.test(nameLine), nameLine);
  assert.ok(!nameLine.includes('<a'), nameLine);
  assert.ok(!nameLine.includes('@admin'), nameLine);
  assert.equal((sent.match(/<a href=/g) || []).length, 2, 'solo i link Instagram e TikTok ricostruiti');
});

const rejectedTexts = {
  'testo libero': 'Ciao, questo è spam',
  'messaggio di phishing con HTML': '<b>URGENTE</b> accedi a <a href="https://evil.example">questo link</a>',
  'messaggio di prova modificato': '✅ <b>EVORΛ COLLECTIVE</b> — canale di notifica attivo. Vai su https://evil.example',
  'programma diverso': null,
  'link Instagram verso altro dominio': null,
  'handle del link diverso dal testo': null,
  'riga aggiuntiva in coda': null,
  'score oltre 100': null,
};
const base = await frontendApplicationMessage(applicationDoc(), score());
rejectedTexts['programma diverso'] = base.replace('EVORΛ COLLECTIVE', 'EVORA BANK');
rejectedTexts['link Instagram verso altro dominio'] = base.replace('https://www.instagram.com/profilo_prova/', 'https://evil.example/profilo_prova/');
rejectedTexts['handle del link diverso dal testo'] = base.replace('>@profilo_prova</a>', '>@altro_profilo</a>');
rejectedTexts['riga aggiuntiva in coda'] = base + '\n👉 <a href="https://evil.example">Verifica account</a>';
rejectedTexts['score oltre 100'] = base.replace('<b>87/100</b>', '<b>870/100</b>');

for (const [name, text] of Object.entries(rejectedTexts)) {
  test(`Telegram rifiuta: ${name}`, async () => {
    const { res, calls } = await notify({ text });
    assert.equal(res.status, 400);
    assert.equal(calls.length, 0, 'nessuna chiamata a Telegram');
  });
}

test('Telegram rifiuta campi extra, testo non stringa, corpo oltre il limite', async () => {
  assert.equal((await notify({ text: base, chat_id: '123' })).res.status, 400);
  assert.equal((await notify({ text: 42 })).res.status, 400);
  assert.equal((await notify({ text: 'x'.repeat(9000) })).res.status, 413);
});

test('Telegram: limite per IP (4ª notifica in 10 minuti → 429)', async () => {
  const worker = await freshWorker();
  const mock = mockFetch(telegramOk());
  try {
    for (let i = 0; i < 3; i++) assert.equal((await worker.fetch(post('/notify', { text: base }, { ip: '198.51.100.7' }), baseEnv())).status, 200);
    assert.equal((await worker.fetch(post('/notify', { text: base }, { ip: '198.51.100.7' }), baseEnv())).status, 429);
    assert.equal(mock.calls.length, 3);
  } finally { mock.restore(); }
});

test('Telegram: non configurato → 503; errore Telegram → messaggio generico senza token', async () => {
  const off = await notify({ text: base }, {}, baseEnv({ TG_TOKEN: '' }));
  assert.equal(off.res.status, 503);
  assert.equal(off.calls.length, 0);
  const err = await notify({ text: base }, { upstream: () => new Response(JSON.stringify({ ok: false, description: 'Unauthorized bot test-telegram-token-not-real' }), { status: 401 }) });
  assert.equal(err.res.status, 502);
  assert.deepEqual(err.json, { ok: false, description: 'Notifica non inviata' });
  assert.ok(!JSON.stringify(err.json).includes('test-telegram-token'));
});

test('Telegram: con binding Rate Limiting configurato, il suo rifiuto blocca prima di Telegram', async () => {
  const env = baseEnv({ NOTIFY_LIMITER: { limit: async () => ({ success: false }) } });
  const { res, calls } = await notify({ text: base }, {}, env);
  assert.equal(res.status, 429);
  assert.equal(calls.length, 0);
});
