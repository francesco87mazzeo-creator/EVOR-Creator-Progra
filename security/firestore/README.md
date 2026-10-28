# COLLECTIVE — preparazione sicurezza Firestore

## Stato attuale e istruzioni correnti (28 ottobre 2026)

- **Rules in produzione:** `migration/firestore.rules` (profilo **migration**), pubblicate
  il 27 ottobre 2026 come ruleset `7e21404d` (sha256 `f0151978…`, identico a questo file).
- **Verifica:** suite Emulator del profilo migration 40/40 su Windows (Node 24, Java 21),
  28 ottobre 2026. Contratto frontend: 8 test.
- **Profilo originale** (`firestore.rules`, correzione A1): storico, non passa e non va
  usato per certificare le Rules.
- **Checkout su Windows:** funziona solo dai commit che includono la rimozione del file
  legacy con spazio finale `html ` (branch `security/remove-legacy-html` e `main` dopo
  il suo merge). Tutti i commit precedenti, compresi `479213a`, `main` fino a `2031a4e`
  e i branch `development/*`, `security/firestore-rules-emulator` e
  `maintenance/remove-retired-staging`, contengono ancora quel file: su Windows il
  checkout non si completa. Per quelle versioni serve la copia separata descritta in
  [WINDOWS.md](WINDOWS.md).

Dalla radice di un clone compatibile:

```sh
cd security/firestore
npm ci --ignore-scripts
npm run test:contract
EVORA_RULES_PROFILE=migration npm test
```

In PowerShell: `$env:EVORA_RULES_PROFILE = 'migration'; npm.cmd test` (vedi [WINDOWS.md](WINDOWS.md)).

## Note storiche (26 ottobre 2026)

Le sezioni seguenti documentano la preparazione e sono conservate per tracciabilità:
i principi restano validi, ma commit, branch, conteggi ed esiti **non descrivono lo
stato attuale** (vedi sopra).

Stato all'epoca: **correzione A1 candidata; non validata nell'Emulator**.
La versione base delle regole è pubblicata nel commit
`fc7690ce1d5adee3c1d77566f111dfbef26ec21a`. Le modifiche A1 sono
soltanto locali, senza commit o push: [dettagli A1](A1.md).
Branch: `security/firestore-rules-emulator`, base `479213ab45cdee057f7c2d8c8e733eb64cc3c8b7`.
Nessuna modifica a `index.html`, al file legacy `html `, a Firebase o Cloudflare.

Per Windows: [guida PowerShell passo per passo](WINDOWS.md), con verifica Node.js/Java.

### Esecuzione riproducibile (profilo originale A1, storico)

Prerequisiti: Node.js 24 (usato 24.19.0), Java 21, npm. Dalla root del repository:

```sh
cd security/firestore
npm ci --ignore-scripts --cache /tmp/evora-npm-cache
npm run test:contract
npm test
```

`npm test` avvia **solo Firestore Emulator** su `127.0.0.1:8089`, con progetto
`demo-evora-security`, ed esegue la suite Node con concorrenza 1. Nessun login richiesto.
Il runner intercetta errori di budget dagli stream e dai log della singola esecuzione,
anche quando un test negativo risulta passato; richiede log Firestore aggiornati
per accettare un esito globale positivo. Rimuove i selettori standard di credenziali
dal processo figlio e usa un
progetto demo esplicito. I test rifiutano un endpoint diverso da quello locale.
Non esistono script di deploy. Non usare dati di produzione come fixture.
Il binario ufficiale viene scaricato dal CLI con verifica dimensione/checksum;
TLS rimane attivo. La cache locale dell'Emulator e i log sono ignorati da Git.

