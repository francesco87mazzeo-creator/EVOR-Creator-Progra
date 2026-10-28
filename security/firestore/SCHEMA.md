# Contratto dei documenti — candidato per revisione

## Schema 5 e scoring v2 (branch `scoring/v2-engagement-views`, non pubblicato)

Il Worker scrive i nuovi documenti con `schemaVersion: 5`. Rispetto allo schema 4 descritto sotto:

- **`accountsReached`:** intero 0–10¹² **oppure `null`** se non indicato. Non è mai sostituito con le visualizzazioni.
- **Campi del punteggio v2:**
  - `scoringVersion` (`3`);
  - `socialScore` (intero 0–100, oppure `null` con zero visualizzazioni);
  - `engagementRate` (numero o `null`);
  - `engagementScore` e `visibilityScore` (interi 0–100 o `null`);
  - `reachEngagementRate` (numero o `null`);
  - `lowBase` (booleano).
- **Campi del modello precedente:** `perfLevel`, `bandLabel`, `erRate`, `reachRate` e `growthRate` non sono più scritti nei nuovi documenti. Restano invariati nei documenti di schema 4.
- **Correzioni dello staff:**
  - correggibili: `followers`, i quattro dati Insights e i campi del punteggio v2;
  - `insightsCorrection` con cinque valori (`followers`, `views`, `netFollowers`, `interactions`, `accountsReached`);
  - `insightsHistory`, lista append-only di massimo 50 correzioni, la cui ultima voce coincide con `insightsCorrection`.
  - Le correzioni a quattro valori del pannello precedente restano ammesse.

Rules in `migration/firestore.rules`; dettagli e ordine di pubblicazione in [docs/scoring-v2.md](../../docs/scoring-v2.md).

## Schema 4 (storico)

Questa tabella documenta le regole proposte, non lo stato dei dati online.
La compilazione e i test Emulator restano bloccati dal download HTTP 403.

## Candidatura nuova: 71 campi obbligatori

Tutte le chiavi sono obbligatorie, anche quando il valore può essere vuoto o `null`.
Chiavi aggiuntive sono negate. Il frontend corrente produce queste 71 chiavi.
I limiti non presenti oggi nell'interfaccia vanno recepiti prima dell'attivazione.

