# Ripristino compatibile della PR #6

**Stato: preparato e verificato localmente, NON distribuito.** Non esiste ancora un version ID Cloudflare per questo artefatto. Nessun deploy è autorizzato da questo documento.

## Strategia

1. **Ordinaria:** ripristinare il solo frontend, mantenendo Worker V2 e Rules V2 compatibili. Le pagine nuove già aperte possono inviare `accountsReached: null`.
2. **Completa (se occorre sostituire anche il runtime Worker):** usare questo artefatto autonomo; mantenere le Rules V2. Non ripristinare il Worker legacy che richiede la reach. Il ripristino conserva il contratto e lo scoring V2, non riattiva il vecchio modello.

Il candidato non deve aggiungere account raggiunti indisponibili, inventare un numero, ricaricare la pagina o ripetere la candidatura con una nuova chiave. Restano in vigore convalida, autenticazione, CORS, limiti e idempotenza del runtime congelato. La notifica rimane lato server, successiva al salvataggio.

## Artefatto autonomo

`compat/` contiene gli otto moduli runtime esattamente come nel commit `c29d05b5d75f176906288c5bc16be0b7fe9f7bbc`. Tutti gli import relativi restano all'interno della copia; nessuna dipendenza dai moduli applicativi correnti. `manifest.json` indica origine e SHA-256 di ogni file.

La duplicazione è intenzionale e limitata al runtime di ripristino. Non modificare direttamente la copia: un aggiornamento della base richiede una revisione esplicita, aggiornamento del riferimento nel preparatore/nei test e rigenerazione. È una base verificata, non una garanzia contro qualsiasi guasto/configurazione di Cloudflare o Firebase.

Dalla radice del repository, senza rete né dipendenze aggiuntive:

```sh
node worker/rollback/prepare-compat.mjs --check
node --test worker/test/rollback.test.mjs
```

Per rigenerare esattamente l'artefatto dal commit di riferimento (richiede che l'oggetto Git sia disponibile localmente):

```sh
node worker/rollback/prepare-compat.mjs --write
```

Il normale workflow `unit` include i test Worker; il workflow browser include il caso di pagina aperta e invio con reach nulla. `rollback-services.mjs` genera una chiave RSA fittizia in memoria e simula le risposte OAuth/Firestore. Non carica credenziali personali e non utilizza rete reale.

## Preparazione di una futura pubblicazione, solo dopo autorizzazione

`wrangler.compat.toml` è un entrypoint separato per il medesimo Worker. Non cambia l'entrypoint ordinario `wrangler.toml`. Prima di qualsiasi pubblicazione verificare il target e preservare i secret, i binding dei limiter, le variabili Turnstile, route e le altre impostazioni effettive dell'istanza. Il repository non prova quali configurazioni siano attive online; `--keep-vars` riguarda le variabili, non garantisce da solo la conservazione di tutti i binding.

Preparazione offline del bundle con la versione Wrangler usata per il rilascio:

```sh
wrangler deploy --dry-run --config worker/rollback/wrangler.compat.toml --outdir <cartella-esterna>
```

**Non eseguire senza una nuova autorizzazione** il comando di pubblicazione:

```sh
wrangler deploy --config worker/rollback/wrangler.compat.toml --keep-vars
```

Dopo la pubblicazione autorizzata: annotare il version ID, verificare contratto e impostazioni sullo staging separato/ambiente autorizzato, quindi controllare invii e replay. Non usare i secret reali nei test e non creare candidature reali per questa preparazione. Non tornare alle Rules storiche permissive e non ripristinare automaticamente `settings/scoring` o i documenti.

Le impostazioni V3 restano disponibili alla nuova Admin. La vecchia Admin resta leggibile ma usa il vecchio modello e non può salvare configurazioni V2 sul Worker compatibile. Durante il ripristino non modificare lo scoring dal vecchio pannello.
