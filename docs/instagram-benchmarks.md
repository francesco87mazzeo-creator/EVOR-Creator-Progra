# Configurazione Scoring — benchmark Instagram

Branch correttivo: `fix/benchmark-persistence-curves`, base `main` b01906e (PR #9 integrata).
Questa configurazione non viene utilizzata dal calcolo dei punteggi. Nessuna conversione
benchmark → score è implementata. `settings/scoring`, formule, pesi, OCR e candidature restano invariati.

## Pagina

Admin → Configurazione Scoring: Engagement / Reach / Growth, grafico e tabella della stessa
bozza, controlli collegati o singoli. Le impostazioni numeriche precedenti e i livelli/colori
sono preservati nella stessa pagina, in sezioni espandibili. Il precedente pulsante
«Livelli e colori» è un collegamento alla pagina unificata.
Nessun esempio creator o punteggio individuale è presente nella pagina benchmark.
La navigazione generale rimane quella dell'Admin esistente: non viene aggiunta una sidebar fittizia.

I valori Engagement sono sperimentali, non benchmark scientificamente validati.
Reach e Growth recuperano i riferimenti storici provvisori della specifica.

## Configurazione e interpolazione

Documento separato `settings/instagramBenchmarks`:

```js
{
  version: 1,
  interpolation: 'log-pchip-ordered-v2',
  storageFormat: 'named-thresholds-v1',
  followers: [1000, 5000, 20000, 100000, 500000],
  engagement: [
    {medium:10,good:20,excellent:40}, {medium:8,good:16,excellent:32},
    {medium:6,good:12,excellent:24}, {medium:5,good:10,excellent:20},
    {medium:4,good:8,excellent:16}
  ],
  reach: [
    {medium:60,good:120,excellent:250}, {medium:40,good:80,excellent:160},
    {medium:30,good:60,excellent:120}, {medium:20,good:40,excellent:80},
    {medium:15,good:30,excellent:60}
  ],
  growth: [
    {medium:1,good:3,excellent:7}, {medium:0.5,good:1.5,excellent:4},
    {medium:0.3,good:1,excellent:3}, {medium:0.15,good:0.5,excellent:1.5},
    {medium:0.08,good:0.25,excellent:0.8}
  ]
}
```

Il browser e il contratto JSON HTTP usano matrici di tre numeri per riga; il
Worker applica `toDocument` prima di salvare e l'Admin applica `fromDocument`
in lettura. Le conversioni condivise sono rigorose e senza perdita di valori.
Il documento usa array di mappe perché Firestore non supporta array annidati:
il precedente formato locale è stato corretto prima di qualsiasi pubblicazione
in produzione. Nessuna migrazione o scrittura di dati reali è stata eseguita.

Le righe corrispondono alle cinque fasce storiche; i nodi usano gli estremi superiori
1K / 5K / 20K / 100K e il riferimento 500K dell'immagine per la fascia aperta.
Questa scelta rende esplicito il riferimento della quinta fascia, non presente come
estremo finito nella vecchia tabella. Non cambia le fasce del calcolo attualmente attivo.

Metodo attuale: `log-pchip-ordered-v2`. Tangenti PCHIP sulla scala ln(follower),
con vincoli aggiuntivi ai controlli cubici per garantire monotonia locale e ordine
tra Medio/Buono/Eccellente. I nodi interni non hanno più tangenti forzatamente nulle.
I controlli Bézier di ogni curva rimangono ordinati nel proprio intervallo;
i controlli delle differenze tra curve sono non negativi. Per la proprietà di
inviluppo convesso dei polinomi di Bernstein questo impedisce overshoot e incroci.
La tangente di ogni nodo è condivisa dai segmenti adiacenti: continuità C1 interna.
Estremi costanti sotto1K e sopra500K; gli estremi esterni sono punti di transizione
alla coda costante, non un'estensione cubica fuori dal dominio.

La funzione condivisa `thresholds` genera sia le soglie sia i321 campioni del
tracciato SVG. Non è una spline decorativa diversa dal modello. Le righe
non monotone configurate volutamente possono avere massimi/minimi reali, senza
oscillazioni aggiunte. Follower mancanti/invalidi restituiscono null.

Compatibilità: `log-smoothstep-v1` rimane leggibile e calcolabile con la formula
storica w=t²(3−2t), t=ln(f/a)/ln(b/a). L'editor propone il nuovo metodo solo nella
bozza, mantenendo esattamente tutti i valori personalizzati; nessuna migrazione
automatica. Il metodo persistito cambia soltanto con un Salva esplicito.

Asse X visuale: i riferimenti1K/5K/20K/100K/500K occupano rispettivamente
0/24/60/80/100% della larghezza. Una trasformazione cubica monotona di ln(follower)
collega queste posizioni: nessun salto di ascissa o inversione, stessi follower.
Il tratto20K→100K scende dal25,9% al20% della larghezza, avvicinando visivamente
20K a100K. Ascisse di campioni, nodi e tacche usano la stessa funzione
`axisPosition`. La scala è dichiarata non uniforme: non cambia le soglie.

Valori finiti tra 0 e 100.000%, con Medio < Buono < Eccellente per ogni nodo.
Il limite massimo è una protezione operativa esplicita; i tassi non sono limitati a100%.
La modifica collegata somma lo stesso delta ai tre valori di una sola fascia.
Gli incrementi indicano punti percentuali (pp), non variazioni percentuali relative.
Nessun riordino/clamp silenzioso. Un tentativo fuori ordine viene rifiutato.

## Persistenza e sicurezza

- Lettura esatta dal server (`get({source:"server"})`) con Firebase dello staff; nessuna lista settings e nessuna conferma dalla sola cache.
- Documento assente: valori predefiniti, senza scritture automatiche.
- Lettura fallita o documento non valido: errore e riprova, nessun fallback scrivibile.
- POST `/admin/benchmarks`, stesso ID token Firebase, ruolo admin e provider custom,
  scadenza sessione e limiter amministrativo dei percorsi esistenti.
- Worker valida lo schema condiviso e sostituisce soltanto il documento fisso.
- Rules candidate: get per admin/manager/viewer, nessuna scrittura client.
- Ripristino modifica soltanto la bozza. Salva esplicito crea/sostituisce il documento; la conferma arriva solo dopo una nuova lettura server e confronto canonico esatto.
- Lettura post-save fallita, documento assente o diverso: nessuna conferma di successo, bozza conservata, nessuna riscrittura automatica. Concorrenza: il confronto può rilevare modifiche di un altro admin, non è un lock transazionale.
- Manager/viewer non possono salvare. Nessun nuovo secret o binding richiesto.
- Come gli altri editor attuali, ultimo salvataggio prevale; altri tab devono ricaricare.
  Il cambio pagina scarta la bozza non salvata. Nessuna migrazione candidature.

## Verifica locale

Dalla radice:

```sh
node --test server/collective/test/benchmarks.test.mjs worker/test/admin-scoring.test.mjs
node tools/asset-versions.mjs
EVORA_BROWSER_ASSETS=/percorso/assets EVORA_CHROMIUM=/percorso/chromium node --test --test-concurrency=1 test/frontend/browser.test.mjs
cd security/firestore
npm ci --ignore-scripts --no-audit --no-fund
EVORA_RULES_PROFILE=migration npm test
```

Il browser usa esclusivamente Firebase/Worker simulati e DNS bloccato: nessun invio reale.
Sono aggiunti test ufficiali Rules per get e divieto create/update/delete sui sei ruoli,
e un test REST Worker → Emulator di creazione, rilettura, sostituzione e isolamento
di scoring/candidature. Il workflow esistente esegue anche questo file in CI.
L'Emulator non è disponibile nella cache di questo ambiente e il dominio del download
è bloccato: verifica locale Rules NON completata. Eseguire il job CI firestore-rules
(o i comandi sopra su un ambiente abilitato) prima di pubblicare.

## Pubblicazione futura, solo dopo approvazione

1. Revisione, CI completa inclusi test Emulator; verificare nodo finale500K e default sperimentali.
2. Backup/versione attiva Rules e Worker. Pubblicare esclusivamente le Rules candidate approvate.
3. Pubblicare Worker con nuovo endpoint mantenendo variabili/secret; nessun cambio scoring.
4. Pubblicare frontend solo dopo endpoint e permessi lettura disponibili. I vecchi frontend
   continuano a funzionare con il nuovo Worker; il nuovo frontend con vecchio Worker non salva benchmark.
5. Controlli routing/CORS senza scritture; eventuale primo Salva benchmark richiede autorizzazione.
6. Rollback ordinario frontend, conservando Worker/Rules compatibili con pagine già aperte.
   Il documento è separato e può rimanere: nessun ricalcolo o ripristino candidature necessario.

Commit e push del solo branch di sviluppo autorizzati per revisione. Nessun merge,
deploy o accesso a dati Firebase reali eseguito per questa implementazione.

## File interessati

- `app/admin.jsx`, `admin/index.html`: pagina unificata e versioni asset.
- `public/score-levels.js`: API benchmark pura condivisa, API livelli preservata.
- `public/admin-scoring-client.js`: trasporto autenticato aggiuntivo.
- `worker/src/worker.js`: endpoint a destinazione fissa.
- `security/firestore/migration/firestore.rules`: solo permessi del nuovo documento.
- `security/firestore/migration/rules.test.mjs`: matrice permessi benchmark.
- `server/collective/test/benchmarks.test.mjs`: curve, editing e schema.
- `test/frontend/browser.test.mjs`, `test/frontend/score-levels-transport.test.mjs`: browser/trasporto.
- `worker/test/admin-scoring.test.mjs`, `worker/test/common.test.mjs`: persistenza simulata, autorizzazioni e CORS.
- `worker/test/emulator-scoring.mjs`: persistenza REST su Emulator demo.
- `.github/workflows/tests.yml`, `.github/workflows/repository-hygiene.yml`: esecuzione anche sul push del branch di sviluppo.
- `docs/instagram-benchmarks.md`: contratto, limiti e istruzioni.

## Diagnosi della segnalazione e scala Y

Verificato nel codice precedente: il salvataggio terminava sul2xx del Worker,
senza rilettura del documento; la lettura iniziale usava la politica cache
predefinita dell'SDK. Il Worker eseguiva comunque un PATCH REST sul documento
esatto, con errori di scrittura trasformati in503: non è dimostrata una perdita
Firebase in produzione, a cui questo ambiente non ha accesso autenticato.

Riprodotto matematicamente: Ymax=max(nodi)*1,12. Un massimo40 e uno400 si
disegnavano entrambi alla stessa y=67,857 nel viewBox300−260*v/Ymax. La scala
mobile può quindi mascherare una variazione di dieci volte, anche con dati corretti.

Ora la scala Y è fissa durante editing, salvataggio, riapertura e reload.
Default: Engagement50%, Reach300%, Growth10%. Campo «Massimo asse Y» e pulsante
«Adatta scala ai valori» modificano solo la vista, mai il documento. Preferenze
numeriche in localStorage `evora-benchmark-axis-v2`, senza dati personali; se lo
storage è indisponibile la preferenza dura soltanto nella pagina corrente.
I valori fuori scala sono segnalati numericamente e il disegno è ritagliato,
mai i dati: tabella/input/persistenza conservano i valori integrali. I numeri
configurati sono visualizzati con precisione sufficiente a non nascondere valori
molto piccoli o scarti decimali. Eliminati tutti i pulsanti rapidi±pp.

## Verifiche del branch correttivo

- Test unitari: tutti i nodi, tangenti C1 non nulle dove appropriate, assenza di
  overshoot/incroci su100 configurazioni asimmetriche/non monotone deterministiche,
  compatibilità old/new senza perdita di valori, mappa X monotona e corrispondenza SVG.
- Browser: salvataggio e rilettura obbligatoria server, lettura fallita/assente/diversa,
  estremi900/906/918, scala Y stabile, riapertura, reload, tabella e grafico identici,
  migrazione in sola bozza e nessuna modifica alle altre metriche, rimozione pulsanti.
- Test ufficiale REST Emulator aggiuntivo per migrazione esplicita del metodo e
  accettazione dei payload precedenti, senza toccare settings/scoring.
- CI eseguita anche sul push di questo branch, progetto demo e credenziali sintetiche;
  nessun deploy nei workflow. Emulator locale non in cache: modalità offline, nessun download.
- Nessuna Rules modificata; permessi e formato Firestore `named-thresholds-v1` invariati.

## Ordine di pubblicazione della correzione (non eseguito)

1. Revisione PR e CI completa.
2. Pubblicare Worker con il nuovo modulo condiviso: accetta entrambi i metodi.
   Non basta il solo frontend: il Worker attualmente pubblicato rifiuterebbe il nuovo identificativo.
3. Pubblicare frontend correttivo. Nessuna nuova Rules o modifica di configurazione
   Firebase è necessaria per questa correzione.
4. L'apertura non scrive nulla: verificare valori esistenti e avviso del nuovo metodo
   proposto nella bozza. Solo un Salva volontario adotta il nuovo identificativo.
5. Un rollback a un frontend che supporta solo v1 non può leggere un documento v2:
   mantenere la versione correttiva compatibile o preparare un rollback compatibile,
   senza ripristinare automaticamente il documento e senza toccare i valori personalizzati.

Il core Social Score, i pesi, OCR e le candidature rimangono invariati.
