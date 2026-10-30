# Blocco 3 — Scheda candidato

Base: main008c80d (elenco compatto del Blocco2). Branch: design/admin-candidate-block-3.
Restyling esclusivamente Admin; nessuna modifica di backend o dati.

## Interfaccia

- Desktop: tre schede verticali Coinvolgimento, Visibilità e Indicatore B a sinistra;
  Score V2 a destra con un anello244px, rispetto ai100px delle componenti.
- Tablet/smartphone: colonna singola, cerchi200/80px sullo schermo stretto;
  verifiche anche a320px. Intestazione, card, risposte e separatori rimodernati
  con CSS circoscritto a `.candidate-detail`, caricato soltanto nel modulo Admin.
- Valori numerici da computeScore già esistente. Pesi visualizzati dalla
  configurazione attuale e normalizzati come prima; nessun peso o formula nuovo.
- Colore e classificazione da CollectiveScoreLevels.classify con gruppi metrics
  e social. Nessun livello hardcoded. Se i livelli non sono disponibili, colore
  neutro e classificazione esplicitamente non disponibile, senza inventare soglie.
- Indicatore B: rapporto reale in percentuale, anche oltre100%, con anello
  decorativo neutro senza riempimento percentuale. Nessuna classificazione o /100.
- Avvisi dati mancanti/zero visualizzazioni/base ridotta e punteggi storici
  conservati. Numero reale0 distinto da null, NaN, stringhe o valori fuori scala.

## Animazione e accessibilità

CandidateScoreRing è locale ad app/admin.jsx: ScoreRing condiviso e modulo pubblico
non sono modificati. Un IntersectionObserver per anello valido attende la prima
intersezione (15%), poi si disconnette. requestAnimationFrame completa il
riempimento in1200ms con curva ease-out; nessun timer o loop permanente.
Il risultato rimane al valore reale e non riparte con lo scroll. La semantica
«prima volta» è per istanza montata: aprire una nuova scheda candidato crea una
nuova istanza, mentre scorrere all'interno della scheda non la ricrea.

Aggiornamenti dei dati dopo l'avvio mostrano subito il nuovo risultato senza
riprodurre l'introduzione. Un dato invalido non anima e non viene convertito in0.
Zero valido è immediato, senza frame inutili. prefers-reduced-motion (anche se
attivato durante l'animazione) e assenza di IntersectionObserver mostrano il
risultato senza animazione. Cleanup cancella frame e observer all'unmount.

role=img ha un nome accessibile con valore finale e classificazione reali; il
numero che scorre è aria-hidden, senza annunci a ogni frame. Numeri bianchi e
centro scuro; bagliore derivato dal colore configurato senza modificarlo. Colori
personalizzati estremamente scuri possono ridurre la visibilità dell'anello,
ma il valore numerico rimane leggibile e accessibile.

## Funzionalità preservate

Risposte, contenuti, dati Instagram, immagini, note, stato, codice creator,
valutazione, correzione Insights e storico restano nelle stesse sezioni.
Handler di salvataggio e permessi invariati: il manager conserva le funzioni
precedenti e non vede Elimina; l'admin mantiene l'eliminazione con conferma.
Le nuove componenti non contengono accessi Firestore, fetch, formule o scritture.

Nessun nuovo campo/documento, migrazione, endpoint, Rules o dipendenza.
Nessuna modifica di settings/scoring, settings/scoreLevels o benchmark.

## Verifica

- Unit: tipi, limiti0/100, null, non finiti, stringhe, classificazioni configurate,
  assenza di scritture/rete/formule nelle componenti di presentazione.
- Browser con rete interamente intercettata: entrata in viewport, un solo avvio,
  scroll, aggiornamento dopo/durante il riempimento, null/zero, reduced motion,
  fallback senza observer, colori personalizzati e B superiore100%.
- Layout1440/768/390/320px; risposte/link preservati; salvataggio note, codice e
  valutazione, permessi manager, correzione Insights e storico nei test esistenti.
- Asset SHA e igiene repository. Job ufficiale Firebase Emulator invariato,
  attivato anche sul push di questo branch: Rules/REST sul progetto demo.
  Emulator locale non disponibile in cache; nessun download nell'ambiente bloccato.

Comandi dalla radice:

```sh
node --test test/frontend/candidate-detail.test.mjs
node tools/asset-versions.mjs
EVORA_BROWSER_ASSETS=/percorso/assets EVORA_CHROMIUM=/percorso/chromium node --test --test-concurrency=1 test/frontend/browser.test.mjs
```

Screenshot opzionali (solo dati sintetici e colori di test): aggiungere
EVORA_SCREENSHOT_DIR con una cartella esistente al comando browser e selezionare
il test `Candidate detail shows`. Nessun collegamento a dati reali.

Prima della pubblicazione: revisione PR e CI completa. Questa modifica richiede
soltanto il frontend; nessun deploy Worker o Firestore. Il merge su main resta
soggetto ad approvazione, perché GitHub Pages pubblica dal ramo principale.
