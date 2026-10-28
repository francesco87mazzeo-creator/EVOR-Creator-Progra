# Scoring v2 (Modello A)

Stato: **implementato su branch, non pubblicato.** Nessun merge, deploy di Worker o Rules senza autorizzazione esplicita.

## Modello

| Componente | Dato | Peso predefinito | Riferimento iniziale (vale 50/100) |
|---|---|---|---|
| Coinvolgimento | interazioni ÷ visualizzazioni × 100 | 65% | 2% |
| Visibilità | visualizzazioni (30 giorni) | 35% | 30.000 |

- **Normalizzazione logaritmica approvata:** per ogni componente `H(x;s) = 100 × ln(1 + x/s) / [ln(1 + x/s) + ln 2]`, dove `s` è il riferimento.
  - È crescente e continua: 0 vale 0, il riferimento vale 50, il doppio circa 61, il triplo circa 67; tende a 100 senza raggiungerlo.
  - Non ci sono fasce follower né soglie, quindi non ci sono salti.
- **Punteggio quantitativo:** `round((coinvolgimento × peso + visibilità × peso) / somma dei pesi)`, da 0 a 100.
- **Indicatore B:** interazioni ÷ account raggiunti × 100.
  - È solo informativo e non entra mai nel punteggio.
  - Senza account raggiunti, o con valore 0, non è disponibile.
- **Base di osservazione ridotta:** visualizzazioni sotto 1.000 o interazioni sotto 10, soglie configurabili.
  - È solo una segnalazione per lo staff: il punteggio non viene corretto.
- **Cosa il punteggio non fa:**
  - non ha livelli né classificazioni: le vecchie soglie HIGH/GOOD/AVERAGE/LOW non sono riutilizzate;
  - non approva né rifiuta;
  - non cambia lo stato della candidatura.
- **Follower e follower netti:**
  - si raccolgono e si mostrano, ma non entrano nel punteggio;
  - i follower netti possono essere negativi o zero.
- **Valori mancanti:** se visualizzazioni o interazioni mancano o non sono valide, il punteggio è *non calcolabile*. Non diventa mai zero.
- **Zero visualizzazioni:** è un dato reale, distinto da un dato mancante.
  - Lo zero resta salvato (`views: 0`); il coinvolgimento non è calcolabile.
  - Il punteggio complessivo è **non disponibile** (`socialScore: null`), mai mostrato come zero; la base è segnalata come ridotta.
  - Admin e notifica Telegram lo indicano esplicitamente («zero visualizzazioni»), con un messaggio diverso da quello dei dati mancanti.

La stessa funzione è in `server/collective/scoring.mjs` e in `app/admin.jsx`, tra i marcatori `scoring-core`. Un test verifica che il testo sia identico e altri test confrontano i risultati.

## Versioni

- **Configurazione `settings/scoring` versione 3:** la versione 2 apparteneva al modello precedente.
- **Configurazioni salvate con il modello precedente:** vengono ignorate, senza conversione, e si applicano i valori predefiniti. Il documento su Firestore resta invariato finché un admin non salva.
- **Documento della candidatura schema 5**, con i campi:
  - `socialScore`
  - `scoringVersion: 3`
  - `engagementRate`
  - `engagementScore`
  - `visibilityScore`
  - `reachEngagementRate`
  - `lowBase`
- **Campi non più scritti:** `perfLevel`, `bandLabel`, `erRate`, `reachRate`, `growthRate`.

## Dati della candidatura

| Dato | Obbligatorio | Note |
|---|---|---|
| Follower totali | sì | dallo screenshot del profilo |
| Visualizzazioni 30 gg | sì | punteggio |
| Interazioni 30 gg | sì | punteggio |
| Follower netti 30 gg | sì | anche negativi o zero |
| Account raggiunti | no | «Account che hanno visualizzato»; `null` se non indicati, mai 0 e mai sostituiti con le visualizzazioni |

- **Precheck:**
  - basta un solo screenshot se i tre dati obbligatori sono leggibili;
  - un dato obbligatorio non letto richiede un secondo screenshot;
  - se mancano solo gli account raggiunti, il secondo screenshot viene proposto ma non è richiesto.
- **Lettura OCR:**
  - un testo che non è un numero («—», «non visibile») resta un dato mancante;
  - un valore senza stato di visibilità esplicito va ricontrollato e non risulta verificato.
