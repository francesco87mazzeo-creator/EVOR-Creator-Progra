# Worker `throbbing-feather-957f`

Sorgenti del Worker in produzione, finora conservati solo in locale. `wrangler.toml` è nella radice del repository.

- **Moduli:** `src/` contiene il Worker; importa la convalida da `../server/collective`.

## Modifiche non ancora pubblicate: scoring v2

Il branch `scoring/v2-engagement-views` modifica i sorgenti del Worker. **Dopo il merge il repository non corrisponde più alla versione in produzione descritta sotto**, finché il Worker non viene pubblicato con autorizzazione.

- **Sorgenti modificati:**
  - `worker/src/worker.js`: punteggio v2 e nuova notifica Telegram;
  - `server/collective/scoring.mjs`;
  - `server/collective/application.mjs`: account raggiunti facoltativi, schema 5.
- **Prompt OCR:** non modificati; le impronte in `OCR_PROMPTS` restano quelle attuali.
- **`/notify`:** il modello storico del messaggio resta accettato.
- **Bundle locale:** `wrangler deploy --dry-run` con Wrangler 4.149.0, nessuna pubblicazione.
  - `worker.js`: 58.866 byte;
  - SHA-256 `a463048f066e7fd7045c727741f9153532c65b4903f6a1d41055e5f67e0b4fc7`, calcolato al commit di questa modifica.
- **Ordine di pubblicazione:** prima le Rules, poi il Worker, poi il frontend. Dettagli in [docs/scoring-v2.md](../docs/scoring-v2.md).

## Provenienza (verificata il 2026-10-28)

**Riferimenti Cloudflare** (non sono secret):

| Riferimento | Valore |
|---|---|
| Worker | `throbbing-feather-957f` |
| Versione al 100% del traffico | `381ad99c-3756-4335-9391-84cd2ad5eb4c`, creata `2026-10-27T15:56:15.112Z`, origine `wrangler` |
| Deployment attivo | `c2fd848e-5b4d-4a78-8b38-8ec58935bf1e`, `2026-10-27T15:56:16.835Z` |
| `etag` dello script (identificativo interno Cloudflare, non è lo SHA-256 del bundle) | `31443ed235b25f64366ee2da314041d9ff31bda3a89ce13dce1b8657ce424ca6` |
| Compatibility date / handler | `2026-10-01` / `fetch` |
| Binding | `ALLOWED_ORIGIN`, `FIRESTORE_PROJECT_ID` (variabili) e sei secret, di cui Cloudflare espone solo i nomi |

**Bundle distribuito:**
- un solo modulo `worker.js`, 63.991 byte;
- SHA-256 `d1dc366c1fad57af36553c60af0e4d1c6615d4755a606b8d8e3ed64c96d8d3c5`.

**Sorgenti di questo repository** (SHA-256):

| File | SHA-256 |
|---|---|
| `worker/src/worker.js` | `69be6edaaee198e81f4fc8530e51d57b7631e0da3f3483f061dc7188080d1ef0` |
| `worker/src/firestore.mjs` | `a64c68c66522c844d523caf4635a237c80e5fadc5b926a8a2b436add7649715c` |
| `worker/src/google-auth.mjs` | `d8ff464a29a66439c5f5c37c07973a0329fba2d53ca0935d1d82e1e86f3b2486` |
| `worker/src/firebase-id-token.mjs` | `dcc035a4df9dd41a2fc86583c68f5f34ad2ac0882ffa46bda7085b176d66a06a` |
| `server/collective/application.mjs` | `1d5e6b85a1a94c14da55e84131f98c8e2af192b13d040a5fcfbc26b7e8a89c63` |
| `server/collective/ocr.mjs` | `27e045fbcdadb2eb4348a87b9ee45570213d6931ac1e9c5ef84bb3ccd7a1e645` |
| `server/collective/scoring.mjs` | `97948f41a3b4d07517b6dca6e867496d9c5b274b48c3da04cba5f2147f7ca689` |
| `server/collective/validation.mjs` | `e7b9397a3c5258330ecbc5bcc858f17ef53883a21bd530e4d72649a84e927a76` |

- **`worker.js`:** differisce dal sorgente pubblicato (SHA-256 `9a3852c9aae7e002d0122c3d15482852186262d442d0cf341455e71606425f4f`, commit `2150f63`) solo nel commento iniziale, che non compare nel bundle.
- **Altri file:** sono identici a quelli pubblicati.

**Strumenti usati per la verifica:**
- Wrangler `4.149.0`, che include esbuild `0.28.2`;
- Node.js `v24.22.1`, su Windows 10.

**Riproducibilità:** da questo repository il bundle ottenuto senza pubblicare ha lo stesso SHA-256 del bundle distribuito, sia prima sia dopo la modifica del commento.

**Come verificarlo di nuovo** (sola lettura, con un account Cloudflare autorizzato sul Worker):

1. Versione attiva e metadati:

   ```sh
   wrangler deployments status --name throbbing-feather-957f
   wrangler versions view 381ad99c-3756-4335-9391-84cd2ad5eb4c --name throbbing-feather-957f --json
   ```

2. Bundle distribuito: API Cloudflare `GET /accounts/<account-id>/workers/scripts/throbbing-feather-957f/content/v2?version=381ad99c-3756-4335-9391-84cd2ad5eb4c`, con un token di sola lettura sugli script Workers. Calcolare lo SHA-256 della parte `worker.js` della risposta multipart.
3. Bundle dai sorgenti, dalla radice del repository:

   ```sh
   wrangler deploy --dry-run --outdir <cartella esterna>
   ```

   Poi lo SHA-256 di `<cartella esterna>/worker.js`, con la stessa versione di Wrangler.

**Dove si trova:** il sorgente pubblicato il 2026-10-27 è entrato nel repository con il commit `2150f63`. Il frontend dello stesso rilascio è il merge della PR #1 (`1bdade6`).

## Test

Dalla cartella `worker/`, senza dipendenze né rete:

```sh
node --test --test-concurrency=1 "test/*.test.mjs"
```

- **Cosa simulano:** i test usano fetch simulato per Anthropic, Telegram e Google e leggono i frammenti reali del frontend.
- **Oracolo storico:** `test/legacy-notify-reference.mjs` conserva il formato del messaggio Telegram che il browser produceva prima che la notifica passasse al Worker.
- **Script Emulator:** `test/emulator-rest.mjs` e `test/emulator-scoring.mjs` vanno avviati a mano con il Firestore Emulator su `127.0.0.1:8089`.

## Pubblicazione

Si pubblica solo con autorizzazione esplicita.

1. Dalla radice, verifica senza pubblicare:

   ```sh
   wrangler deploy --dry-run --outdir <cartella esterna>
   ```

2. Pubblicazione: `wrangler deploy`.
3. Ripristino: `wrangler rollback <versione> --name throbbing-feather-957f`.

I secret restano su Cloudflare e non si scrivono mai in questo repository.
