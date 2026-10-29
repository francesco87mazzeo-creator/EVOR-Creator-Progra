# Livelli di classificazione e fasce colorate

Implementazione locale su `feature/configurable-score-levels`, base main
`33c0a83695870ad17811d8d012ffde242c80c3fd`. Nessun merge o deploy eseguito.

## Ambito e dati

La configurazione è indipendente da `settings/scoring`. Non modifica formule, pesi,
OCR, calcolo numerico, candidature o punteggi salvati. Non implementa il modello
Engagement/Reach/Growth discusso separatamente. Il calcolo corrente rimane Scoring V2,
configurazione versione 3.

Il nuovo documento `settings/scoreLevels`, versione 1, contiene due gruppi:

- `social`: classificazioni del Social Score complessivo;
- `metrics`: classificazioni comuni ai punteggi delle singole componenti normalizzate.

Le percentuali grezze (per esempio Indicatore B, che può superare 100%) non sono
classificate da queste fasce. I vecchi campi registrati nelle candidature non vengono
riscritti: le etichette nuove riguardano il punteggio corrente mostrato dall'Admin.

Ogni livello ha esattamente `id`, `label`, `color`, `min`, `max`. Il campo opzionale
`maxLevels: {social:20, metrics:20}` stabilisce il limite di ciascun gruppo; è modificabile
nell’editor e viene persistito nello stesso documento. Se manca, il lettore applica
20 come default senza scrivere dati. Ogni limite è un intero da 1 a 100; abbassarlo
sotto il numero corrente blocca il salvataggio, senza troncare o eliminare livelli.

20 era una scelta prudenziale, non un vincolo Firebase. Il tetto di 100 deriva dalla
scelta di estremi interi e intervalli non vuoti sulla scala 0–100: oltre 100 servirebbe
un modello di estremi frazionari diverso. Restano identificativi univoci nel gruppo, nomi non vuoti fino a 80
caratteri e colori esadecimali `#RRGGBB`. Gli estremi sono interi da 0 a 100.
Gli intervalli sono `[min,max)`, con 100 incluso nell'ultimo. Quindi `0–35` significa
0 incluso, 35 escluso: non c'è né sovrapposizione né buco con la fascia `35–55`.
La configurazione viene ordinata e convalidata da un'unica implementazione,
`public/score-levels.js`, usata nel browser e nel bundle Worker.

I preset sono:

| Gruppo | Intervallo | Nome | Colore |
|---|---|---|---|
| social | [0,35) | Performance bassa | #C0392B |
| social | [35,55) | Performance media | #E67E22 |
| social | [55,75) | Performance buona | #27AE60 |
| social | [75,100] | Performance alta | #3A7BD5 |
| metrics | [0,25) | Scarso | #C0392B |
| metrics | [25,50) | Medio | #E67E22 |
| metrics | [50,75) | Buono | #27AE60 |
| metrics | [75,100] | Eccellente | #3A7BD5 |

Se il documento non esiste viene usato il preset, senza scrivere nulla. Una lettura
fallita o una configurazione invalida NON vengono trattate come documento assente:
classificazioni e salvataggio dell'editor restano indisponibili, con errore e retry.
I punteggi numerici e le altre funzioni rimangono disponibili. Null, stringhe, valori
non finiti o fuori da 0–100 non ricevono una classe né un indicatore nel grafico.
Uno zero reale riceve invece la prima classe.

## Admin e persistenza

La scheda **Livelli e colori** è riservata all'admin. I due gruppi e i rispettivi limiti sono indipendenti. Il limite è editabile da 1 a 100.
Aggiungi divide la fascia più ampia; Elimina unisce l'intervallo alla vicina; non è
possibile eliminare l'ultimo livello. Gli input possono essere temporaneamente
invalidi durante la modifica, ma un errore blocca il salvataggio. Ripristina cambia
solo la bozza locale. L'anteprima usa la bozza valida, le candidature la configurazione
salvata. Le etichette sono testo React, mai HTML, e i colori non accettano CSS arbitrario.

`POST /admin/score-levels` riceve il documento completo con header
`Authorization: Bearer <Firebase ID token>`, ottenuto con `getIdToken()`.
Riusa i controlli di `/admin/scoring`: origine configurata, rate limiter admin,
token verificato (progetto, firma, scadenza/sessione), ruolo admin e provider custom.
Manager, viewer e utenti anonimi non possono scrivere. Il Worker convalida e scrive
esclusivamente `settings/scoreLevels` con service account; non legge/scrive candidature
o `settings/scoring` per questa operazione. 400/401/403/429/503, rete e timeout non
vengono mostrati come successi. Un 401 richiede nuovo login.

