# COLLECTIVE — preparazione frontend e Rules di destinazione

Branch: `development/collective-applications-frontend`, da `5447b21`.
La condivisione avviene solo sul branch di sviluppo: nessun merge, deploy o modifica del Worker/Firebase online.
Il codice integrato del Worker non è nel checkout; il contratto seguente è stato
fornito da Claude Code tramite l'utente. I 320 test del Worker sono un risultato
riferito, non eseguito qui. Le prove browser usano servizi sostituiti e rete bloccata.

## Contratto /applications recepito

- POST JSON con i soli 54 campi pubblici del validatore `server/collective`.
- 32 campi obbligatori e 22 facoltativi; il frontend invia tutte le 54 chiavi.
- Numeri JSON interi; nessuna conversione silenziosa di decimali, esponenti,
  valori mancanti obbligatori o NaN in zero. TikTok facoltativo vuoto diventa 0.
- Massimo 1 MiB UTF-8; conservato il limite aggregato immagini di 900.000 caratteri.
- Header `Idempotency-Key`: `crypto.randomUUID()`, formato 16–64 caratteri alfanumerici/trattini.
- Il browser invia automaticamente Origin dell'hosting; non si tenta di impostare
  un header Origin artificiale. Origine prevista: `https://collective.evorafitness.it`.
- Conferma: 201 con `{ok:true,id:stringaNonVuota}`; replay: 200 con gli stessi
  campi e `duplicate:true`. Un generico 2xx o una risposta senza ID non basta.
- Errori comuni `{error:stringa}`, validazione `{error:{code,path}}`. Percorso
  accettato sia `$.campo` sia `campo`; messaggi interni non vengono mostrati.
- Gestiti 400, 403, 405, 413, 415, 429 e 503 (e dinieghi/timeouts inattesi).
- Nessuna dipendenza da Retry-After: non è attualmente esposto al browser.
- Nessun retry automatico: anche i replay consumano la quota di 10 richieste/ora/IP.
- Il Worker salva e notifica. Nessun `/notify` dopo l'invio pubblico.

## Frontend preparato

`public/applications-client.js` è caricato prima di React/Babel; non usa Firebase.
La whitelist è verificata automaticamente contro i 54 campi del validatore server.
Campi derivati, ruoli, note e valutazioni presenti nello stato del form non entrano
nel JSON. Non vengono calcolati ID, date o scoring autorevoli nel browser.

L'invio rivalida tutti i sette passaggi, converte i numeri in modo rigoroso, crea
uno snapshot del payload e genera la chiave una sola volta. Doppio clic simultaneo
→ una richiesta. Timeout, errore di rete, 429 e 503 → stesso corpo e stessa chiave
nel tentativo manuale successivo. Non cambiare payload/chiave dopo un esito incerto:
la UI lo impedisce e spiega come evitare duplicati.

Dopo un rifiuto definitivo di validazione/accesso, un payload invariato mantiene
la chiave; la correzione del payload può iniziare una nuova richiesta. Una nuova
candidatura dopo conferma genera una nuova chiave. Nessun fallback a Firestore.
La conferma resta subordinata alla risposta esplicita del Worker.

Chiave e snapshot restano in memoria, non in localStorage: niente persistenza
aggiuntiva di dati personali/screenshot. La continuità dell'idempotenza dopo
refresh/chiusura della scheda non è garantita; il form non aveva una bozza persistente.
Non confondere idempotenza del tentativo con unicità per email o persona.

Il client espone un hook opzionale `getTurnstileToken({signal})`: quando integrato,
è chiamato di nuovo per ogni tentativo e il token va in `X-Turnstile-Token`, mai nel
payload/hash/idempotency key. Il timeout copre anche l'acquisizione del token.
**Nessun widget viene attivato automaticamente.** Se il Worker abilita Turnstile,
occorre prima collegare il widget e il reset/new-token a quell'hook; altrimenti
questa versione non è pronta per quella configurazione.

## Form di prova

- `testMode` simula la conferma senza preparare o inviare richieste.
- Upload e verifiche OCR del form di prova sono disattivati prima di leggere/inviare file.
- Nessuna lettura scoring, scrittura Firestore, chiamata applications o notifica.
- Banner e conferma distinti: “Simulazione completata”, nessuna candidatura salvata.
- Il test notifiche nelle Impostazioni admin è una funzione separata e non viene
  automaticamente disattivato: il relativo endpoint Worker va verificato separatamente.

## Età: decisione founder confermata — solo maggiorenni

