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

**Non usare un `git revert` completo come primo passo.** Eliminerebbe `app/` e `admin/`: per circa 10 minuti i browser che hanno in cache la nuova `index.html` continuerebbero a richiedere quei file e riceverebbero una pagina vuota.

1. **Ripristinare solo la pagina unica:** con una PR, riportare `index.html` alla versione del commit `2150f63`, cioè la fase 0: pagina unica con librerie a versione fissata e SRI.

   ```sh
   git checkout 2150f63 -- index.html
   ```

   Si lasciano **invariati** `app/` e `admin/`: `admin/` resta raggiungibile e funzionante, e `/#admin` torna a essere gestito dalla pagina unica.
2. **Verificare:**
   - la build di Pages è completata (`gh api repos/<owner>/<repo>/pages/builds/latest`);
   - dopo almeno 10 minuti, il modulo pubblico funziona in una finestra privata e da telefono.
3. **Pulizia, dopo almeno un giorno:** rimuovere `app/` e `admin/` con una PR separata, quando nessuna pagina in cache può più richiederli.

Anche il ripristino non è atomico: nella stessa finestra di circa 10 minuti alcuni browser vedranno ancora la versione separata, che resta funzionante perché i suoi file non sono stati rimossi.

**Worker e Rules:** non sono cambiati in queste fasi e non vanno ripristinati.
