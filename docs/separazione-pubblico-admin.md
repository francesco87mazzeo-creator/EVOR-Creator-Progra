# Separazione tra pagina pubblica e area staff (fasi 0 e 1)

La raccolta candidature non carica più il codice dell'area staff: un errore nell'Admin non può bloccare il modulo pubblico.
Il dominio, GitHub Pages, il Worker, Firebase e le Rules sono quelli di prima.

## Struttura

| File | Contenuto | Caricato da |
|---|---|---|
| `index.html` | Pagina pubblica: nessun SDK Firebase; `/#admin` porta ad `admin/` | — |
| `admin/index.html` | Area staff (`noindex`): Firebase, accesso, pannelli | — |
| `app/styles.css` | Stili comuni | entrambe le pagine |
| `app/shared.jsx` | Configurazione, utilità, componenti comuni | entrambe le pagine |
| `app/public-form.jsx` | Landing, verifica Instagram, modulo, OCR | entrambe le pagine (lo staff lo usa per «Simula candidatura») |
| `app/admin.jsx` | Firestore, accesso, Telegram, scoring, pannelli | solo `admin/` |
| `app/public-main.jsx`, `app/admin-main.jsx` | Router delle due pagine | una pagina ciascuno |

**Origine del codice:** è stato spostato da `index.html` senza modifiche, con controllo automatico che nessuna riga fosse persa o duplicata. Gli unici file nuovi sono i due router e le pagine HTML.

**Tutto o niente:**
- ogni modulo si registra nell'ultima riga (`CollectiveModules.add(...)`), quindi un modulo interrotto da un errore non si registra;
- il router disegna l'interfaccia solo se tutti i moduli richiesti sono stati eseguiti fino in fondo;
- per questo una configurazione non valida o un modulo che va in errore durante il caricamento non producono una pagina a metà.

Questo controllo riguarda gli errori di esecuzione. Non impedisce che il browser combini versioni diverse di moduli che si caricano senza errori (vedi «Cache e pubblicazione»).

## Regole per le modifiche

- **Codice staff:** va solo in `app/admin.jsx` (o in nuovi moduli caricati solo da `admin/`). `separation.test.mjs` impedisce che `shared` e `public-form` chiamino codice staff.
- **Versione dei moduli:** ogni riferimento a un file `app/` porta `?v=` seguito dai primi 16 caratteri dello SHA-256 del file.
  - **Aggiornamento:** dopo ogni modifica di `app/` si esegue `node tools/asset-versions.mjs --write`, che aggiorna entrambe le pagine.
  - **Controllo:** `separation.test.mjs` (e quindi il workflow `Tests`) fallisce se un file è cambiato senza aggiornare il suo identificativo, o se un file `app/` è referenziato senza versione.
  - **Effetto:** un file modificato cambia sempre indirizzo; un file invariato mantiene il suo.
- **Librerie:** React, ReactDOM e Babel sono a versione esatta con `integrity`. Per aggiornarle:
  1. cambiare insieme versione e hash in entrambe le pagine e nel test browser;
  2. verificare l'hash sul file servito da unpkg.

## Cache e pubblicazione

**Cosa è stato osservato il 2026-10-28:**
- GitHub Pages risponde con `Cache-Control: max-age=600` (10 minuti) e passa da una cache intermedia (Varnish);
- le ultime build di Pages sono durate tra 34 e 47 secondi.

Sono osservazioni, non garanzie del servizio.

**Cosa non è garantito: un aggiornamento atomico.**
- **Pagina vecchia:** per circa 10 minuti dopo una pubblicazione, un browser può usare la pagina vecchia dalla propria cache.
- **Moduli richiesti dalla pagina vecchia:** Pages ignora `?v=` e serve sempre il file attuale. Se il browser non ha quei moduli in cache, li richiede e riceve già la versione nuova.
- **Distribuzione non simultanea:** la cache intermedia può non aggiornarsi nello stesso istante per tutti i file.
- **Conseguenza:** in quella finestra un browser può combinare una pagina e dei moduli di pubblicazioni diverse.

Gli identificativi `?v=` riducono il problema, perché una pagina nuova non usa versioni vecchie dalla cache del browser, ma non lo eliminano.

**Regole pratiche:**
- **Compatibilità tra pubblicazioni consecutive:** ogni pubblicazione deve restare compatibile con la precedente, così che pagina e moduli di due pubblicazioni consecutive funzionino insieme. In particolare non rinominare né rimuovere funzioni condivise nella stessa pubblicazione in cui cambia chi le usa.
- **Dopo la pubblicazione:** attendere almeno 10 minuti prima di giudicare il risultato, e verificare con una ricarica completa o una finestra privata.
- **Garanzia completa (non implementata):** richiederebbe cartelle con nome di rilascio (per esempio `app/<rilascio>/`), mantenute per qualche giorno dopo la pubblicazione successiva.

