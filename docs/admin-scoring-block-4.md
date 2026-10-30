# Configurazione Scoring — Blocco 4

Restyling limitato alla pagina Configurazione Scoring, basato su main 91cbbbc.

## Anteprima

La pagina non dispone di un candidato selezionato: l'anteprima è esplicitamente dimostrativa e parte senza dati. I cinque campi locali non vengono persistiti, inviati al Worker o associati a candidature. Numeri mancanti, non interi, negativi (salvo follower netti) o fuori dall'intervallo degli interi sicuri restano indisponibili.

Si riutilizzano `computeWithConfig`, le classificazioni salvate e `CandidateScoreRing` del Blocco 3. Il punteggio usa esclusivamente i parametri salvati: le bozze degli editor non modificano l'anteprima fino al rispettivo salvataggio. Non sono introdotte formule di scoring.

- Engagement: score normalizzato e tasso interazioni/visualizzazioni.
- Visibilità: score normalizzato sul volume delle visualizzazioni. Reach/follower è mostrato separatamente come percentuale informativa.
- Growth: percentuale follower netti/follower iniziali solo se il denominatore è positivo, assumendo lo stesso periodo di osservazione. Non è un punteggio, non ha classificazione, anello progressivo o peso.
- Score V2: media pesata esistente. Dati mancanti e zero visualizzazioni non producono un punteggio inventato.

L'animazione riutilizza IntersectionObserver/RAF da 1,2 secondi, senza ripetizioni allo scroll, con aggiornamento immediato dopo il primo avvio e rispetto del movimento ridotto. I colori dei punteggi provengono dalle configurazioni lette; in caso di classificazioni indisponibili si usa il neutro già esistente.

## Editor

Benchmark, parametri numerici e livelli mantengono componenti, controlli, validazioni, ripristini e salvataggi separati. Non sono unificati in una singola transazione. I ripristini modificano soltanto la rispettiva bozza come prima. I benchmark non entrano nello Score V2.

Stili confinati alla pagina; nessuna modifica alla scheda candidato, al modulo pubblico, ai livelli, ai valori predefiniti, al Worker, alle Rules o allo schema dei dati. L'hash di `app/admin.jsx` nella pagina Admin viene aggiornato con lo strumento esistente.

## Pubblicazione

Solo frontend dopo revisione e merge autorizzato. Non occorrono migrazioni, modifiche Rules o deploy Worker. Verificare i quattro check CI prima del merge e il caricamento della pagina Admin dopo l'eventuale pubblicazione. Nessun salvataggio in produzione è stato effettuato durante lo sviluppo.

## Verifica locale

- 762 test Node/contratti/igiene superati, 2 esclusi per la modalità del frontend; nessun fallimento.
- Suite browser completa: 95 superati. Altri due casi finali (viewport 320 px e aggiornamento dopo salvataggio/animazione senza riavvio) superati separatamente: 97 casi distinti verificati, tutti inclusi nel prossimo run CI.
- Screenshot con dati e colori sintetici acquisiti a 1440, 768 e 390 px, conservati fuori dal repository.
- Hash asset e diff check superati; controlli euristici sulle credenziali senza corrispondenze.
- Emulator ufficiale locale NON eseguito: jar v1.22.0 non presente in cache, runner offline terminato con codice 2 senza tentare download. Il workflow GitHub resta necessario per verificare Rules e persistenza REST. Nessuna modifica ai relativi file funzionali.
