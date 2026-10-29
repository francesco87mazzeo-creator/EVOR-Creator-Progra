# OCR: account distinti nel layout Instagram verificato

Preparazione locale, non pubblicata. Base: main b613e3fd2c437f78ce3a14bebc81235290585184.

## Ambito

Il founder ha verificato tramite il pannello informativo di Instagram che, nel layout
Insight / Generale descritto dai prompt, la riga riepilogativa «Visualizzazioni» sotto
«Visualizzazioni per tipo di contenuto» rappresenta account Meta distinti stimati.
Questa conferma riguarda quel layout, non qualsiasi numero sotto quel titolo.

Il totale della card superiore rimane `views`; la riga riepilogativa prima di legenda
e barre può alimentare `accountsReached` solo quando tutto il contesto è riconoscibile.
Restano supportate le etichette esplicite «Account raggiunti» e «Account che hanno visualizzato».
Non si sommano barre, non si deducono valori, non si usano percentuali o tacche del grafico.
Ambiguità, layout non identificabile o numero coperto: reach `null`. Zero reale resta zero.
Una finestra con la sola definizione non fornisce un valore; se copre i conteggi non si
riutilizzano automaticamente numeri di immagini precedenti. Le due immagini allegate
dal founder mostrano momenti differenti e non costituiscono una coppia di valori identici.

Nessuna modifica a scoring, schema OCR, obbligatorietà dei campi, Rules o Firebase.
Non vengono aggiunte chiamate OCR né aumentati max_tokens, dimensioni o timeout.
I prompt sono più lunghi: aumentano i token di ingresso (quindi potenzialmente costo e
latenza per chiamata). Il prompt Insights resta sotto il limite di 8.000 caratteri del Worker.

## Compatibilità e pubblicazione (richiede autorizzazione)

1. Eseguire test unitari/Worker e browser, controllo versioni asset e dry-run Wrangler.
2. Pubblicare PRIMA il Worker contenente gli hash dei prompt nuovi **e** i cinque hash
   legacy di ba04424. Il prompt profilo è invariato. Preservare configurazione e secret.
   I prompt precedenti sono congelati nel fixture di test `worker/test/fixtures/ocr-prompts-ba04424.json`.
   Non basta pubblicare soltanto il frontend: il Worker precedente rifiuterebbe i nuovi prompt.
3. Verificare che il Worker accetti entrambi i contratti nell'ambiente di test, poi pubblicare
   il frontend con gli identificativi asset rigenerati da `node tools/asset-versions.mjs --write`.
4. Lasciare temporaneamente gli hash legacy: non rimuoverli finché non è approvata una politica
   di scadenza delle pagine aperte/cache. Non indebolire il controllo SHA-256 accettando testo libero.

Comando Worker, solo dopo revisione e autorizzazione, dal checkout di questo aggiornamento:

```sh
npx wrangler@4.149.0 deploy --config wrangler.toml --name throbbing-feather-957f --keep-vars
```

`--keep-vars` conserva variabili non dichiarate nel TOML; i secret restano sul servizio.
Non garantisce la conservazione di ogni altra impostazione: confrontare account, route,
binding e configurazione attivi prima del deploy. Registrare Version ID e traffico al 100%.
Solo dopo il controllo Worker autorizzare il merge frontend: con Pages su main/root,
il merge attiva la pubblicazione del sito. Nessuna modifica alle Rules è necessaria.

Rollback ordinario: solo frontend, conservando il Worker con entrambi i set di prompt.
La versione Worker precedente 2259e5c1 e lo snapshot `worker/rollback/compat` basato su ba04424
NON accettano i nuovi prompt: non ripristinarli con pagine nuove ancora aperte. Un eventuale
ripristino del runtime deve conservare questa doppia allowlist e il contratto candidature V2.
Lo snapshot storico resta intenzionalmente immutato; non è il rollback di questo aggiornamento OCR.

## Cosa dimostrano i test

Verifica locale del 29 ottobre 2026: 619 test non-browser superati (igiene inclusa),
2 saltati perché specifici della modalità rollback; 58 test Chromium superati, nessun
fallimento. Controllo asset e dry-run Wrangler 4.149.0 superati. In copie temporanee,
rimuovere il riferimento al layout fa fallire il test del prompt; rimuovere gli hash
legacy fa fallire tutti e cinque i test di compatibilità. Nessuna chiamata OCR reale.

- Prompt attuali: istruzioni di layout, esclusioni e distinzione cifra/metrica presenti; budget invariato.
- Parser/merge: 1.206 / -1 / 54 / 250 distinti, null/zero/parziale, seconda immagine e conflitti.
- Browser isolato: una risposta OCR simulata precompila e invia quei quattro valori separati;
  i test esistenti coprono reach mancante facoltativa e secondo screenshot.
- Worker: prompt attuali e vecchi realmente accettati con Anthropic simulato; testi arbitrari rifiutati.

Questi test NON dimostrano che il modello visivo legga davvero 250 dall'immagine: le risposte
Anthropic sono simulate. Prima della pubblicazione serve una valutazione controllata, con
servizi/dati di test e autorizzazione al consumo API, su un insieme di screenshot anonimizzati:

| Caso visivo | Atteso |
|---|---|
| Layout verificato originale | views 1206, netFollowers -1, interactions 54, reach 250 |
| Stesso layout con numeri diversi, tema chiaro/scuro | Valori effettivi, nessun numero fisso |
| Etichette esplicite vecchie e nuove | Reach associata alla propria etichetta |
| Solo barre/legenda o ritaglio senza contesto | Reach null |
| Pannello informativo aperto senza conteggio associato | Reach null |
| Numero coperto/ambiguo e zero realmente leggibile | Null/parziale secondo il caso; zero conservato |
| Due screenshot con valori completi discordanti | Conflitto da verificare, mai somma |

Non usare le candidature per collaudare l'OCR: nessun invio, scoring o notifica è necessario.
Non caricare immagini personali nei test automatici. La verifica visiva reale non è stata
eseguita da Codex e non va sostituita con i risultati dei test simulati.