| Campo | Vincolo in creazione |
|---|---|
| `fullName` | Stringa, massimo 199 caratteri; non vuota né solo spazi |
| `email` | Stringa, massimo 199 caratteri; non vuota né solo spazi |
| `city` | Stringa, massimo 200 caratteri; non vuota né solo spazi |
| `country` | Stringa, massimo 200 caratteri; non vuota né solo spazi |
| `otherProfileCategory` | Stringa, massimo 200 caratteri; non vuota né solo spazi |
| `instagram` | Stringa, massimo 200 caratteri; non vuota né solo spazi |
| `tiktok` | Stringa, massimo 200 caratteri; vuota ammessa |
| `screenshotName` | Stringa, massimo 255 caratteri; vuota ammessa |
| `screenshotName2` | Stringa, massimo 255 caratteri; vuota ammessa |
| `contentUrl1` | Stringa vuota oppure URL HTTP/HTTPS, massimo 2.048 caratteri |
| `contentUrl2` | Stringa vuota oppure URL HTTP/HTTPS, massimo 2.048 caratteri |
| `contentUrl3` | Stringa vuota oppure URL HTTP/HTTPS, massimo 2.048 caratteri |
| `threeWords` | Stringa, massimo 120 caratteri; non vuota né solo spazi |
| `contentType` | Stringa, massimo 600 caratteri; non vuota né solo spazi |
| `whatToTransmit` | Stringa, massimo 600 caratteri; non vuota né solo spazi |
| `whyFollow` | Stringa, massimo 600 caratteri; non vuota né solo spazi |
| `brandCollabDetails` | Stringa, massimo 600 caratteri; non vuota né solo spazi |
| `motivation` | Stringa, massimo 900 caratteri; non vuota né solo spazi |
| `brandLike` | Stringa, massimo 600 caratteri; non vuota né solo spazi |
| `contentIntegration` | Stringa, massimo 900 caratteri; non vuota né solo spazi |
| `athleteImage` | Stringa, massimo 900 caratteri; vuota ammessa |
| `valueBeyondContent` | Stringa, massimo 900 caratteri; vuota ammessa |
| `howWouldTell` | Stringa, massimo 900 caratteri; vuota ammessa |
| `scenarioBrandContent` | Stringa, massimo 900 caratteri; vuota ammessa |
| `badContentReaction` | Stringa, massimo 900 caratteri; vuota ammessa |
| `analysisElements` | Stringa, massimo 900 caratteri; vuota ammessa |
| `brandMeaning` | Stringa, massimo 900 caratteri; non vuota né solo spazi |
| `boughtProducts` | Stringa, massimo 120 caratteri; vuota ammessa |
| `improvements` | Stringa, massimo 600 caratteri; vuota ammessa |
| `extra` | Stringa, massimo 600 caratteri; vuota ammessa |
| `instagramHandle` | Stringa, massimo 200 caratteri; vuota ammessa |
| `instagramUrl` | Stringa vuota oppure URL HTTP/HTTPS, massimo 2.048 caratteri |
| `tiktokHandle` | Stringa, massimo 200 caratteri; vuota ammessa |
| `tiktokUrl` | Stringa vuota oppure URL HTTP/HTTPS, massimo 2.048 caratteri |
| `hasBrandCollabs` | Enum: `yes`, `no` |
| `buildWithoutEarnings` | Enum: `yes`, `yes_conditions`, `depends`, `paid_only` |
| `contentPerMonth` | Enum: `lt1`, `1-2`, `3-4`, `5+`, `depends` |
| `hasRoutine` | Enum: `yes`, `building`, `no` |
| `followsGuidelines` | Enum: `yes`, `mostly`, `no` |
| `availEvents` | Enum: `yes`, `no`, `maybe` |
| `availShooting` | Enum: `yes`, `no`, `maybe` |
| `availUgc` | Enum: `yes`, `no`, `maybe` |
| `availRawFiles` | Enum: `yes`, `no`, `maybe` |
| `age` | Intero 18–99 (richiede adeguamento frontend) |
| `isAdult` | Booleano `true` |
| `privacyConsent` | Booleano `true` |
| `profileCategories` | Lista 1–8 categorie ammesse, senza duplicati; `altro` richiede dettaglio |
| `followers` | Intero 0–10¹² |
| `tiktokFollowers` | Intero 0–10¹² |
| `views` | Intero 0–10¹² |
| `netFollowers` | Intero −10¹²–10¹² |
| `interactions` | Intero 0–10¹² |
| `accountsReached` | Intero 0–10¹² |
| `screenshotData` | JPEG data URL base64 non vuoto, massimo 700.000 caratteri |
| `screenshotData2` | JPEG data URL base64 o stringa vuota, massimo 700.000 caratteri |
| `profileScreenshotData` | JPEG data URL base64 o stringa vuota, massimo 700.000 caratteri |
| `ocrInsights` | `null` oppure mappa OCR con schema chiuso; dettagli sotto |
| `ocrProfile` | `null` oppure mappa OCR con schema chiuso; dettagli sotto |
| `schemaVersion` | Valore numerico `4` |
| `date` | Stringa ISO UTC nel formato `YYYY-MM-DDTHH:mm:ss.sssZ` |
| `updatedAt` | In creazione uguale a `date` |
| `status` | In creazione esattamente `new` |
| `notes` | In creazione stringa vuota |
| `creatorCode` | In creazione stringa vuota |
| `evaluation` | In creazione mappa vuota |
| `socialScore` | Intero 0–100, dichiarato dal client e non certificato |
| `perfLevel` | Enum `HIGH`, `GOOD`, `AVERAGE`, `LOW`, dichiarato dal client |
| `bandLabel` | Stringa non vuota, massimo 120 caratteri, dichiarata dal client |
| `erRate` | Numero finito 0–10¹⁴ |
| `reachRate` | Numero finito 0–10¹⁴ |
| `growthRate` | Numero finito −10¹⁴–10¹⁴ |

Controlli aggiuntivi: nome più lungo di un carattere, email con struttura valida,
dettagli obbligatori se ci sono collaborazioni o categoria `altro`, somma delle
immagini ≤900.000 caratteri. Il formato ISO non verifica la data reale o l'orologio
client; base64 e prefisso JPEG non provano il contenuto o l'autenticità dell'immagine.
Il limite totale di documento Firestore rimane comunque applicabile.