Decisione definitiva ricevuta il 27 ottobre 2026: candidature esclusivamente 18+.
Il frontend di questo branch è allineato al validatore server esistente: numeri
interi nell'intervallo 18–99. Worker e Firebase non sono modificati.

Controlli applicati:

- Campo HTML con min 18, max 99, step 1 e testo esplicito.
- Validazione all'avanzamento e nuovamente all'invio finale, senza fidarsi della
  navigazione o dei soli attributi HTML.
- Client HTTP: età sotto 18, sopra 99, non intere o non numeriche rifiutate prima
  di generare una richiesta; dichiarazione di maggiore età obbligatoria.
- Form di prova: anche la simulazione richiede età 18–99 e dichiarazione;
  rimane priva di scritture o chiamate esterne.
- Landing e precheck mostrano il requisito 18+ prima dell'upload degli screenshot.
- Dichiarazione allineata: “Dichiaro di aver compiuto 18 anni.”

Test: minori rifiutati senza POST, soglie 18 e 99 accettate, invio finale chiamato
direttamente fuori dalla navigazione, simulazione e percorso browser completo.
L'oracolo storico e i casi negativi possono ancora menzionare età inferiori:
non sono codice caricato dal browser o percorsi di invio attivi.

### Testi da sottoporre a revisione, senza nuove clausole

- Regolamento/condizioni di partecipazione: rendere esplicita l'ammissione dei soli
  maggiorenni e verificare che non esistano indicazioni incompatibili su altri canali.
- Informativa privacy e testi relativi agli screenshot/OCR: verificare coerenza
  con il requisito 18+ e con il flusso effettivo di raccolta delle immagini.
- La dichiarazione di maggiore età è stata allineata; il testo del consenso privacy
  non è stato riscritto e non sono state inventate nuove condizioni o basi giuridiche.

Nel checkout non sono presenti regolamento completo e informativa completa da
verificare o aggiornare. I controlli riguardano l'età dichiarata, non una verifica
anagrafica. Il precheck informa sul requisito prima dell'upload ma l'età viene
inserita nello step Profilo: non si dichiara introdotta una verifica d'identità o
un blocco anagrafico prima di ogni trattamento OCR.

## Inventario amministrativo e impatto della chiusura

| Operazione attuale | Percorso | Effetto delle Rules proposte |
|---|---|---|
| Login staff e lettura claim | Worker `/auth` + Firebase Auth | Le Rules non lo modificano; nessun secondo login introdotto |
| Elenco e dettaglio | `candidature`, query per date | Consentiti a admin/manager/viewer nel token corrente |
| Stati | update candidatura + updatedAt | Consentiti a admin/manager, valori ammessi invariati |
| Note | stesso update | Consentite a admin/manager, max 10.000 |
| Codice creator | stesso update | Consentito a admin/manager, max 120 |
| Valutazione | stesso update | Consentita a admin/manager, sei criteri 0–5 |
| Correzioni Insights e metriche | stesso update | Consentite a admin/manager con schema precedente preservato |
| Eliminazione | delete candidatura | Solo admin, invariato rispetto alla proposta precedente |
| Export CSV | trasformazione locale dei dati letti | Non è una scrittura; le Rules non lo distinguono dalla lettura |
| Lettura scoring | get `settings/scoring` | Solo admin/manager/viewer nelle Rules candidate |
| Salvataggio scoring | FB.saveScoring → POST /admin/scoring con ID token | Compatibile lato frontend con il diniego delle scritture Firestore client; verifica integrata ancora necessaria |
| Test notifica | Worker `/notify` | Fuori da Firestore Rules; verificare il contratto Worker aggiornato |
| settings/config | Nessuna operazione frontend | Helper getSettings/saveSettings rimossi; accesso client negato |
| Form di prova | simulazione locale | Nessuna scrittura da autorizzare |

La sola distinzione create pubblico / update staff non rompe gli update esistenti:
`FB.updateApp` usa update con updatedAt e viene valutato con claim e diff campi.
Una `set` completa su un documento esistente è comunque un update e deve rispettare
la stessa immutabilità: nessuna riapertura delle scritture anonime.

### Scoring amministrativo collegato al Worker

Contratto ricevuto dall'utente: POST `/admin/scoring`, JSON della configurazione
completa attuale, `Authorization: Bearer <Firebase ID token>` ottenuto tramite
`auth.currentUser.getIdToken()`, solo ruolo **admin**. Errori 400 (configurazione),
401 (token mancante/scaduto), 403 (ruolo). Il Worker scrive via service account.
Questa descrizione proviene dal contratto fornito: il nuovo sorgente Worker e IAM
non sono stati interrogati in produzione.