## Test

Il workflow `Tests` esegue tutte le suite su ogni pull request (vedi `docs/frontend-staging-tests.md`).

**Test browser dedicati:**
- la pagina pubblica non carica Firebase né codice staff;
- con `app/admin.jsx` rotto la candidatura arriva comunque al Worker;
- `/#admin` apre `admin/`;
- una configurazione non valida blocca entrambe le pagine.

**Controprova:** con un hash `integrity` sbagliato o senza il controllo dei moduli, i test falliscono.

## Da attivare su GitHub (azione del proprietario del repository)

1. **Branch protection su `main`:** merge solo tramite pull request, con i controlli `Tests` e `Repository hygiene` superati.
2. **Facoltativo:** pubblicazione di Pages tramite GitHub Actions dopo i test.

Finché la protezione non è attiva, i test non impediscono un merge.

## Ripristino

**Cosa si ripristina:** la pagina unica di prima della separazione, ricostruita con il codice **attuale** dei moduli `app/`. Torna indietro solo il modo in cui le pagine vengono caricate, non il codice. Per questo:
- i test continuano a valere e i controlli obbligatori di GitHub passano;
- un problema in una funzione si corregge con una PR normale, non con questo ripristino.

**Non riportare `index.html` a un commit precedente** (per esempio `2150f63`) e **non fare un `git revert` completo**:
- il primo lascerebbe moduli `app/` e test di versioni diverse dalla pagina, e i controlli fallirebbero;
- il secondo eliminerebbe `app/` e `admin/`, ancora richiesti per circa 10 minuti dalle pagine in cache.

### Procedura (PR normale, compatibile con i controlli obbligatori)

1. **Branch dal `main` aggiornato:**

   ```sh
   git switch -c rollback/single-page origin/main
   ```

2. **Ripristino:**

   ```sh
   node tools/frontend-mode.mjs single-page
   ```

   Lo strumento scrive:
   - `index.html`: pagina unica con gli stessi script (versioni e `integrity`), stili e moduli in un solo script Babel. Il pubblico è su `/`, l'area staff su `/#admin`.
   - `admin/index.html`: reindirizzamento a `../#admin`, così gli accessi diretti e i segnalibri di `/admin/` portano all'area staff della pagina unica;
   - `frontend-mode.json`: `{"mode": "single-page"}`.

   `app/` **non va toccata**: le pagine separate ancora in cache la richiedono.
3. **Controlli in locale (facoltativi, gli stessi della CI):**

   ```sh
   node tools/frontend-mode.mjs
   ```

   Deve rispondere «pagine allineate ai moduli app/». Poi le suite elencate in `docs/frontend-staging-tests.md`.

   **Come si comportano i test nella pagina unica:**
   - i test che riguardano solo la separazione risultano **saltati con il motivo** (`frontend-mode.json = single-page`);
   - al loro posto valgono quelli della pagina unica: pagine identiche a quelle generate, `admin/` che rimanda a `/#admin`, `app/` ancora presente;
   - tutti gli altri restano invariati.
4. **Commit, push e PR verso `main`:** i controlli `unit`, `browser`, `firestore-rules` e `hygiene` devono essere verdi. Poi merge.
5. **Verifiche dopo il merge:**
   - la build di Pages è completata (`gh api repos/<owner>/<repo>/pages/builds/latest`);
   - dopo almeno 10 minuti, in una finestra privata e da telefono: `/` mostra il modulo, `/#admin` e `/admin/` l'area staff.

**Durante il ripristino:**
- **Modifiche ai moduli `app/`:** dopo ogni modifica si riesegue `node tools/frontend-mode.mjs single-page` per rigenerare la pagina; un test lo impone.
- **Ritorno alla separazione:** si fa il `git revert` del commit di ripristino (una PR normale), che riporta pagine e `frontend-mode.json` alla separazione.

**Il ripristino non è atomico:** per circa 10 minuti alcuni browser useranno ancora le pagine separate in cache. Restano funzionanti perché `app/` non viene rimossa.

**Verifica continua:** il test browser «Single-page rollback» genera e prova la pagina unica, con candidatura, `/#admin` e `/admin/`, su ogni pull request anche in modalità separata. Così il ripristino resta eseguibile prima ancora di servire.

**Worker e Rules:** non sono cambiati in queste fasi e non vanno ripristinati.