Tabelle, ring e grafici usano lo stesso stato caricato dal documento. Dopo un
salvataggio la scheda corrente viene aggiornata; altre schede richiedono reload.
Il salvataggio sostituisce tutto il documento e, come le impostazioni esistenti,
non implementa confronto revisioni: in caso di modifiche contemporanee prevale
l'ultima scrittura. Nessuno storico delle modifiche configurazione è inventato.
I ruoli/login esistenti non vengono estesi da questa modifica.

## Cache e ripristino frontend

I due script staff hanno hash del contenuto nelle URL. `tools/asset-versions.mjs`
aggiorna/verifica anche i riferimenti di avvio in `app/admin.jsx`. Un vecchio HTML
può ottenere moduli nuovi: il pannello carica i supporti mancanti prima di avviarsi,
senza redirect o fallback verso servizi diversi. Il generatore single-page include
gli stessi script e resta compatibile. La pagina pubblica separata non li carica.

## Firestore: aggiornamento necessario, non applicato

Solo il file candidato `security/firestore/migration/firestore.rules` è stato aggiornato:

```text
match /settings/scoreLevels {
  allow get: if reader();
  allow create, update, delete: if false;
}
```

`reader()` resta quello esistente: admin, manager, viewer. Le liste settings e gli
altri documenti riservati rimangono negati. Il Worker scrive tramite IAM, non tramite
le Rules client. Non pubblicare `security/firestore/firestore.rules` (profilo storico)
al posto del candidato migration. Prima confrontare e salvare le Rules effettivamente
attive: l'accesso a Firebase Console non è disponibile nell'ambiente Codex.

## Verifica prima della pubblicazione

Test senza servizi reali:

```sh
node --test server/collective/test/score-levels.test.mjs
node --test worker/test/admin-scoring.test.mjs test/frontend/score-levels-transport.test.mjs
node tools/asset-versions.mjs
```

La CI esistente include automaticamente i file `*.test.mjs`. I browser hanno tutte
le richieste intercettate e la risoluzione DNS bloccata; la persistenza browser usa
solo storage sintetico nel profilo di test. I test Worker simulano JWKS, OAuth e REST
Firestore, con chiavi generate localmente e nessun dato personale.

Il workflow `.github/workflows/tests.yml` esegue anche la verifica ufficiale richiesta:
nel job `firestore-rules` prima avvia il runner migration (con diagnostica del budget
di espressioni), poi un nuovo Emulator per `worker/test/emulator-scoring.mjs`.
Entrambi usano esclusivamente `demo-evora-security`, host 127.0.0.1:8089 e il JAR
ufficiale; il secondo avvio riusa la cache del primo. Node 24, Java 21 e dipendenze
bloccate dal lockfile. Nessun secret, login o credenziale di produzione; permessi
Actions limitati a `contents: read`, checkout senza persistenza delle credenziali.

Tests e Repository hygiene partono su PR e sul push di `feature/configurable-score-levels`
(oltre a main). Questo permette di eseguire i controlli anche prima della creazione
della PR. I workflow non eseguono deploy. Prima di approvare il merge controllare
che entrambi i passaggi Emulator siano verdi sul commit esatto della PR: il test
REST non viene eseguito se le Rules falliscono. I 767 test locali rimangono invariati.

Con Emulator ufficiale disponibile:

```sh
cd security/firestore
npm ci --ignore-scripts --no-audit --no-fund
```

Eseguire `npm test` con variabile `EVORA_RULES_PROFILE=migration` (su Windows PowerShell:
`$env:EVORA_RULES_PROFILE='migration'`). Il runner usa soltanto `demo-evora-security`
e intercetta anche il superamento del limite di espressioni.

Per verificare anche la persistenza REST del Worker con Emulator già attivo su
`127.0.0.1:8089`, dalla radice eseguire `node --test worker/test/emulator-scoring.mjs`
con `FIRESTORE_EMULATOR_HOST=127.0.0.1:8089`. Il test rifiuta ogni altra destinazione,
genera token sintetici, crea/sostituisce il documento display e verifica che scoring
e candidature rimangano invariati durante tale operazione. Contiene anche i test
storici di scoring: scrive soltanto dati sintetici nell'Emulator, mai in produzione.

Verifica ufficiale tentata il 29 ottobre 2026: Node v24.19.0, Java 21.0.12.1.
`npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/evora-levels-npm-cache`
ha installato le 688 dipendenze bloccate dal lockfile, senza modificare package/lockfile.
Un primo tentativo con cache npm predefinita era fallito per percorso non scrivibile;
la cache esplicita in /tmp ha risolto questo problema locale.

