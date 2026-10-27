# Blocco 2 — validazione server COLLECTIVE

Moduli ESM puri, senza dipendenze, rete, credenziali o persistenza. Preparati sul
branch `development/collective-server-validator`, derivato da `bf1fc673826c018f648a03aeb5cd1dac5c33329f`.
Non sono collegati al sito o al Worker distribuito. Nessuna modifica a frontend,
Worker allegato, Firestore Rules o servizi online. Non risolvono da soli i limiti
Rules: il passaggio delle scritture al Worker appartiene ai blocchi successivi.

## Esecuzione locale

Dalla radice del repository, con Node.js 24:

```sh
npm --prefix server/collective test
```

Su Windows usare `npm.cmd --prefix server/collective test`.
Non servono installazioni, Emulator, login Google/Firebase o accesso Internet.
Il lockfile è dependency-free. I test leggono l'`index.html` della stessa copia del
repository: conservare la struttura relativa `server/collective/test`.

## File e API

- `application.mjs`: schema pubblico, normalizzazione controllata, preparazione documento.
- `ocr.mjs`: validazione completa delle mappe OCR e conflitti.
- `scoring.mjs`: formule e normalizzazione derivate da `index.html:695–814`, con
  validazione della configurazione effettiva; benchmark predefiniti congelati.
- `validation.mjs`: errori strutturati, oggetti chiusi, stringhe/numeri/array/date.
- `test/*`: fixture sintetiche, contratto con frontend reale, negativi e casi limite.

```js
import {parsePublicApplicationJson, prepareApplication} from './application.mjs';

// Esempio di futura integrazione: NON è un handler HTTP implementato.
const candidate = parsePublicApplicationJson(rawBody);
const document = prepareApplication(candidate, {
  now: serverGeneratedIsoTime,
  scoring: configLoadedByServer
});
```

`validatePublicApplication(object)` restituisce una copia normalizzata, senza
modificare l'input. `parsePublicApplicationJson(string)` limita il JSON a 1 MiB
UTF-8, ne controlla la sintassi e richiama lo stesso validatore. L'HTTP handler
futuro deve imporre il limite già durante la lettura dello stream, senza fidarsi
soltanto di Content-Length: questa API riceve una stringa già in memoria.

`prepareApplication(input, {now, scoring})` richiede un orologio server esplicito;
non prende date dal candidato. Restituisce il documento persistibile schema v4,
senza ID database. L'adattatore futuro genererà l'ID e applicherà la creazione
senza sovrascrittura. Il controllo finale sul JSON UTF-8 non è una misurazione
esatta dell'encoding Firestore: l'adattatore dovrà verificare il proprio formato REST.

Errori: `ValidationError` con `code` e `path`, senza il valore rifiutato. Sono
previsti codici distinti per tipo, campo mancante/sconosciuto, range, enum, formato,
condizione e campo server. Nessun mapping HTTP è introdotto in questo blocco.

## Contratto pubblico

54 campi ammessi, non 71: i dati derivati e amministrativi vengono aggiunti solo
dal server. Chiavi aggiuntive o riservate sono **rifiutate**, non ignorate, anche
se il valore sembra innocuo. Nessun ruolo o informazione di autenticazione è
accettato nel payload della candidatura; non è richiesto Google Login.

Campi richiesti:

- Profilo: `fullName`, `age`, `email`, `city`, `country`, `isAdult`, `profileCategories`.
- Social: `instagram`, `followers`, `screenshotData`, `views`, `netFollowers`,
  `interactions`, `accountsReached`.
- Posizionamento: `threeWords`, `contentType`, `whatToTransmit`, `whyFollow`, `hasBrandCollabs`.
- Compatibilità: `motivation`, `brandLike`, `contentIntegration`.
- Mentalità: `buildWithoutEarnings`, `brandMeaning`.
- Disponibilità: `contentPerMonth`, `hasRoutine`, `followsGuidelines`, `availEvents`,
  `availShooting`, `availUgc`, `availRawFiles`.
- Consenso: `privacyConsent`.

Campi facoltativi, con default compatibili con il frontend:

- Stringa vuota: `otherProfileCategory`, `tiktok`, `screenshotName`, `screenshotName2`,
  `brandCollabDetails`, `athleteImage`, `valueBeyondContent`, `howWouldTell`,
  `scenarioBrandContent`, `badContentReaction`, `analysisElements`, `boughtProducts`,
  `improvements`, `extra`, `contentUrl1`, `contentUrl2`, `contentUrl3`,
  `screenshotData2`, `profileScreenshotData`.
- `tiktokFollowers`: zero.
- `ocrInsights`, `ocrProfile`: null.

`brandCollabDetails` diventa obbligatorio se `hasBrandCollabs` è `yes`;
`otherProfileCategory` se è selezionato `altro`.

### Tipi, limiti e condizioni

- Numeri JSON interi: età 18–99; follower/metriche 0–10^12; follower netti ±10^12.
  Non si convertono stringhe, valori vuoti, decimali, NaN o infiniti in zero.
- `isAdult` e `privacyConsent` esattamente true; categorie ammesse dal frontend,
  lista 1–8 senza duplicati. Tutti gli enum provengono dalle opzioni attuali.
- Testi: nome/email 199; città/Paese/categoria altra/social 200; nomi file 255;
  campi brevi 120, risposte medie 600, lunghe 900. I campi richiesti non possono
  essere vuoti o solo spazi; nome almeno due caratteri. Lunghezze JS in unità UTF-16,
  come `maxLength` del frontend. La dimensione JSON è controllata separatamente in byte.
