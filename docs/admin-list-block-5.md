# Elenco candidature — Blocco 5

Base: main e5e12de, successivo al merge del Blocco 4.

## Interfaccia

La riga mantiene il pulsante unico, utilizzabile con mouse e tastiera. Identità, username e stato sono raggruppati a sinistra, i tassi Engagement/Reach/Growth e i follower al centro, Score V2 all'estrema destra. La data non è più renderizzata nella riga, ma resta nel dettaglio, nell'esportazione, nei filtri e nei dati esistenti.

Lo score usa lo stesso `CandidateScoreRing` della scheda candidato, con dimensione 64 px (60 px su smartphone). Il CSS base degli anelli è estratto in `CANDIDATE_RING_STYLE`, condiviso da elenco e dettaglio. La variante compatta cambia solo dimensioni e tipografia. Il colore deriva da `settings/scoreLevels`, con il comportamento neutro preesistente quando la classificazione non è disponibile. I colori dei tassi benchmark non cambiano.

Il layout desktop ha sei colonne; tablet e mobile mantengono lo score a destra e distribuiscono gli altri dati su più righe. Le etichette sono complete anche sullo smartphone. Il markup del modulo pubblico non cambia: il suo riferimento hash CSS viene aggiornato perché il foglio condiviso contiene i selettori Admin modificati.

## Animazione e risorse

La variante di elenco riutilizza l'animazione del Blocco 3 (1,2 secondi) delegando l'osservazione a un singolo IntersectionObserver per ApplicationsPanel. Non vengono creati osservatori per ogni riga. I target sono rimossi alla prima entrata o allo smontaggio; l'osservatore viene disconnesso quando il pannello si smonta. La paginazione preesistente limita l'elenco a dieci righe.

Un Set locale in ApplicationsPanel ricorda gli identificativi già visualizzati. Dopo ricerca, ordinamento, paginazione o apertura/chiusura del dettaglio, il cerchio viene mostrato completo senza replay. Se la riga si smonta durante l'animazione, al ritorno mostra il valore finale. Il Set non è persistito: una nuova apertura del pannello o il ricaricamento della pagina costituisce una nuova sessione visiva.

L'aggiornamento dello score dopo la prima visualizzazione è immediato. Valori mancanti/invalidi non hanno anello di riempimento; zero è distinto da N/D. Il movimento ridotto e l'assenza di IntersectionObserver mostrano subito il risultato. Nessuna dipendenza o timer periodico aggiunto.

## Perimetro

Nessuna modifica a core scoring, formule, pesi, benchmark, livelli, Worker, Rules, autenticazione, salvataggi, schema Firestore o funzionalità del dettaglio. Filtri, ordinamento, paginazione e gestione degli stati mantengono la logica precedente.

## Verifica

Test unitario con cento target: un solo osservatore, callback una volta per target visibile, rimozione/disconnessione e fallback senza API. Test browser con servizi interamente simulati: layout 1440/768/390/320 px, colori configurati, dato assente, zero visualizzazioni, score zero, navigazione da tastiera, data nel dettaglio, scorrimento, ricerca, ordinamento, paginazione e correzione Insights. Le scritture del test di correzione sono esclusivamente su stub in memoria.

Screenshot sintetici fuori dal repository. Verificare i check CI prima dell'eventuale merge. Non servono migrazioni, pubblicazioni Rules o Worker. Nessun deploy o scrittura in produzione eseguito.

### Risultati locali

- 764 test Node/contratti/igiene superati, 2 esclusi per la modalità del frontend, nessun fallimento.
- Suite browser completa: 103 test superati, nessun fallimento, incluse le regressioni dei Blocchi 3 e 4 e del percorso pubblico.
- Hash asset e controllo diff superati. CSS effettivo della scheda candidato confrontato con la baseline: identico dopo estrazione dello stile condiviso.
- Emulator ufficiale locale NON eseguito: jar v1.22.0 non in cache; runner offline terminato con codice 2 senza download. Il workflow CI esistente copre Rules e persistenza REST su progetto demo, senza credenziali di produzione.