- **Inserimento o completamento manuale** (pulsante «Prosegui inserendo i dati a mano»):
  - dopo un errore tecnico della lettura (rete, tempo scaduto, 429, 5xx), con lo screenshot caricato;
  - quando la schermata è riconosciuta come corretta (`profile_ok`, `insights_ok`) ma uno o più valori obbligatori non sono stati letti, anche dopo due letture incomplete e anche se manca il numero di follower nel profilo;
  - i valori letti restano precompilati e la lettura automatica resta allegata: i valori mancanti risultano «Inserito dal candidato» nell'Admin;
  - **non** è offerto per schermate sbagliate (`wrong_screen`, `dashboard_wrong`), incerte (`uncertain`) o richieste rifiutate dal servizio di lettura (400, 401, 403, 413…).
- **Prima dell'invio** devono essere presenti follower totali, visualizzazioni, interazioni e follower netti (anche zero o negativi); nel modulo tutti i valori restano correggibili.
- **Invio:** è bloccato con dati obbligatori vuoti o non interi.
- **Testi delle istruzioni OCR:** non sono stati modificati, quindi le impronte nel Worker restano valide.

## Admin

- **Pagine:** elenco e dettaglio restano quelli attuali; cambiano solo i contenuti dello scoring:
  - punteggio, componenti e indicatore B;
  - avviso di base ridotta;
  - filtro «Base di osservazione»;
  - ordinamenti per coinvolgimento e indicatore B.
- **Provenienza di ogni valore:** lettura automatica, modificato dal candidato, inserito dal candidato o corretto dallo staff.
- **Correzione:** i cinque valori sono correggibili; gli account raggiunti si possono svuotare.
  - Ogni correzione si aggiunge a `insightsHistory` (massimo 50) e aggiorna `insightsCorrection`.
  - Una correzione singola fatta in precedenza diventa la prima voce dello storico.
  - Il punteggio viene ricalcolato; lo stato non cambia.
- **Candidature storiche:**
  - il punteggio v2 è calcolato a ogni lettura;
  - il punteggio salvato all'invio con il modello precedente è mostrato a parte come non confrontabile;
  - nessuna candidatura viene riscritta.
- **Valutazione qualitativa manuale:** invariata.

## Rules Firestore (profilo migration)

- **Cosa accettano:**
  - le correzioni a cinque valori;
  - gli account raggiunti nulli;
  - i follower;
  - i nuovi campi del punteggio;
  - lo storico append-only, verificato in modo che le voci precedenti restino invariate e l'ultima coincida con la correzione.
- **Compatibilità durante il rilascio:** restano valide anche le scritture del pannello precedente (correzione a quattro valori, `perfLevel`, `erRate`, …).
- **Limite di valutazione:** i controlli sono raggruppati per famiglia di campi, così ogni richiesta, rifiuti compresi, resta entro il limite di 1.000 espressioni.
- **Verifica:** suite dell'Emulator.

## Ordine di pubblicazione

Ogni passo richiede un'autorizzazione esplicita.

1. **Rules** (`security/firestore/migration/firestore.rules`): compatibili con il pannello attuale, vanno pubblicate per prime. Senza, l'editor della nuova Admin viene rifiutato.
2. **Worker:** dopo la pubblicazione `/applications` salva lo schema 5 e la notifica Telegram mostra il nuovo punteggio. Il frontend attuale continua a funzionare, perché invia sempre gli account raggiunti.
   - Da quel momento la configurazione della vecchia Admin non è più accettata da `/admin/scoring`: risposta 400, nessuna scrittura.
3. **Frontend** (merge su `main`, GitHub Pages): modulo con account raggiunti facoltativi e Admin con scoring v2.
   - **Mai prima del Worker.** Il Worker attuale rifiuterebbe con 400 le candidature con account raggiunti vuoti (`null`) e le configurazioni salvate dalla nuova Admin.

## Ripristino senza interrompere le candidature in compilazione

Una pagina già aperta resta in uso anche dopo un revert: GitHub Pages non la ricarica. Il Worker di compatibilità è un runtime autonomo e congelato al commit `c29d05b5d75f176906288c5bc16be0b7fe9f7bbc`, con il contratto V2 e lo stesso scoring/OCR. Non importa i moduli correnti e non richiede mai di completare la reach. Preparazione e verifiche in [`worker/rollback/README.md`](../worker/rollback/README.md).

| Payload | Worker legacy (`main` pre-V2, NON valido per il rollback) | Worker scoring v2 | Worker di compatibilità congelato |
|---|---|---|---|
| pagina precedente, account raggiunti indicati | accettato | accettato | accettato |
| pagina nuova, account raggiunti indicati | accettato | accettato | accettato |
| pagina nuova, account raggiunti vuoti | rifiutato (400 `TYPE` `$.accountsReached`) | accettato | accettato, salvati `null` |
| pagina nuova, zero visualizzazioni | accettato | accettato | accettato, score non disponibile |