Rete di installazione: `registry.npmjs.org` e, per il binario ufficiale,
`storage.googleapis.com`. Nell'esecuzione corrente quest'ultimo host ha risposto
HTTP 403 al CONNECT del proxy: `npm test` è terminato prima dell'avvio dei test.
Una nuova esecuzione è necessaria dopo l'abilitazione del dominio nelle impostazioni
dell'ambiente. Non confondere i test di contratto con una compilazione delle Rules.
Per il controllo completo usare `npm test`, non direttamente `npm run test:rules`: il
runner imposta il guard diagnostico obbligatorio. In questo ambiente non tentare
nuovi download: `EVORA_EMULATOR_OFFLINE=1 npm test` verifica solo la disponibilità
della cache e termina con codice 2 se manca il binario.

### Tentativo del 26 ottobre 2026 e istruzioni dell'epoca (storico)

Verifica del 26 ottobre 2026, ore 20:45 (Europe/Rome):

- HEAD HTTPS al binario ufficiale: CONNECT rifiutato dal proxy con HTTP 403;
  `curl` è terminato con codice 56.
- `npm test`: codice di uscita 2, download dell'Emulator v1.22.0 fallito;
  nessun test di autorizzazione è iniziato e nessun risultato Rules è disponibile.
- Nessun cambio proxy, disattivazione TLS, mirror alternativo o aggiramento della policy.

Per eseguire su una macchina locale con rete consentita:

1. Usare Node.js 24 e Java 21; verificare `node --version` e `java -version`.
2. Copiare la cartella preparata `security/firestore` accanto a `index.html` nello
   stesso percorso relativo del repository (la fixture legge quel file). Usare il
   sorgente del commit base indicato in testa. Il branch e i file non sono stati
   pubblicati: un semplice clone da GitHub non include queste aggiunte locali.
   Non trasferire `node_modules`, cache, log, credenziali o dati di produzione.
3. Preferire Linux, macOS o WSL su filesystem Linux: il commit base conteneva il file
   legacy con spazio finale `html `, che impedisce il checkout su Windows. Il file è stato
   rimosso in seguito: per i commit compatibili vedi lo stato attuale in testa.
4. Lasciare libera la porta locale 8089. Consentire i download ufficiali da
   `registry.npmjs.org` e `storage.googleapis.com`, mantenendo TLS verificato.
5. Dalla radice della copia locale eseguire:

```sh
cd security/firestore
npm ci --ignore-scripts
npm run test:contract
npm test
```

Non servono `firebase login`, un progetto Firebase reale, service account o secret.
Il runner seleziona esplicitamente `demo-evora-security` e avvia solo Firestore
Emulator. Questi sono test del progetto eseguiti sullo strumento ufficiale Firebase,
non una suite di certificazione fornita da Google.

Conservare l'output e il codice di uscita di `npm test`: il riepilogo deve indicare
il numero effettivo di test passati/falliti e il comando deve terminare con 0.
Se fallisce il download o la compilazione, non registrare i test di autorizzazione
come passati o saltati. Inviare per revisione il primo errore con il riepilogo finale,
senza includere credenziali. Non eseguire alcun comando `deploy`.

### Esiti al 26 ottobre 2026 (storico)

- **20 test locali passati**: 7 contratto/schema e 13 diagnostica, nessun fallimento.
- **Versione base eseguita da Claude Code su Windows, secondo il rapporto ricevuto:**
  191 test, 179 passati e 12 falliti per budget espressioni; alcuni dinieghi non conclusivi.
- **Versione A1 non eseguita nell'Emulator**: binario assente nella cache; prova in
  modalità offline terminata con codice 2 senza tentare download.
- Compilazione Rules, budget di espressioni (in particolare OCR completo), autorizzazioni
  e compatibilità SDK/Emulator **non confermati** finché `npm test` non passa.
- Nessun test sul Worker, su custom token reali o sulle regole online.
- Audit npm finale: 0 critical, 0 high, 5 moderate (solo strumenti di sviluppo).
  Override esplicito di `@grpc/grpc-js` a 1.14.6, nella stessa major, per eliminare
  gli advisory high della versione transitiva del Firebase SDK. La compatibilità
  operativa di questo override resta da confermare con la suite Emulator.

