# Configurazione Scoring — benchmark Instagram

Branch: `feature/instagram-benchmark-editor`, base `main` ee7c841 (PR #8 integrata).
Questa configurazione non viene utilizzata dal calcolo dei punteggi. Nessuna conversione
benchmark → score è implementata. `settings/scoring`, formule, pesi, OCR e candidature restano invariati.

## Pagina

Admin → Configurazione Scoring: Engagement / Reach / Growth, grafico e tabella della stessa
bozza, controlli collegati o singoli. Le impostazioni numeriche precedenti e i livelli/colori
sono preservati nella stessa pagina, in sezioni espandibili. Il precedente pulsante
«Livelli e colori» è un collegamento alla pagina unificata.
Nessun esempio creator o punteggio individuale è presente nella pagina benchmark.
La navigazione generale rimane quella dell'Admin esistente: non viene aggiunta una sidebar fittizia.

I valori Engagement sono sperimentali, non benchmark scientificamente validati.
Reach e Growth recuperano i riferimenti storici provvisori della specifica.

## Configurazione e interpolazione

Documento separato `settings/instagramBenchmarks`:

```js
{
  version: 1,
  interpolation: 'log-smoothstep-v1',
  storageFormat: 'named-thresholds-v1',
  followers: [1000, 5000, 20000, 100000, 500000],
  engagement: [
    {medium:10,good:20,excellent:40}, {medium:8,good:16,excellent:32},
    {medium:6,good:12,excellent:24}, {medium:5,good:10,excellent:20},
    {medium:4,good:8,excellent:16}
  ],
  reach: [
    {medium:60,good:120,excellent:250}, {medium:40,good:80,excellent:160},
    {medium:30,good:60,excellent:120}, {medium:20,good:40,excellent:80},
    {medium:15,good:30,excellent:60}
  ],
  growth: [
    {medium:1,good:3,excellent:7}, {medium:0.5,good:1.5,excellent:4},
    {medium:0.3,good:1,excellent:3}, {medium:0.15,good:0.5,excellent:1.5},
    {medium:0.08,good:0.25,excellent:0.8}
  ]
}
```

Il browser e il contratto JSON HTTP usano matrici di tre numeri per riga; il
Worker applica `toDocument` prima di salvare e l'Admin applica `fromDocument`
in lettura. Le conversioni condivise sono rigorose e senza perdita di valori.
Il documento usa array di mappe perché Firestore non supporta array annidati:
il precedente formato locale è stato corretto prima di qualsiasi pubblicazione
in produzione. Nessuna migrazione o scrittura di dati reali è stata eseguita.

Le righe corrispondono alle cinque fasce storiche; i nodi usano gli estremi superiori
1K / 5K / 20K / 100K e il riferimento 500K dell'immagine per la fascia aperta.
Questa scelta rende esplicito il riferimento della quinta fascia, non presente come
estremo finito nella vecchia tabella. Non cambia le fasce del calcolo attualmente attivo.

Tra due nodi a,b, t=ln(f/a)/ln(b/a), w=t²(3−2t), soglia=(1−w)*soglia(a)+w*soglia(b).
La stessa funzione pura genera i punti del grafico e le soglie a qualsiasi f≥0.
È C1, raggiunge esattamente i nodi e non supera gli estremi di ciascun intervallo.
I pesi convessi sono identici per le tre soglie: con ordine stretto ai nodi non si
creano incroci intermedi. Se si impostano nodi non monotoni, la curva segue quei
valori senza aggiungere oscillazioni. Non è una spline decorativa separata.
Sotto 1K e sopra 500K i valori rimangono costanti. Follower mancanti/invalidi restituiscono null.

Valori finiti tra 0 e 100.000%, con Medio < Buono < Eccellente per ogni nodo.
Il limite massimo è una protezione operativa esplicita; i tassi non sono limitati a100%.
La modifica collegata somma lo stesso delta ai tre valori di una sola fascia.
Gli incrementi indicano punti percentuali (pp), non variazioni percentuali relative.
Nessun riordino/clamp silenzioso. Un tentativo fuori ordine viene rifiutato.

## Persistenza e sicurezza

- Lettura esatta del documento con Firebase dello staff; nessuna lista settings.
- Documento assente: valori predefiniti, senza scritture automatiche.
- Lettura fallita o documento non valido: errore e riprova, nessun fallback scrivibile.
- POST `/admin/benchmarks`, stesso ID token Firebase, ruolo admin e provider custom,
  scadenza sessione e limiter amministrativo dei percorsi esistenti.
- Worker valida lo schema condiviso e sostituisce soltanto il documento fisso.
- Rules candidate: get per admin/manager/viewer, nessuna scrittura client.
- Ripristino modifica soltanto la bozza. Salva esplicito crea/sostituisce il documento.
- Manager/viewer non possono salvare. Nessun nuovo secret o binding richiesto.
- Come gli altri editor attuali, ultimo salvataggio prevale; altri tab devono ricaricare.
  Il cambio pagina scarta la bozza non salvata. Nessuna migrazione candidature.

## Verifica locale

Dalla radice:

```sh
node --test server/collective/test/benchmarks.test.mjs worker/test/admin-scoring.test.mjs
node tools/asset-versions.mjs
EVORA_BROWSER_ASSETS=/percorso/assets EVORA_CHROMIUM=/percorso/chromium node --test --test-concurrency=1 test/frontend/browser.test.mjs
cd security/firestore
npm ci --ignore-scripts --no-audit --no-fund
EVORA_RULES_PROFILE=migration npm test
```

Il browser usa esclusivamente Firebase/Worker simulati e DNS bloccato: nessun invio reale.
Sono aggiunti test ufficiali Rules per get e divieto create/update/delete sui sei ruoli,
e un test REST Worker → Emulator di creazione, rilettura, sostituzione e isolamento
di scoring/candidature. Il workflow esistente esegue anche questo file in CI.
L'Emulator non è disponibile nella cache di questo ambiente e il dominio del download
è bloccato: verifica locale Rules NON completata. Eseguire il job CI firestore-rules
(o i comandi sopra su un ambiente abilitato) prima di pubblicare.

## Pubblicazione futura, solo dopo approvazione

1. Revisione, CI completa inclusi test Emulator; verificare nodo finale500K e default sperimentali.
2. Backup/versione attiva Rules e Worker. Pubblicare esclusivamente le Rules candidate approvate.
3. Pubblicare Worker con nuovo endpoint mantenendo variabili/secret; nessun cambio scoring.
4. Pubblicare frontend solo dopo endpoint e permessi lettura disponibili. I vecchi frontend
   continuano a funzionare con il nuovo Worker; il nuovo frontend con vecchio Worker non salva benchmark.
5. Controlli routing/CORS senza scritture; eventuale primo Salva benchmark richiede autorizzazione.
6. Rollback ordinario frontend, conservando Worker/Rules compatibili con pagine già aperte.
   Il documento è separato e può rimanere: nessun ricalcolo o ripristino candidature necessario.

Commit e push del solo branch di sviluppo autorizzati per revisione. Nessun merge,
deploy o accesso a dati Firebase reali eseguito per questa implementazione.

## File interessati

- `app/admin.jsx`, `admin/index.html`: pagina unificata e versioni asset.
- `public/score-levels.js`: API benchmark pura condivisa, API livelli preservata.
- `public/admin-scoring-client.js`: trasporto autenticato aggiuntivo.
- `worker/src/worker.js`: endpoint a destinazione fissa.
- `security/firestore/migration/firestore.rules`: solo permessi del nuovo documento.
- `security/firestore/migration/rules.test.mjs`: matrice permessi benchmark.
- `server/collective/test/benchmarks.test.mjs`: curve, editing e schema.
- `test/frontend/browser.test.mjs`, `test/frontend/score-levels-transport.test.mjs`: browser/trasporto.
- `worker/test/admin-scoring.test.mjs`, `worker/test/common.test.mjs`: persistenza simulata, autorizzazioni e CORS.
- `worker/test/emulator-scoring.mjs`: persistenza REST su Emulator demo.
- `.github/workflows/tests.yml`, `.github/workflows/repository-hygiene.yml`: esecuzione anche sul push del branch di sviluppo.
- `docs/instagram-benchmarks.md`: contratto, limiti e istruzioni.

## Verifiche pre-PR

- 736 test non browser e igiene repository superati, 2 esclusi relativi alla modalità alternativa.
- La suite Playwright comprende 77 test. Include il confronto numerico di tutti i
  campioni SVG con la funzione condivisa di interpolazione, prima e dopo una modifica
  collegata, e l'assenza di anteprime creator/candidature nella pagina benchmark.
  Il nuovo test è stato eseguito con successo anche isolatamente.
- Test di modifica collegata per tutte le cinque fasce, tutte le tre soglie e tutte
  le metriche: entrambe le distanze conservate, nessuna modifica ad altre fasce o metriche.
- Versioni SHA asset, diff whitespace, preservazione del core numerico e dry-run
  Wrangler 4.149.0 superati. Bundle 69,54 KiB (gzip19,89 KiB).
- Rules/REST ufficiali Emulator NON eseguiti localmente: cache mancante, modalità offline
  esplicita con uscita2, nessun nuovo download tentato.
- I workflow partono sia sulla PR sia sul push `feature/instagram-benchmark-editor`.
  Il job firestore-rules installa Java21, Firebase CLI fissata e l'Emulator ufficiale,
  esegue le Rules migration e poi il file REST completo con il caso
  settings/instagramBenchmarks. Progetto demo, nessun secret di produzione,
  permessi GitHub contents:read, nessun comando deploy. Verificare i risultati sul commit pubblicato.

### Prima esecuzione CI

Il primo commit9aa1263 ha esposto un errore nel job Rules: lo schema locale
usava array annidati. Il rifiuto è stato riprodotto senza rete con l'SDK Firebase
ufficiale (`invalid-argument: Nested arrays are not supported`). Il formato
persistente è stato corretto in array di mappe, senza cambiare l'API HTTP, i
valori o l'interpolazione. I test ora controllano anche il documento Firestore
serializzato e la conversione rigorosa in lettura. Consultare l'ultima esecuzione
CI, non quella del primo commit, per il risultato finale Emulator.
