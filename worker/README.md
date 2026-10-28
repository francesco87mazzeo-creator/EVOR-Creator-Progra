# Worker `throbbing-feather-957f`

Sorgenti del Worker in produzione, finora conservati solo in locale. `wrangler.toml` è nella radice del repository.

- **Versione attiva:** `381ad99c-3756-4335-9391-84cd2ad5eb4c`, pubblicata il 2026-10-27.
- **Verifica del 2026-10-28:** `wrangler deploy --dry-run` da questo repository produce un bundle identico byte per byte a quello distribuito (sha256 `d1dc366c…`).
- **Moduli:** `src/` contiene il Worker; importa la convalida da `../server/collective`.

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