## Permessi proposti

| Operazione | Pubblico / senza ruolo | Viewer (Social Media Manager) | Manager | Admin |
|---|---|---|---|---|
| Creazione candidatura valida tramite percorso pubblico | sì | sì | sì | sì |
| Lettura documento / elenco candidature | no | sì | sì | sì |
| Stati, note, codice, valutazione, correzione Insights | no | no | sì | sì |
| Modifica identità, risposte originali, consensi, immagini, OCR | no | no | no | no |
| Eliminazione candidatura | no | no | no | sì |
| Get puntuale di `settings/scoring` | sì | sì | sì | sì |
| Creazione/aggiornamento scoring valido | no | no | no | sì |
| Eliminazione scoring, elenco settings, `settings/config`, altri percorsi | no | no | no | no |

`role: viewer` è il nuovo ruolo della Social Media Manager. `manager` rimane un
ruolo gestionale distinto: non assegnarlo alla Social Media Manager. Viewer non può
aggiornare, sovrascrivere o eliminare candidature, neppure tramite SDK, merge o batch.
La creazione resta pubblica per tutti: il ruolo viewer non impedisce a una persona
di inviare una propria candidatura sul percorso pubblico, ma non può usarlo per
sovrascrivere documenti esistenti.

La candidatura pubblica non ottiene lettura o update neppure conoscendone l'ID.
Una `set()` su un ID già esistente è update e viene negata al pubblico.
L'export è una lettura dei dati già caricati: non è un permesso Firestore separabile.
Non si possono nascondere singoli campi di un documento a un manager autorizzato a leggerlo.
Admin e manager non possono riscrivere le risposte originali: il frontend non offre questa funzione.

## Compatibilità verificata staticamente

Le fixture eseguono, in un contesto isolato con servizi sostituiti da stub, i frammenti
reali `EMPTY_FORM`, scoring, `parseSocial`, `TEST_FORM` e `submit` di `index.html`.
Non eseguono configurazione Firebase, JSX o chiamate Worker. Un cambiamento del payload
fa fallire il contratto delle 71 chiavi, evitando una fixture indipendente dal frontend.
Tutti i dati sono quelli di esempio del repository o valori sintetici su domini `.test`.

Operazioni inventariate in `index.html`:

- 375–403: unico wrapper `FB` (8 operazioni).
- 2187–2244: scoring pubblico e creazione candidatura.
- 3062–3068: query staff `orderBy("date", "desc")` senza limit server.
- 3132–3143: update e delete.
- 3430–3471: correzione Insights, `correctedBy: "staff"`, valori precedenti/nuovi.
- 3530–3537: stato, note, codice creator, valutazione.
- 3823–3832: salvataggio scoring v2, ultima fascia `max: null`.
- 4062–4065: caricamento scoring staff.
- `getSettings`/`saveSettings` non hanno chiamanti attivi: `settings/config` negato.

Gli aggiornamenti convalidano i campi modificati, preservando la possibilità di gestire
candidature legacy senza forzarne migrazione. Le creazioni usano schema v4 esatto.
Le soglie di scoring rispettano 4 livelli ordinati, 5 fasce e benchmark crescenti.
I pesi possono non sommare 100, come oggi; non possono essere tutti zero.
Le date restano stringhe ISO come nel frontend. Il formato non ne prova veridicità o
vicinanza a `request.time`; non è stato introdotto un obbligo incompatibile di timestamp server.
Una scrittura identica è ammessa anche se `updatedAt` non cambia nello stesso millisecondo.

Il dettaglio di tutte le 71 chiavi e delle strutture annidate è in [SCHEMA.md](SCHEMA.md).

## Controlli e limiti scelti

