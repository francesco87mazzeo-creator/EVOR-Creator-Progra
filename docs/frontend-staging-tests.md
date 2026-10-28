# Ambiente di test dopo la dismissione dello staging (ottobre 2026)

Lo staging Cloudflare Worker e Firebase `evora-collective-staging` sono stati dismessi.

## Configurazione runtime

- Il sito pubblico HTTPS usa esclusivamente Worker `throbbing-feather-957f` e Firebase `evora-athletes`.
- `localhost`, `127.0.0.1` e `[::1]` non possono più inizializzare l'app con servizi live. Il blocco è intenzionale: **nessun fallback alla produzione**.
- `file://`, HTTP pubblico e override `EVORA_TEST_WORKER_BASE` sono rifiutati.

## Test

I test unitari della configurazione verificano che:
- i riferimenti produttivi rimangano invariati e immutabili;
- l'ambiente locale fallisca in modo sicuro;
- non resti alcun riferimento allo staging dismesso.

### Suite browser (Playwright): completamente isolata

`test/frontend/browser.test.mjs` apre il sito sull'origine sintetica `https://synthetic.collective.test`.
Tre barriere impediscono qualsiasi chiamata reale:

1. **Intercettazione:** ogni richiesta passa da `context.route('**/*')`:
   - pagina, script e CDN sono serviti da file locali;
   - Firebase è sostituito da uno stub;
   - le POST al Worker ricevono risposte simulate.
2. **Richieste impreviste:** sono interrotte e registrate. Un test che ne produca anche una sola fallisce.
3. **DNS:** Chromium è avviato con `--host-resolver-rules=MAP * ~NOTFOUND`. Anche una richiesta sfuggita all'intercettazione (WebSocket, preconnect) non può risolvere alcun host reale. Un test dedicato verifica il blocco verso un sito esterno, Firestore, il Worker e via WebSocket.

L'URL del Worker di produzione compare nei test solo come indirizzo simulato.
Lo stub Firebase:
- accetta solo il progetto `evora-athletes`;
- simula login e logout;
- nega le letture senza utente, come le Rules.

Il test del login admin completo copre la regressione del 2026-10-27, quando l'utente veniva disconnesso subito dopo il login.

Le pagine caricano React, ReactDOM e Babel a versione esatta, con hash `integrity`. Lo stub serve gli script con CORS come unpkg, quindi il browser dei test verifica davvero quegli hash: servono gli stessi file, cioè `react@18.3.1`, `react-dom@18.3.1` e `@babel/standalone@8.0.9`.

Esecuzione (Windows, PowerShell):

```powershell
$env:EVORA_BROWSER_ASSETS = '<cartella con node_modules di react@18.3.1 e react-dom@18.3.1>'
$env:EVORA_BABEL_ASSETS = '<cartella con node_modules di @babel/standalone@8.0.9>'   # facoltativa: altrimenti EVORA_BROWSER_ASSETS
$env:EVORA_CHROMIUM = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node --test --test-concurrency=1 test/frontend/browser.test.mjs
```

Serve il pacchetto `playwright` risolvibile da Node (per esempio con `NODE_PATH`).

Altre suite:

```sh
node --test $(ls test/frontend/*.test.mjs | grep -v browser)
node --test server/collective/test/*.test.mjs
node --test security/firestore/test/frontend-contract.test.mjs security/firestore/test/emulator-diagnostics.test.mjs
(cd worker && node --test --test-concurrency=1 "test/*.test.mjs")
```

Il workflow `.github/workflows/tests.yml` esegue tutte queste suite su ogni pull request, con il browser e il Firestore Emulator (profilo migration).

La documentazione precedente dello staging è storica e non è più una procedura operativa. Per prove end-to-end con servizi reali servirebbe un nuovo staging separato, autorizzato esplicitamente.