## Strutture annidate OCR

- Campo numerico OCR: sole chiavi `value`, `visibility`; valore nullo o numero
  finito entro ±10¹²; visibilità `complete`, `partial`, `not_visible`.
- Campo testo OCR: sole chiavi `value`, `visibility`, `truncated`; valore nullo o
  stringa ≤200, visibilità come sopra, `truncated` booleano.
- Screenshot Insights: `null` o sole chiavi `screenType`, `views`, `netFollowers`,
  `interactions`, `accountsReached`; tipo `insights_ok`, `dashboard_wrong`, `uncertain`.
- `ocrInsights`: `screenshot1`, `screenshot2`, `merged`, `conflicts`, `readAt`.
  `merged` contiene quattro valori numerici/nullo; `conflicts` contiene massimo
  quattro mappe con `key`, `valueA`, `valueB`, ciascuna validata.
- `ocrProfile`: `result`, `readAt`; `result` contiene `screenType`, `displayName`,
  `username`, `followers`. Tipo `profile_ok`, `wrong_screen`, `uncertain`.
- `readAt`: formato ISO UTC, dichiarato dal client.

Non si certifica l'esecuzione del Worker: OCR valido formalmente è ancora input
non attendibile. Il candidato non può modificarlo dopo la creazione.

## Ruolo viewer (Social Media Manager)

Il claim Firebase `role: viewer` concede get e list sulle candidature, senza update,
overwrite o delete. Restano negati anche gli aggiornamenti tramite merge e batch.
La lettura comprende tutto il documento, incluse informazioni interne e immagini.
La creazione di una nuova candidatura valida resta pubblica, anche per il viewer.
`manager` conserva i permessi gestionali e non è il ruolo da assegnare alla Social
Media Manager. La UI e l'emissione dei claim richiedono un adeguamento separato;
le regole non riassegnano i ruoli degli utenti già autenticati.

## Aggiornamenti staff (solo manager e admin)

Solo `status`, `notes`, `creatorCode`, `evaluation`, le quattro metriche Insights,
`insightsCorrection`, `socialScore`, `perfLevel`, `erRate`, `reachRate`, `growthRate`,
`updatedAt`. `bandLabel` è immutabile: la correzione attuale non lo aggiorna e il
numero di follower, da cui dipende la fascia, resta immutabile.

- Note ≤10.000, codice ≤120; stringhe, non mappe o liste.
- Stato appartenente agli otto stati attuali.
- Valutazione: soli sei criteri interi 0–5 e `updatedAt` ISO obbligatorio.
- Correzione: `correctedAt` ISO, `correctedBy` uguale a `staff`, `previousValues`,
  `newValues`, `note` ≤2.000. Entrambe le mappe metriche hanno schema chiuso;
  `newValues` coincide con le metriche del documento risultante.
- I valori precedenti, l'autore `staff` e le date non costituiscono un audit personale.
- Non si richiede che cambi `updatedAt`: due operazioni possono avere lo stesso
  millisecondo. Il campo deve esistere e avere formato valido nel risultato.
- I campi immutati di documenti legacy non vengono rivalidati come nuove candidature.

## Scoring

Solo chiavi `version`, `weights`, `levels`, `bands`; versione 2.

- Pesi: sole chiavi `er`, `reach`, `growth`, numeri 0–100, somma positiva.
- Livelli: quattro mappe chiuse con `v`, `l`, `min`, `c`. Identificativi in ordine
  `HIGH`, `GOOD`, `AVERAGE`, `LOW`; soglie intere 0–100 strettamente decrescenti,
  ultima 0; etichetta ≤120 non vuota, colore esadecimale `#RRGGBB`.
- Fasce: cinque mappe chiuse con `label`, `max`, `er`, `reach`, `growth`;
  etichetta ≤120 non vuota; primi quattro massimi interi positivi crescenti,
  ultimo `null` (rappresenta l'assenza di limite).
- Ogni benchmark: sole chiavi `avg`, `good`, `excellent`, numeri positivi
  strettamente crescenti, massimo 10¹⁴.

Il documento è leggibile per ID esatto da chiunque. Nessun secret o dato privato
può essere aggiunto a questa risorsa pubblica. La scrittura è riservata all'admin.