- Creazione: tutte e sole le 71 chiavi del frontend, tipi, limiti testuali, enum,
  categorie senza duplicati, consensi veri, età 18–99, metriche intere e finite.
- Immagini: JPEG base64 come prodotto da `compressImage`, massimo 700.000 caratteri
  ciascuna e 900.000 complessivi, primo screenshot obbligatorio. Non è una verifica
  del contenuto JPEG e non sostituisce il limite totale Firestore di 1 MiB.
- OCR: mappe con chiavi esatte, tipi/visibilità/troncamento, quattro metriche,
  massimo quattro conflitti verificati singolarmente. `null` rimane ammesso per i
  percorsi senza OCR. Non si richiede che l'OCR approvi il candidato.
- Metriche conteggio: ±10^12 (negative solo follower netti); rapporti entro ±10^14.
  Sono limiti tecnici proposti, non benchmark commerciali o prova di autenticità.
- Note: massimo 10.000 caratteri; codice creator 120; nota correzione 2.000.
- Valutazione: solo sei criteri numerici interi 0–5 e `updatedAt`.
- Correzioni: schema completo e corrispondenza nuovi valori/metriche. I valori
  precedenti non sono un audit indipendente: lo staff controlla quel payload.

## Adeguamenti frontend necessari prima dell'attivazione

Nessuno è implementato in questo branch.

**Nuovo ruolo viewer:** `AUTH.login` e `AUTH.currentRole` accettano attualmente solo
`admin` e `manager` (index.html:433–459). Occorre ammettere `viewer` nei controlli
frontend, mostrare una scheda in sola lettura e nascondere/disabilitare stato, note,
valutazioni, codice creator, correzioni Insights ed eliminazione. Non basta che
`isAdmin` sia falso: le azioni manager sono oggi mostrate a tutti gli utenti del
pannello. Il backend autorizzato dovrà assegnare il claim viewer all'identità corretta;
non è stata modificata l'emissione dei token o il Worker. Per utenti esistenti con
claim manager occorre una procedura verificata di riassegnazione/revoca/rinnovo:
le nuove regole non trasformano automaticamente quel claim in viewer.
Il ruolo è preparato nelle regole e nei test; l'accesso viewer dalla UI attuale non
è ancora compatibile. Tutto il documento (comprese note, immagini e valutazioni)
è leggibile: una diversa visibilità richiederebbe separare i dati.


1. `validate(0)` accetta oggi 14–99 anni pur richiedendo maggiore età: allineare a
   18 anni oppure decidere esplicitamente un diverso percorso per minori.
2. Rifare la validazione completa alla conferma finale; oggi `submit` controlla solo
   l'ultimo step. Allineare limiti e tipi ai vincoli documentati.
3. Normalizzare trim e lunghezze per nome, email, località, username/link e nomi file;
   la UI oggi può accettare valori che una regola più rigorosa nega.
4. Validare pesi e soglie prima di salvare. Correggere anche le formule mostrate
   nel pannello: il calcolo usa account raggiunti/follower netti.
5. Validare gli Insights corretti prima della conversione: il codice attuale può
   trasformare input vuoti in zero e consentire conteggi negativi.
6. Feedback su `permission-denied` per tutti i salvataggi staff; non basta il
   `try/finally` attuale. Allineare limiti note/codice/nota correzione.
7. Isolare il form di prova: `testMode` oggi scrive e notifica sugli endpoint reali.
8. Consigliato: ID casuali, gestione delle collisioni/retry, timestamp server e UID
   dell'operatore (cambiano il contratto e richiedono regole coordinate).

## Piano dei test preparati

`test/rules.test.mjs` comprende:

- anonimo, autenticato senza ruolo, ruolo sconosciuto, viewer, manager, admin;
- payload prodotto dall'invio reale, precheck con OCR completo/parziale, quattro conflitti;
- get/query staff, export boundary, tutte le operazioni gestionali;
- delete admin, dinieghi pubblico/manager, immutabilità risposte e OCR;
- accesso pubblico puntuale scoring, diniego list/config e percorsi non previsti;
- validazione di ogni singola chiave pubblica, tipi e campi mancanti/aggiunti;
- input malformati, enum, date, consensi, dimensioni immagini, mappe annidate;
- scoring annidato, pesi/soglie/fasce errati;
- gestione legacy, aggiornamento identico, batch atomico negato;
- sovrascrittura pubblica di documento esistente e tentativo di aggiungere `role`;
- identità Google priva di ruolo negata;
- test esplicito del limite di fiducia: score pubblico alterato ma formalmente
  valido accettato; il pannello ricalcola i numeri, non è un risultato certificato.

Non verifica password/codici Worker, CORS, rate limit, emissione/revoca token, UI
completa o contenuto reale delle immagini. Questi richiedono verifiche separate.

## Futura autenticazione Google centralizzata

Le regole non dipendono dal provider di login o dal codice condiviso: richiedono un
ID token del progetto Firebase corretto con `role: admin|manager|viewer`, assegnato da un
backend autorizzato. Un login Google senza ruolo non dà accesso. Non assegnare
privilegi in base a un'email inviata dal client o allo storage del browser.

Il futuro portale dovrà preservare quel contratto o introdurre una migrazione
esplicita e testata dei claim per sezione. Non è implementato SSO, non è condiviso
alcun cookie e non è assunto disponibile il codice Worker. Servono inoltre una
politica di revoca e, se richiesto, una scadenza staff applicata server-side:
il timer locale di otto ore attuale non è una barriera di autorizzazione.
L'Admin SDK e le credenziali server privilegiate bypassano queste Rules.

## Revisione, applicazione e ripristino — solo piano

1. Confermare progetto/database e regole attive; censire altri client e dati legacy.
2. Confermare claim reali del Worker senza esportare segreti e identificare operatori.
3. Rivedere permessi manager, età minima, limiti e pubblicabilità di tutto lo scoring.
4. Ottenere `npm test` verde nell'Emulator; nessuna autorizzazione alla pubblicazione
   finché compilazione, budget di espressioni e suite non sono verificati.
5. Preparare ambiente separato e gli adeguamenti frontend sopra elencati.
6. Revisione indipendente; backup dati e regole versionate dopo autorizzazione.
7. Solo su successiva autorizzazione: applicare frontend compatibile e regole,
   verificare candidatura pubblica, get/list staff, update e dinieghi, monitorare errori.
8. Ripristino: usare una precedente versione restrittiva già collaudata oppure una
   modalità di emergenza che neghi creazioni pubbliche mantenendo accessi staff sicuri.
   **Non ripristinare `if true` come fallback.** Ripristino dati separato dal rollback Rules.

## Rischi residui e informazioni mancanti

- Creazione anonima: le Rules non sono un rate limiter; restano spam, quota e costi.
  Valutare App Check come difesa aggiuntiva, senza confonderlo con autorizzazione.
- I dati inviati, score, immagini, date e OCR sono dichiarazioni client e non prove.
- Le notifiche e il proxy AI del Worker non sono protetti da queste regole.
- Scoring pubblico: nessuna chiave o impostazione privata deve essere nello stesso documento.
- Viewer, manager e admin possono copiare/esportare tutti i dati che leggono; la UI non può impedirne copie.
- Le correzioni usano ancora `staff` e le note non hanno storico: nessun audit personale
  garantito senza modifiche allo schema/backend.
- Le dipendenze di test sono separate dal sito. Restano 5 segnalazioni moderate
  transitive (`@opentelemetry/core`/PubSub e `uuid`/gaxios/CLI). I fix automatici
  suggeriscono cambi di major o downgrade del CLI: non è stato usato `--force`.
  Gli strumenti sono destinati all’esecuzione locale su loopback; riesaminare
  queste dipendenze prima di usarli in contesti esposti.