Il JAR ufficiale v1.22.0 non è presente nelle cache controllate. Il runner migration
è stato avviato davvero con CLI Firebase 15.34.1, progetto demo-evora-security e cache
`/tmp/evora-levels-emulator-official`. Si ferma al download, prima di eseguire i test:

`Failed to make request to https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v1.22.0.jar`

Una richiesta HEAD allo stesso URL riceve `CONNECT tunnel failed, response 403`,
`server: envoy`. Il dominio storage.googleapis.com non è consentito dalla policy di
rete dell'ambiente. Non è un errore di compilazione Rules né di autenticazione Firebase.
Non sono stati usati mirror, modifiche al proxy o aggiramenti delle restrizioni.

Restano NON VERIFICATI con l'Emulator ufficiale:
- compilazione e autorizzazioni del ruleset migration completo, inclusi i sei casi
  anonimo/utente senza ruolo/ruolo ignoto/viewer/manager/admin su settings/scoreLevels;
- diagnostica delle espressioni valutate sul ruleset realmente eseguito;
- creazione, sostituzione e rilettura REST di scoreLevels con il Worker, senza modificare
  settings/scoring o candidature, nel test worker/test/emulator-scoring.mjs.

Per completare serve consentire storage.googleapis.com nell'ambiente oppure eseguire
il runner su un computer/CI con accesso al download ufficiale. I test simulati e il
dry-run non sostituiscono questa verifica, da completare prima del rilascio.

Esito locale finale con limiti configurabili: 698 test non-browser superati (igiene
inclusa), 2 saltati perché specifici della modalità single-page; 69 test browser
superati, zero fallimenti. Sono verificati tutti i conteggi da 1 a 100, persistenza
di 21 livelli con limite configurato a 25, limiti indipendenti, riduzione senza
troncamento, rifiuto di valori oltre 100 e payload Unicode validi superiori a 64 KB
ma entro il nuovo tetto di 128 KB.
Tra questi: persistenza e reload, gruppi indipendenti, aggiunta/eliminazione,
overlap/gap, confini 0/100, dati mancanti, candidato storico, manager in sola lettura,
errori di lettura/salvataggio, etichette HTML trattate come testo e vecchio HTML in cache.
Il dry-run Wrangler 4.149.0 è superato. Le simulazioni non verificano IAM o la versione
delle Rules realmente pubblicata in produzione.

## File preparati

- Admin: `app/admin.jsx`, `admin/index.html`.
- Configurazione condivisa e trasporto: `public/score-levels.js`, `public/admin-scoring-client.js`.
- Worker: `worker/src/worker.js`.
- Rules candidate: `security/firestore/migration/firestore.rules`.
- Versioni asset e rollback: `tools/asset-versions.mjs`, `tools/frontend-mode.mjs`.
- Test: `server/collective/test/score-levels.test.mjs`,
  `test/frontend/score-levels-transport.test.mjs`, `test/frontend/browser.test.mjs`,
  `test/frontend/separation.test.mjs`, `security/firestore/migration/rules.test.mjs`,
  `security/firestore/test/frontend-contract.test.mjs`, `worker/test/admin-scoring.test.mjs`,
  `worker/test/common.test.mjs`, `worker/test/emulator-scoring.mjs`.
- Documentazione: questo file, `docs/score-levels.md`.
- CI: `.github/workflows/tests.yml`, `.github/workflows/repository-hygiene.yml`.

## Pubblicazione, solo dopo revisione/autorizzazione

1. Completare Emulator migration e integrazione REST, controlli CI e revisione del diff.
2. Salvare backup delle Rules attive e dell'eventuale documento scoreLevels.
3. Pubblicare prima le Rules compatibili, preservando tutte le altre protezioni.
4. Pubblicare il Worker con il nuovo endpoint, preservando configurazione e secret.
   Nessun nuovo secret, binding o permesso IAM è richiesto dal codice.
5. Solo dopo pubblicare il frontend: con Pages su main/root, il merge attiva la
   pubblicazione. Non eseguire merge prima che backend e Rules siano pronti.
6. Verificare lettura, preset e grafici. Un salvataggio reale richiede autorizzazione
   alla scrittura: Salva livelli crea il documento senza modificare i dati candidati.

Non serve creare manualmente il documento in Console. Non sono necessarie migrazioni
delle candidature o modifiche di settings/scoring. Rollback ordinario solo frontend,
conservando Worker aggiornato, Rules compatibili e documento livelli. Il vecchio
Worker/snapshot non ha il nuovo endpoint: non ripristinarlo automaticamente con
pagine nuove già aperte. Nessun rollback è stato eseguito da Codex.
