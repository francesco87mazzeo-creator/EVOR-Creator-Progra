# Verifica finale Firestore Rules — INCOMPLETA

Data: 27 ottobre 2026. Branch `development/collective-applications-frontend`.
Oggetto: **`security/firestore/migration/firestore.rules`**, selezionato da
`firebase.migration.json`. Non confondere con il file A1 originale: quello conserva
la versione storica che ha superato il budget nelle prove Windows riferite.

Nessuna modifica alle Rules durante questa verifica. Nessuna modifica a frontend,
Worker, Firebase o main; nessun commit, push, merge o deploy. Questo file è il
rapporto della verifica, non un'autorizzazione ad applicare la candidata.

## Evidenza di esecuzione

- Node.js 24.19.0 e Java 21 disponibili.
- Nessun binario ufficiale nella cache del progetto o nelle cache standard controllate.
- `EVORA_RULES_PROFILE=migration EVORA_EMULATOR_OFFLINE=1 npm --prefix security/firestore test`:
  codice **2**, messaggio Emulator v1.22.0 non in cache. **Zero test Rules eseguiti**.
  Nessun download tentato, nessuna modifica di proxy o verifica TLS.
- `node --test security/firestore/test/frontend-contract.test.mjs security/firestore/test/emulator-diagnostics.test.mjs`:
  **20 passati, 0 falliti**. Verificano contratto statico e riconoscimento degli
  errori/log, non compilazione né autorizzazione effettiva nella candidata.
- I 332 test della fase frontend precedente non equivalgono a test Emulator.

**Non sono verificati compilazione della candidata, budget o successo delle richieste
staff nel motore ufficiale. La verifica finale non è completata.**

## Matrice della candidata — conclusioni statiche, non esiti Emulator

| Operazione client diretta | Anonimo / autenticato senza ruolo o con ruolo sconosciuto | Viewer | Manager | Admin |
|---|---|---|---|---|
| Creare candidature | negata | negata | negata | negata |
| Leggere/elencare candidature, query per date | negata | consentita | consentita | consentita |
| Stati, note, codice creator e valutazione | negata | negata | consentita con validazione | consentita con validazione |
| Correggere Insights e dati derivati | negata | negata | consentita con validazione | consentita con validazione |
| Modificare risposte originali, identità, consensi, immagini, OCR originale | negata | negata | negata | negata |
| Eliminare candidatura | negata | negata | negata | consentita |
| Get puntuale settings/scoring | **consentita** | consentita | consentita | consentita |
| Creare/aggiornare/eliminare settings/scoring | negata | negata | negata | negata |
| Elencare settings o accedere a settings/config | negata | negata | negata | negata |
| Documenti privati di idempotenza/sessione e sottocollezioni non previste | negata | negata | negata | negata |

Il ruolo deriva esclusivamente dal claim `request.auth.token.role`; campi del
payload e storage React non assegnano privilegi. Tutto ciò che non riceve un
permesso esplicito è negato; non c'è una regola ricorsiva permissiva.

## Corrispondenza con il frontend attuale

1. **Candidatura pubblica:** invia i 54 campi a `/applications`; nessuna creazione
   Firestore diretta. Il diniego create è quindi intenzionale e non richiede Google
   Login al candidato. Il successo reale dipende dal Worker che scrive tramite IAM.
2. **Scoring amministrativo:** `FB.saveScoring` usa `/admin/scoring` con ID token
   Firebase. La lettura resta get su `settings/scoring`; nessun `.set` su quel
   documento è presente nel pannello. Il diniego client è intenzionale.
3. **Elenco:** `FB.getApps` esegue orderBy(date,desc). La candidata concede get/list
   ai lettori staff senza filtri per singola candidatura, coerentemente con la UI.
4. **Aggiornamenti:** `FB.updateApp` aggiunge updatedAt; `staffUpdate` limita il diff
   ai campi gestionali. Stati, note, codice, valutazione e correzioni usano quei campi.
5. **Eliminazione:** `FB.deleteApp` rimane diretta; il pulsante e la candidata la
   riservano all'admin.