- Email: formato corrente, con trim. Link contenuti HTTP/HTTPS fino a 2.048,
  senza credenziali incorporate o spazi. Nessun link viene visitato dal modulo.
- Social: handle Instagram/TikTok o URL del social corrispondente; normalizzazione
  a handle e URL come nel frontend per gli input supportati, senza silenziosa
  eliminazione di caratteri non validi. Categoria altra viene trimmata.
- Immagini: JPEG data URL base64 strutturalmente valido (output di compressImage),
  massimo 700.000 caratteri ciascuna, 900.000 complessivi. Primo screenshot
  obbligatorio; gli altri possono essere vuoti. Non decodifica o certifica il JPEG.
- OCR: mappe chiuse, campi presenti, valori nulli o numeri finiti ±10^12, visibilità
  e tipi schermata previsti, testi fino a 200, flag truncated booleano, massimo
  quattro conflitti verificati singolarmente, timestamp ISO UTC validi. Null,
  incompletezza e schermate uncertain restano ammessi come dati dichiarati.
- Oggetti con prototipi personalizzati, accessor, chiavi simboliche, array sparsi
  o con proprietà aggiuntive sono rifiutati. L'output non condivide riferimenti
  mutabili con l'input.

## Campi esclusi e documento preparato

Sono riservati: `id`, `schemaVersion`, `date`, `updatedAt`, `status`, `notes`,
`creatorCode`, `evaluation`, `socialScore`, `perfLevel`, `bandLabel`, `erRate`,
`reachRate`, `growthRate`, `instagramHandle`, `instagramUrl`, `tiktokHandle`,
`tiktokUrl`, `insightsCorrection`. Il payload operativo attuale che contiene
questi campi NON può essere inoltrato invariato al nuovo validatore.

Il server aggiunge i 17 campi derivati/gestionali necessari per ottenere gli stessi
71 campi del documento corrente: schema v4, date server, `new`, note/codice vuoti,
valutazione vuota, riferimenti social e metriche calcolate. ID e correzioni non
vengono aggiunti al documento di prima candidatura. Non è una migrazione dati.

## Scoring e compatibilità

Formule conservate: ER = interazioni/account raggiunti; reach = raggiunti/follower;
growth = follower netti/follower; normalizzazione per fascia, crescita negativa
azzerata solo nel punteggio, pesi normalizzati, arrotondamenti e livelli invariati.
Sono conservati i fallback storici views/newFollowers e la lettura numerica legacy.
Le visualizzazioni non entrano direttamente nello score moderno.

- `validateScoringConfig`: nuovo config completo v2, schema esatto, 4 livelli,
  5 fasce, ordinamento, pesi positivi complessivamente, limiti e colori validi.
  È validazione, **non autorizzazione** per lo scoring amministrativo.
- `resolveScoringConfig`: config server assente/versione precedente → default,
  come frontend; supporta v2 parziali validi completati con i default e il fallback
  tiers usato dal codice corrente. La fascia illimitata è serializzata come null.
- Config v2 malformati vengono rifiutati anziché essere usati per produrre score
  errati. Limiti di profondità e dimensione impediscono strutture cicliche/anomale.

I test confrontano l'intero risultato con le funzioni realmente lette dal frontend,
non con una seconda copia della fixture: fasce ai confini, interpolazione, pesi
personalizzati, fallback legacy, zeri e 120 combinazioni deterministiche aggiuntive.

## Incompatibilità esplicite e integrazione futura

Il sito operativo non cambia in questo blocco. Prima di collegarlo al Worker:

1. Inviare solo i 54 campi pubblici, con numeri JSON; oggi il frontend calcola anche
   campi server, mentre lo stato del form usa stringhe per i numeri.
2. Requisito età confermato dal founder il 27 ottobre 2026: solo maggiorenni.
   Il frontend preparato in `development/collective-applications-frontend` è stato
   allineato a 18–99; nessuna modifica al validatore di questo blocco o alla produzione.
3. Allineare limiti testuali e verifica dell'intero modulo alla conferma finale.
4. Mostrare gli errori strutturati invece di convertire input numerici errati in zero.
5. URL social estranei, link con credenziali, base64 malformato e date OCR impossibili
   prima non sempre bloccati sono ora rifiutati. Dati legacy non vengono riscritti
   o sottoposti retroattivamente al validatore delle nuove candidature.
6. Verificare su dati anonimizzati reali gli eventuali config v2 fuori dal contratto
   supportato. Non sono stati letti database o configurazioni di produzione.

Restano fuori dal blocco: endpoint HTTP, lettura stream, OAuth/IAM, chiamate REST,
idempotenza, antispam, OCR come servizio, notifiche, sessione Google C1, permessi
owner/manager/viewer e deploy. Il futuro handler non deve passare `now` o `scoring`
direttamente dal body del candidato. Il modulo non richiede alcun secondo login.

## Verifiche

Esito verificato con Node.js 24.19.0: **208 test passati, 0 falliti**.
Eseguire `npm test` per riprodurre il risultato. Test positivi di parità dei 71 campi,
negativi con codice/percorso atteso, omissione/tipo di tutte le chiavi pubbliche,
OCR annidato, confini e protezione da campi amministrativi. Nessun dato reale,
credenziale, servizio online o Emulator è utilizzato.