La pagina precedente non può inviare account raggiunti vuoti: li blocca già nel browser.

**Procedura consigliata**, dal meno al più invasivo:

1. **Problema nel frontend** (modulo o Admin): revert del merge su `main`. **Il Worker v2 resta pubblicato**: accetta sia le pagine nuove ancora aperte sia quelle precedenti, quindi nessuna candidatura in compilazione si interrompe.
2. **Ripristino completo della distribuzione:** ripristinare il frontend e, se serve sostituire il Worker, usare **esclusivamente il runtime di compatibilità** preparato in `worker/rollback/compat/`, con entrypoint `worker/rollback/wrangler.compat.toml`. Le Rules V2 restano pubblicate.
   - È un ripristino del runtime compatibile, **non un downgrade del contratto dati o dello scoring**: mantiene schema 5, configurazione 3, reach facoltativa, convalida, autenticazione, limiti e idempotenza della base verificata.
   - Le pagine nuove già aperte inviano anche con reach realmente indisponibile: nessun dato viene richiesto in più né sostituito con zero/visualizzazioni. Una chiave invariata produce una sola candidatura anche in caso di retry.
   - La nuova Admin conserva il salvataggio della configurazione 3. Il vecchio pannello configura invece il modello precedente: durante il ripristino non usarlo per modificare lo scoring (riceverebbe 400); per le nuove pagine Admin già aperte e le correzioni i contratti V2 restano compatibili.
   - **Vietato ripristinare alla cieca il Worker legacy con `wrangler rollback <vecchia-versione>`**: richiede la reach. Il messaggio di recupero nel form è un aiuto per endpoint legacy/configurati male, non la strategia di rollback.
   - Dopo una pubblicazione futura autorizzata, registrare il version ID Cloudflare del runtime compatibile: un eventuale `wrangler rollback` è utilizzabile solo verso quel version ID verificato compatibile, mai verso il legacy.
3. **Rules:** non vanno ripristinate. Accettano sia le scritture del pannello precedente sia quelle nuove; tornare al ruleset precedente renderebbe solo impossibili le correzioni dalla nuova Admin ancora aperta.

I documenti di schema 5 restano leggibili dalla vecchia Admin, che non trova `perfLevel` e ricalcola il vecchio punteggio sui dati (con gli account raggiunti mancanti torna a usare le visualizzazioni, come faceva prima). Tale visualizzazione non è confrontabile con V2 e non cambia i valori salvati; per la valutazione V2 usare la nuova Admin. Ripristinare i file frontend non ripristina automaticamente impostazioni o dati, che non vanno riscritti.

Il test browser «Compatibility rollback» lascia aperta la nuova pagina compilata, cambia l'handler al vero Worker congelato e completa l'invio con reach `null`, senza ricaricare il browser. Sono simulate soltanto OAuth/Firestore; nessun servizio reale viene contattato e Telegram non è configurato. I test Worker verificano anche il payload precedente, lo zero reale, il replay e le richieste non autorizzate.

## Storico delle correzioni: limiti

Durante la compatibilità con il vecchio Admin `insightsHistory` **non è ancora un audit trail garantito dal server**:

- **Il pannello precedente** (ancora aperto o in cache) può scrivere `insightsCorrection` senza aggiungere una voce allo storico: le Rules lo consentono per non bloccarlo durante il rilascio. Quella correzione manca dallo storico.
- **Dati dichiarati dal client:** `correctedAt` è l'orologio del browser e `correctedBy` è sempre `"staff"`; le Rules non registrano chi ha scritto né l'ora del server. Un utente staff con accesso diretto all'SDK può scrivere correzioni con questi valori.
- **Cosa è garantito oggi:** con la nuova Admin le Rules impediscono di modificare o eliminare le voci già presenti, di aggiungerne più di una per volta, di superare 50 voci e di scrivere una voce diversa dalla correzione salvata insieme.

Per uno storico garantito servirebbe, dopo il ritiro del pannello precedente: Rules che richiedono una voce di storico a ogni correzione, ora del server (`request.time`) e identità dell'autore (`request.auth.uid`), oppure un endpoint del Worker che scriva lo storico. È una modifica di architettura e non è inclusa in questa PR.

## Rischi

- **Punteggi mostrati:** cambiano per tutte le candidature, perché l'Admin ricalcola sempre con il modello corrente. Gli stati non cambiano.
- **Riferimenti iniziali:** sono sperimentali e non calibrati sui dati reali.
- **Candidature con dati storici incompleti:** mostrano «non calcolabile».
- **Configurazione salvata con il modello precedente:** dopo la pubblicazione del Worker viene ignorata; finché non si salva una configurazione v3, valgono i valori predefiniti.