6. **Form di prova:** simulazione locale e OCR disattivato; non richiede create DB.
7. **Helper settings/config:** getSettings/saveSettings sono presenti ma senza
   chiamanti attivi. Sarebbero negati se venissero riattivati senza aggiornare la policy.
8. **OCR, Telegram, login:** route Worker/Auth, fuori dalla copertura delle Rules.
   Non sono verificati eseguendo soltanto questa suite.
9. **Export CSV:** operazione locale sui dati leggibili, non una scrittura DB.
   Le Rules non possono distinguere consultazione da ricostruzione di un CSV.

Le operazioni consentite sono condizionali: note <=10.000 caratteri, codice <=120,
valutazioni 0–5 e struttura corretta, conteggi validi, correzioni coerenti e date ISO.
La UI corrente può consentire alcuni input fuori da tali limiti: questi verrebbero
correttamente negati. Il successo dei payload usuali va verificato nell'Emulator.

## Eccezione importante: scoring leggibile pubblicamente

`allow get: if true` concede l'intero documento, non solo alcuni campi. Il diniego
list impedisce l'elenco settings, ma non un get diretto conoscendo il percorso.

Il frontend pubblico attuale non legge più questo documento; lo legge il pannello.
Occorre confermare se i benchmark devono restare pubblici. Se lo scoring deve essere
riservato, questa candidata non soddisfa quel requisito finché il get non viene
ristretto previa decisione esplicita. Non è stata introdotta una modifica unilaterale.
Va inoltre verificato, senza esportare segreti, che il documento effettivo non
contenga vecchi campi riservati: le Rules non offrono redazione per campo.

settings/config, altri documenti settings e metadati server restano negati ai client.

## Budget di 1.000 espressioni

La candidata non richiama i validatori profondi di creazione/scoring: le relative
scritture client incontrano `false`. I vecchi risultati di superamento A1 non sono
una misurazione di questa versione, e neppure la loro rimozione prova tutta la policy.

Il percorso residuo più articolato è l'update staff: diff, valutazione completa,
metriche e insightsCorrection con due mappe numeriche. Non esiste qui un conteggio
misurato delle sue espressioni. Nessun superamento è stato osservato **perché non
è stata eseguita alcuna richiesta Rules della candidata**.

Il runner conserva il controllo di errori di budget nei messaggi e nei log freschi,
invalidando l'esito anche se un assertFails isolato risulta passato. Non ridurre i
vincoli o accettare errori di budget come dinieghi di autorizzazione riusciti.

## Verifiche residue prima dell'applicazione

- Eseguire la suite ufficiale candidata: casi positivi staff e negativi di tutti
  i ruoli, query reali, valutazione completa e correzione completa nello stesso update.
- Confermare compilazione e nessun esaurimento budget, conservando log e riepilogo.
- Decidere e verificare la pubblicabilità di settings/scoring.
- Verificare in ambiente isolato che i due endpoint usino davvero identità IAM e
  percorsi corretti: quelle scritture bypassano le Rules e dipendono da auth/validazione Worker.
- Verificare CORS, token admin e comportamento 400/401/403; non inviare test in produzione.
- Gestire separatamente viewer/C1: le Rules ammettono viewer in lettura, ma il login
  frontend corrente accetta ancora admin/manager. Owner non è un alias automatico.
- Revoca centrale e audit individuale non sono aggiunti da questa candidata.

## Procedura Windows per completare l'esecuzione

Usare la versione aggiornata del branch `development/collective-applications-frontend`,
non il vecchio branch A1. Conservare anche `test/frontend/legacy-submit-reference.mjs`
nella struttura relativa: è importato dalle fixture. La pubblicazione del branch
non applica le Rules e non completa la verifica Emulator.

```powershell
Set-Location security\firestore
$env:EVORA_RULES_PROFILE = 'migration'
npm.cmd test
$esitoRules = $LASTEXITCODE
Remove-Item Env:EVORA_RULES_PROFILE
"Codice uscita: $esitoRules"
```

Richiede Node 24, Java 21 e binario ufficiale scaricabile sulla macchina Windows;
usa demo-evora-security e solo loopback. Non serve Firebase login. Un fallimento
preliminare o un limite di espressioni lascia la verifica incompleta. Nessun deploy.