`FB.saveScoring` ora delega a `public/admin-scoring-client.js`; non contiene più
`.set` Firestore. Il pannello prepara lo stesso JSON completo (inclusa ultima
fascia `max:null`) e aggiorna lo scoring locale solo dopo risposta HTTP positiva.
Il contratto non specifica una forma JSON di successo: vengono accettati gli esiti
HTTP 2xx senza inventare campi obbligatori. Non c'è retry automatico.

- 400: errore configurazione nel pannello; modifiche locali conservate, nessuna conferma.
- 401 o sessione assente/non utilizzabile: logout locale tramite `AUTH.logout`,
  ritorno al flusso di accesso riservato già esistente e messaggio di nuovo login.
  Non viene introdotto un login Google o un secondo flusso di autenticazione.
- 403: messaggio ruolo non autorizzato, nessun logout o tentativo di elevazione.
- Errore transitorio SDK di rete: messaggio riprovabile, nessuna richiesta Worker
  e nessun logout automatico.
- Timeout/rete/servizio: esito non confermato; nessun onSaved, nessun fallback DB.

Il token non entra in URL, storage applicativo o messaggi di errore; redirect HTTP
rifiutati. Il Worker resta responsabile di firma/validità del token, ruolo e schema:
un claim inviato nel JSON o un controllo solo UI non sarebbe sufficiente.
Lettura Firestore e pulsante di ripristino dei valori iniziali restano invariati;
il ripristino modifica soltanto lo stato locale fino al salvataggio esplicito.

Le Rules candidate negano tutte le scritture client allo scoring: il salvataggio
non esegue più il validatore Rules che ha superato le 1.000 espressioni. Non significa
che tutte le altre operazioni staff siano automaticamente verificate: la suite
migration deve ancora essere eseguita con l'Emulator ufficiale.

Il vecchio blocco di incompatibilità `FB.saveScoring -> set` è risolto nel frontend
preparato. Prima dell'attivazione restano la prova del Worker reale in ambiente
isolato (incluso CORS con **Authorization**), IAM e la verifica completa delle Rules.

## Proposta Rules separata, non applicata

File: `security/firestore/migration/firestore.rules`.
Configurazione locale: `security/firestore/firebase.migration.json`.
Le vecchie Rules `security/firestore/firestore.rules` NON sono modificate o
presentate come risolte: restano la versione A1 che ha fallito nel rapporto Windows.

La candidata:

- nega create dirette alle candidature per qualunque client, anche staff;
- conserva get/list per i claim correnti admin/manager/viewer;
- conserva update staff limitati ai campi gestionali e delete solo admin;
- limita get dello scoring a admin/manager/viewer e nega ogni scrittura client;
- non concede accesso client a idempotenza, sessioni o altri documenti privati;
- non include più i costosi validatori di create/scoring: la validazione è del Worker;
- non inventa claim owner o sessioni Google: la migrazione C1 resta separata.

Le scritture REST tramite service account/IAM non sono autorizzate dalle Rules:
le bypassano, quindi la sicurezza effettiva di quelle operazioni dipende dal Worker.
Le operazioni staff di correzione mantengono la propria validazione. Il loro budget
è da misurare: non è confermato dal passaggio delle sole prove statiche.
Il viewer nelle Rules è in sola lettura, ma il frontend di autenticazione corrente
accetta ancora solo admin/manager e l'export non è ancora separato per ruolo:
non si dichiara completata l'integrazione viewer/C1.

**Candidata non applicata: attivazione subordinata ai test Emulator e all’integrazione isolata di applications/admin-scoring, non ai soli test simulati.**

## Test e riproduzione

Senza rete o credenziali:

```sh
node --test test/frontend/client.test.mjs
npm --prefix server/collective test
node --test security/firestore/test/frontend-contract.test.mjs security/firestore/test/emulator-diagnostics.test.mjs
```

L'oracolo di preparazione documento precedente è congelato in
`test/frontend/legacy-submit-reference.mjs` (da 5447b21). Non viene caricato dalla
pagina: preserva i test del documento storico a 71 campi mentre il nuovo HTTP usa
54 campi. Le formule restano lette dal frontend attuale.

Browser, con Playwright/Chromium disponibili e dipendenze di prova installate fuori
repo (`@babel/standalone@7.28.5`, `react@18.3.1`, `react-dom@18.3.1`):

