# Frontend locale: Worker e Firebase staging insieme

## Configurazione

`public/worker-config.js` seleziona una sola configurazione immutabile PRIMA di
inizializzare Firebase:

- `localhost`, `127.0.0.1`, `[::1]`: Worker
  `https://evora-collective-staging.francesco87-mazzeo.workers.dev` e configurazione
  Web ufficiale Firebase `evora-collective-staging` fornita dal founder.
- Sito pubblico: Worker e sei valori Firebase originali invariati.

Non servono flag, parametri URL o modifiche manuali: su localhost lo staging è
obbligatorio. Il vecchio EVORA_TEST_WORKER_BASE viene rifiutato, anche se impostato
sul sito pubblico. Non esiste un override indipendente Firebase/Worker.
File aperti con file://, configurazione mancante o invalida bloccano l'avvio;
nessun fallback verso produzione. Controlli su progetto, authDomain, bucket,
formato della API key Web, sender/appId e origine Worker. La validità operativa
sui servizi reali richiede ancora il test live. Le API key Firebase Web sono
configurazioni pubbliche, non credenziali di service account.

## Prova manuale Windows (dopo conferma backend/CORS)

Dalla radice del repository, se Python è installato:

```powershell
py -m http.server 8043 --bind 127.0.0.1
```

Aprire `http://localhost:8043` in un profilo browser di prova separato e senza
estensioni. Non usare il dominio pubblico, un IP LAN, un hostname personalizzato
né file://. Rimuovere eventuali precedenti script di override Worker.
Nella console verificare `CollectiveEnvironment.current`: name staging,
projectId evora-collective-staging e workerBase staging. Non incollare token.

Il percorso pubblico usa OCR sulla radice `/` e POST `/applications`.
L'area #admin usa `/auth` e Firebase Authentication staging; legge/aggiorna/elimina
candidature e legge scoring tramite Firestore staging. Il salvataggio scoring
usa `/admin/scoring`. Il test Telegram usa `/notify` sul Worker staging.
La sessione usa ancora Persistence.LOCAL e timer 8 ore, come prima; non è stata
modificata la logica di login e non è stato introdotto Google Login.

Prima di inviare dati sintetici, Claude deve confermare:

- CORS per l'origine ESATTA `http://localhost:8043` su preflight e risposte reali,
  incluso Authorization, Idempotency-Key, Content-Type e se attivo X-Turnstile-Token.
- `/auth` emette token per il progetto staging e i ruoli admin/manager esistenti.
  Il viewer non è ancora supportato dall'ingresso nel pannello.
- Rules candidate presenti nello staging e impostazioni scoring inizializzate.
- Telegram disabilitato o sink di test anche dentro `/applications`;
  OCR e rate limit pronti per dati sintetici; stato di Turnstile confermato.

Il client dispone del solo hook Turnstile: nessun widget integrato in questa
modifica. I precedenti 7 test backend e il CORS live non sono stati rieseguiti qui.

## Test automatici senza servizi reali

```sh
node --test test/frontend/worker-config.test.mjs test/frontend/client.test.mjs test/frontend/age.test.mjs test/frontend/admin-scoring.test.mjs test/frontend/management-limits.test.mjs security/firestore/test/frontend-contract.test.mjs security/firestore/test/emulator-diagnostics.test.mjs
EVORA_BROWSER_ASSETS=/percorso/asset-di-test node --test --test-concurrency=1 test/frontend/browser.test.mjs
npm --prefix server/collective test
```

Gli asset contengono React 18, react-dom 18 e @babel/standalone. Servono Playwright
e Chromium; EVORA_CHROMIUM può indicare l'eseguibile. Su PowerShell impostare le
variabili tramite `$env:EVORA_BROWSER_ASSETS` prima del comando Node.

La suite browser usa la configurazione staging reale ma INTERCETTA OGNI richiesta
nel BrowserContext; Service Worker bloccati. Firebase è uno stub che rifiuta
inizializzazioni di progetti diversi dallo staging. Ogni POST deve avere origine
Worker staging; le richieste impreviste ricevono 403 locale senza inoltro.
Nessuna candidatura, scoring o notifica reale viene inviata, nemmeno allo staging.

Test di fault injection verificano configurazioni incomplete, miste, Worker
produttivo e modulo assente: zero inizializzazioni SDK e nessuna richiesta.
Il browser verifica anche che una configurazione invalida impedisca avvio e POST.
Le prove della configurazione pubblica eseguono solo codice puro in VM senza SDK
o rete. Non sono test live, di IAM o dell'effettiva configurazione CORS.
