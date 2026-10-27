# Ambiente di test dopo la dismissione dello staging (ottobre 2026)

Lo staging Cloudflare Worker e Firebase `evora-collective-staging` sono stati dismessi.

## Configurazione runtime

- Il sito pubblico HTTPS usa esclusivamente Worker `throbbing-feather-957f` e Firebase `evora-athletes`.
- `localhost`, `127.0.0.1` e `[::1]` non possono più inizializzare l'app con servizi live. Il blocco è intenzionale: **nessun fallback alla produzione**.
- `file://`, HTTP pubblico e override `EVORA_TEST_WORKER_BASE` sono rifiutati.

## Test

I test unitari della configurazione verificano che i riferimenti produttivi rimangano invariati e che l'ambiente locale fallisca in modo sicuro.

**Attenzione:** la suite browser Playwright in `test/frontend/browser.test.mjs` era stata costruita attorno alla configurazione staging e necessita ancora di migrazione a un harness completamente isolato. Non usarla come prova di compatibilità fino al completamento di quella migrazione. Non sostituire semplicemente l'URL staging con quello di produzione.

La documentazione precedente dello staging è storica e non è più una procedura operativa. Prima di reintrodurre test end-to-end occorre un ambiente sintetico senza richieste reali, oppure un nuovo staging separato autorizzato.
