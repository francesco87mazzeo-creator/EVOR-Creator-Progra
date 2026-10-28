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
- per questo una configurazione non valida o un modulo rotto non producono mai una pagina a metà.

## Regole per le modifiche

- **Codice staff:** va solo in `app/admin.jsx` (o in nuovi moduli caricati solo da `admin/`). `separation.test.mjs` impedisce che `shared` e `public-form` chiamino codice staff.
- **Versione dei moduli:** a ogni pubblicazione che cambia `app/` va aggiornato il valore `?v=` in **entrambe** le pagine, così il browser non mescola file vecchi e nuovi dalla cache. Un test verifica che le due pagine usino lo stesso valore.
- **Librerie:** React, ReactDOM e Babel sono a versione esatta con `integrity`. Per aggiornarle:
  1. cambiare insieme versione e hash in entrambe le pagine e nel test browser;
  2. verificare l'hash sul file servito da unpkg.

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

**Frontend:** `git revert` del merge; GitHub Pages ripubblica il sito in pochi minuti.
- `index.html` torna la pagina unica;
- i file `app/` e `admin/` rimasti non vengono più caricati.

**Worker e Rules:** non sono cambiati in queste fasi.
