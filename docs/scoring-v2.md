# Scoring v2 (Modello A)

Stato: **implementato su branch, non pubblicato.** Nessun merge, deploy di Worker o Rules senza autorizzazione esplicita.

## Modello

| Componente | Dato | Peso predefinito | Riferimento iniziale (vale 50/100) |
|---|---|---|---|
| Coinvolgimento | interazioni ÷ visualizzazioni × 100 | 65% | 2% |
| Visibilità | visualizzazioni (30 giorni) | 35% | 30.000 |

- **Normalizzazione continua:** per ogni componente `100 × valore / (valore + riferimento)`.
  - È crescente e continua: 0 vale 0, il riferimento vale 50, e tende a 100 senza raggiungerlo.
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
- **Zero visualizzazioni:** è un dato osservato. Il coinvolgimento non è definito, la sua componente vale 0 e la base è segnalata come ridotta.

**Da confermare:** la formula di normalizzazione (`valore/(valore+riferimento)`) è una scelta di questa implementazione. L'analisi di Codex citata nella richiesta non era disponibile nel repository. Se prevede una curva diversa, basta cambiare la funzione `saturate` e i test che la descrivono.

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
- **Inserimento manuale:** dopo un errore tecnico della lettura si inseriscono i valori a mano; nel modulo tutti i valori restano correggibili.
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

**Annullamento:**
- **frontend:** revert del merge;
- **Worker:** `wrangler rollback` alla versione precedente;
- **Rules:** ripubblicazione del ruleset precedente.

I documenti di schema 5 restano leggibili dalla vecchia Admin, che non trova `perfLevel` e calcola il vecchio punteggio sui dati.

## Rischi

- **Punteggi mostrati:** cambiano per tutte le candidature, perché l'Admin ricalcola sempre con il modello corrente. Gli stati non cambiano.
- **Riferimenti iniziali:** sono sperimentali e non calibrati sui dati reali.
- **Candidature con dati storici incompleti:** mostrano «non calcolabile».
- **Configurazione salvata con il modello precedente:** dopo la pubblicazione del Worker viene ignorata; finché non si salva una configurazione v3, valgono i valori predefiniti.
