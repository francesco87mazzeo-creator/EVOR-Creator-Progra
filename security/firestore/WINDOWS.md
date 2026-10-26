# Test Firebase Emulator su Windows — guida PowerShell

Questa procedura esegue i test soltanto sul computer locale. Non richiede login
Firebase, credenziali, un progetto reale, merge o deploy. Non avvia il sito e non
chiama il Worker. Il progetto dei test è `demo-evora-security`.

## 1. Controlla Node.js e Java

Apri **PowerShell** dal menu Start ed esegui:

```powershell
node --version
npm.cmd --version
java -version
```

Servono **Node.js 24.x**, npm e **Java 21**. Esempi di versioni attese:
`v24.19.0` e `openjdk version "21..."`. La revisione patch può essere diversa.
Se un comando non viene riconosciuto oppure una major è diversa, risolvi il
requisito prima di continuare.

Se mancano entrambi i runtime, puoi installarli con Windows Package Manager:

```powershell
winget install --exact --id OpenJS.NodeJS.LTS
winget install --exact --id EclipseAdoptium.Temurin.21.JDK
```

Installa soltanto quello mancante. Verifica che il pacchetto Node LTS offerto sia
24.x; se è di un'altra major, scegli Node 24 LTS dal sito ufficiale
https://nodejs.org/en/download. Java 21 è disponibile anche dal sito ufficiale
https://adoptium.net/temurin/releases/?version=21.

Dopo l'installazione **chiudi e riapri PowerShell**, poi ripeti i tre controlli.
Se viene usata una versione vecchia, `Get-Command node, java` mostra quali
eseguibili sono selezionati: correggi il PATH prima di proseguire. Non modificare
la policy PowerShell: in questa guida si usa `npm.cmd` per evitare il blocco di
`npm.ps1` senza ridurre le protezioni.

## 2. Prepara una copia separata dei file

Crea una cartella di prova, per esempio `C:\evora-firestore-test`, e copia:

- `index.html` della versione analizzata del repository;
- l'intera cartella preparata `security\firestore`, con regole, test, documentazione,
  configurazione, `package.json` e **`package-lock.json`**.

La struttura deve essere:

```text
C:\evora-firestore-test\
  index.html
  security\
    firestore\
      firebase.json
      firestore.rules
      package.json
      package-lock.json
      README.md
      SCHEMA.md
      WINDOWS.md
      A1.md
      scripts\run-emulator.mjs
      scripts\emulator-diagnostics.mjs
      test\frontend-fixture.mjs
      test\frontend-contract.test.mjs
      test\rules.test.mjs
      test\emulator-diagnostics.test.mjs
```

Il branch cloud è `security/firestore-rules-emulator`. La versione base è su
GitHub, mentre le modifiche A1 attuali sono soltanto locali: un nuovo clone
non contiene la correzione A1. Occorre trasferire la cartella aggiornata dall’ambiente
di lavoro o attendere una successiva pubblicazione autorizzata. Non cambiare branch e non
eseguire commit dalla tua cartella Windows per questa prova.

**Non copiare** `.git`, il file legacy `html ` (ha uno spazio finale),
`node_modules`, `.emulator-cache`, log, credenziali o dati di produzione.
La copia separata evita il problema del nome con spazio finale su Windows.
Non spostare i test fuori dalla struttura: le fixture leggono `index.html` tramite
un percorso relativo. Usare il sorgente del commit base
`479213ab45cdee057f7c2d8c8e733eb64cc3c8b7`.

## 3. Installa e avvia i test

In PowerShell:

```powershell
Set-Location C:\evora-firestore-test\security\firestore
npm.cmd ci --ignore-scripts
```

Se l'installazione fallisce, fermati e conserva l'errore. Se termina correttamente:

```powershell
npm.cmd run test:contract
```

Sono attesi **7 test di contratto superati**. Questi controlli non certificano le
Security Rules. Se passano, esegui i test dell'Emulator:

```powershell
npm.cmd test
$LASTEXITCODE
```

Usare `npm.cmd test`, non direttamente `npm.cmd run test:rules`: il runner abilita
il controllo obbligatorio dei log. Un superamento del budget causa fallimento
globale anche se i singoli `assertFails` risultano soddisfatti.

Il comando scarica l'Emulator ufficiale al primo avvio, verifica il download,
avvia Firestore su `127.0.0.1:8089`, esegue i test e lo arresta alla fine.
Sono necessari accessi HTTPS a `registry.npmjs.org` e `storage.googleapis.com`.
La macchina deve avere la porta 8089 libera. Non servono Firebase CLI globale,
`firebase login` o file di credenziali.

**Risultato corretto:** riepilogo con tutti i test passati, zero fallimenti e
`$LASTEXITCODE` uguale a **0**. Il numero totale della suite Emulator va letto dal
riepilogo effettivo: comprende anche i casi anonimo, viewer, manager e admin.
La versione base è stata eseguita su Windows: 191 test, 179 passati e 12 falliti
per superamento del budget. La correzione A1 locale non è ancora stata eseguita
nell'Emulator, assente nella cache cloud. Non assumere in anticipo che le regole compilino o che i test
passino: gli eventuali errori sono informazioni necessarie alla revisione.

## 4. Se qualcosa non funziona

| Errore | Azione |
|---|---|
| `node`, `npm.cmd` o `java` non riconosciuto | Installa il runtime mancante, riapri PowerShell e ricontrolla il PATH. |
| Errore di esecuzione `npm.ps1` | Usa i comandi `npm.cmd` indicati; non cambiare ExecutionPolicy. |
| File `index.html` non trovato | Ripristina la struttura del punto 2. |
| HTTP 403 o download negato | Fai autorizzare il dominio dalla rete locale; non cambiare proxy per aggirare divieti. |
| Errore certificato/TLS | Fai correggere la configurazione di fiducia della macchina; non disattivare TLS. |
| Porta 8089 occupata | Individua il processo con `Get-NetTCPConnection -LocalPort 8089`; non terminarlo alla cieca. |
| Errore Java o compilazione Rules | Conserva il primo errore completo e le versioni Node/Java. |
| Uno o più test falliti | Conserva nomi dei test falliti, primo errore e riepilogo; non cambiare le regole online. |

Per salvare l'output dell'Emulator in un file locale:

```powershell
npm.cmd test *> .\risultato-emulator.txt
$esitoEmulator = $LASTEXITCODE
Get-Content .\risultato-emulator.txt -Tail 80
"Codice uscita: $esitoEmulator"
```

Condividi il riepilogo, i test falliti e il primo errore, dopo aver verificato che
non contengano informazioni riservate. Non inviare chiavi, token o credenziali.
Non eseguire merge, deploy o modifiche alle impostazioni Firebase/Cloudflare.