```sh
EVORA_BROWSER_ASSETS=/tmp/evora-browser-assets node --test --test-concurrency=1 test/frontend/browser.test.mjs
```

Tutte le richieste sono intercettate e risposte localmente: SDK Firebase simulato,
OCR simulato, risposta applications secondo il contratto fornito. Nessun accesso
al database o invio reale. Non sono smoke test del Worker distribuito o del suo CORS.

Emulator per la candidata, dopo trasferimento su Windows:

```powershell
Set-Location security\firestore
$env:EVORA_RULES_PROFILE = 'migration'
npm.cmd test
Remove-Item Env:EVORA_RULES_PROFILE
```

Il runner mantiene il guard degli errori di budget e usa il progetto demo locale.
La suite candidata non usa il vecchio prerequisito create anonima positiva: ora è
intenzionalmente negata. I documenti vengono predisposti solo con regole disabilitate
nel test harness; i casi staff positivi sono eseguiti con Rules attive.

In cloud è stata usata solo modalità offline: binario assente, uscita 2, zero test
Emulator eseguiti e nessun nuovo download tentato. Non dichiarare la candidata
compilata o sotto le 1.000 espressioni prima dell'esecuzione ufficiale.

## Controlli di rilascio ancora necessari

- Confermare origine/CORS e Idempotency-Key nel Worker effettivamente distribuito;
  non è stato inviato alcun POST di prova in produzione.
- Requisito 18+ allineato su questo branch; completare la revisione di regolamento e informativa esterni.
- Salvataggio scoring collegato a /admin/scoring: verificare CORS Authorization, risposta e autorizzazioni sul Worker integrato prima dell’attivazione.
- Eseguire la suite migration con log freschi e controllare tutte le azioni staff.
- Prima di attivare Turnstile, collegare il widget al token-provider e testare retry/replay.
- Verificare separatamente UI viewer, export, identità personali e revoca C1.

## Risultati dell'esecuzione corrente

- 58 test client HTTP/payload/idempotenza/Turnstile hook, inclusi limiti età: passati.
- 12 test sui reali handler dei limiti gestionali (incluse soglie e maiuscolo): passati.
- 16 test scoring amministrativo (ID token, HTTP, sessione e assenza scritture dirette): passati.
- 22 test sui veri handler di validazione/invio, invocati direttamente: passati.
- 208 test dei moduli server e della parità del documento storico: passati.
- 21 test di contratto Rules originale e guard diagnostico, inclusa assenza degli helper eliminati: passati.
- 10 test Chromium: percorso pubblico, form di prova, età, scoring/reset, gestione 400/401/403 e limiti gestionali: passati.
- **Totale locale: 347 passati, 0 falliti.** Tutti con dati sintetici e senza
  richieste ai servizi reali; i test browser intercettano ogni richiesta.
- JSX compilato con Babel di prova; controlli sintattici JS e `git diff --check` passati.
- Suite migration Firebase Emulator: **non eseguita**, uscita 2 in modalità offline
  per binario non in cache. Nessuna nuova prova del budget delle Rules è dichiarata.
- I 320 test Worker riferiti dall'utente non sono inclusi nel totale locale.


## Rifiniture finali: scoring riservato e limiti gestionali

Le Rules candidate ora concedono il get di settings/scoring solo a reader()
(admin/manager/viewer), senza aprire alcuna scrittura client. Il percorso pubblico
non legge lo scoring; il Worker accede via service account/IAM. Nessuna modifica
alle Rules online o al file storico A1.

Aggiunti maxlength e indicazioni leggibili: note 10.000, nota correzione 2.000,
codice creator 120. Gli handler ricontrollano i limiti prima di qualsiasi update,
anche per dati legacy sovradimensionati o aggiramento degli attributi HTML.
Il codice creator viene controllato anche DOPO trim/maiuscolo (es. ß → SS).
I valori non vengono troncati silenziosamente e quelli validi restano invariati.

getSettings e saveSettings sono rimossi da FB: nessun riferimento nel frontend
operativo o nei client public/. Le fixture storiche sono esclusivamente oracoli di test.

Il founder ha riferito **73 test Emulator ufficiali passati, zero fallimenti**, sulla
candidata del commit cf063e4. È una conferma indipendente della versione precedente,
non un'esecuzione locale di questa modifica. La lettura ora ristretta deve essere
ricontrollata con la suite migration aggiornata. Il tentativo offline locale termina
con codice 2 perché il binario non è in cache; non è stato tentato alcun download.
