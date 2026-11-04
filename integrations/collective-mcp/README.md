# EVORΛ COLLECTIVE — MCP privato, prototipo isolato

**Stato al 4 novembre 2026: strumenti verificati con dati simulati; collegamento reale BLOCCATO.**

Branch locale `feature/collective-private-mcp`, base COLLECTIVE `9f38d871c00c90b3146cf103d808b098d8dd9146`.
Tutti i nuovi file sono in questa cartella. Nessun file preesistente modificato, commit, push, deploy, nuova raccolta o modifica Rules. Nessuna credenziale Firebase o Cloudflare caricata; nessuna lettura di dati reali.

## Blocco 1 — Audit: verificato e non verificato

| Area | Evidenza verificata nel codice | Limite della verifica |
| --- | --- | --- |
| Candidature | `server/collective/application.mjs:29–33,99–109`: 54 campi pubblici; documenti nuovi schema 5, `date`/`updatedAt` ISO UTC, stato iniziale `new`, campi gestionali e score server-side | Il contenuto e i tipi effettivi di tutti i documenti storici non sono stati letti |
| Scoring V2 | `server/collective/scoring.mjs:8–17,19–96,117–125`: configurazione versione 3, modulo puro riutilizzabile | `settings/scoring` reale non accessibile: i valori del repository sono predefiniti, non una lettura della produzione |
| Benchmark | `public/score-levels.js:57–64,152–168`: tre metriche, cinque nodi, PCHIP log ordinato e supporto al metodo precedente | Valori e metodo attualmente salvati non verificati online |
| Classificazioni | `public/score-levels.js:46–55`: gruppi Social Score e metriche, indipendenti dal valore numerico | Configurazione personalizzata non letta dalla produzione |
| HUB visto da COLLECTIVE | `public/hub-sso-client.js:5–49`, `worker/src/hub-sso.mjs:15–56`: identità individuale, codice monouso/PKCE, UID/ruolo/versione e controllo privato | Non dimostra che HUB esponga OAuth 2.1 standard per ChatGPT |
| Binding esistente | `wrangler.toml:16–21`: `HUB_IDENTITY`, servizio `evora-hub-auth-test`, entrypoint `HubIdentityService` | Configurazione distribuita non verificata; il nome con suffisso test non prova l'ambiente effettivo |
| API COLLECTIVE | `worker/src/worker.js:772–779`: candidature, OCR, notifiche, impostazioni, SSO | Non esiste nel router esaminato un servizio privato di lettura candidature per MCP |
| Firestore Rules | `security/firestore/migration/firestore.rules:118–139`: letture staff, scritture client impostazioni negate | Questo è codice nel repository, non prova del ruleset pubblicato |

### Blocco effettivo HUB

Il repository indicato è `francesco87mazzeo-creator/evora-social-analytics`, percorsi `apps/hub/server/` e `apps/hub/src/`. Il tentativo autorizzato `git ls-remote --symref … HEAD` termina con `could not read Username for 'https://github.com': No such device or address`.

**Non è stato analizzato il server HUB.** Non sono stati tentati login, cambi di credenziali o accessi alternativi. La parte di integrazione dell'autenticazione è sospesa, come richiesto. Per riprenderla occorre rendere disponibile il repository tramite la connessione GitHub autorizzata oppure fornire i soli sorgenti sanitizzati. Non occorre inviare token, password, service account o UID reali in chat.

### Schema rilevante e minimizzazione

Il documento completo contiene identità/contatti, risposte, disponibilità, link, immagini e dati numerici. Il MCP non legge quel documento intero:

- Metriche: `followers`, `views`, `interactions`, `accountsReached`, `netFollowers`.
- Score salvati: `scoringVersion`, `socialScore`, `engagementRate`, `engagementScore`, `visibilityScore`, `reachEngagementRate`, `lowBase`; vecchi tassi `erRate/reachRate/growthRate` separati.
- Metadati: ID, versione schema, data, aggiornamento e stato noto; gli stati sconosciuti non vengono restituiti come testo libero.
- Provenienza: soli valori/visibilità OCR, orario di lettura, valori numerici prima/dopo l'ultima correzione e relativo orario.
- Esclusi dalle maschere Firestore: nomi, email, username, età, risposte, link, screenshot, note, codice creator e autore della correzione.
- `insightsHistory` non è letto: Firestore non permette di proiettare selettivamente i campi di ogni elemento di quell'array. Non si conclude che lo storico sia assente. La prova OCR non è una verifica indipendente di attendibilità.

I campi pubblici completi sono definiti dall'export `PUBLIC_FIELDS` nel validatore originale, non replicati nel MCP. I documenti storici non vengono convertiti o riscritti.

### Formule e configurazioni

Definiti `H(x;s) = 100 ln(1+x/s) / (ln(1+x/s) + ln 2)`:

- Engagement normalizzato: `H(interactions / views × 100; engagementRateReference)`.
- Visibilità: `H(views; viewsReference)`.
- Social Score: arrotondamento della media pesata delle due componenti, normalizzata per la somma dei pesi.
- Predefiniti nel codice: 65/35, riferimento Engagement 2%, riferimento visualizzazioni 30.000; avviso base ridotta sotto 1.000 visualizzazioni o 10 interazioni. L'avviso non corregge numericamente lo score.
- Indicatore B: `interactions/accountsReached × 100`, solo con denominatore positivo. Non contribuisce allo score. Account raggiunti mancanti restano `null`; non sono sostituiti dalle visualizzazioni.
- Zero visualizzazioni: score complessivo non disponibile. Interazioni zero con visualizzazioni positive: dato reale, non mancante.

Il MCP importa `computeScore` e `resolveScoringConfig` dal modulo originale, senza copiare o modificare le formule. Versioni storiche della configurazione seguono la risoluzione già esistente verso i default; un errore di lettura non viene trasformato in documento mancante o default. Una configurazione v3 non valida fallisce.

Benchmark predefiniti, **non una lettura del database**, per nodi 1K/5K/20K/100K/500K follower:

| Nodo | Engagement Medio/Buono/Eccellente | Reach | Growth |
| --- | --- | --- | --- |
| 1K | 12/24/45% | 60/120/250% | 0,5/1,5/3,5% |
| 5K | 9/18/34% | 40/80/160% | 0,45/1,3/3% |
| 20K | 7/14/26% | 30/60/120% | 0,35/1,1/2,7% |
| 100K | 5/10/20% | 20/40/80% | 0,25/0,9/2,2% |
| 500K | 4/8/16% | 15/30/60% | 0,2/0,7/1,8% |

Sono riferimenti configurabili, non percentili scientificamente validati e non componenti dello Score V2. I cinque nodi di interpolazione non sono le cinque fasce dei filtri Admin. Livelli predefiniti: Social 0/35/55/75/100; metriche 0/25/50/75/100. I gruppi restano distinti.

`get_scoring_configuration` legge i tre documenti fissi e indica la fonte di ciascuno. Il ricalcolo legge solo scoring e livelli: un guasto ai benchmark informativi non blocca la matematica V2. Le letture non sono una transazione; il Worker originale può mantenere una cache scoring per 60 secondi (`worker/src/worker.js:48,479–485`). La lettura del database non certifica istantaneamente il valore in cache su ogni istanza. Non esiste uno snapshot della configurazione all'invio in questi campi: una differenza tra salvato e ricalcolato non dimostra un errore.

## Blocco 2 — Prototipo locale

### Tre strumenti

| Strumento | Contratto | Protezioni |
| --- | --- | --- |
| `list_recent_applications` | `limit` intero 1–20, default 5; ID, data, stato noto, metriche e score salvati | Proiezione dei campi; `date DESC, __name__ DESC`; verifica dell'ordine e dei duplicati; nessuna paginazione/export massivo |
| `get_application_metrics` | ID limitato a 128 caratteri alfanumerici, trattino e underscore | Maschera di lettura; score salvato separato dal ricalcolo; evidenze numeriche limitate; nessun testo libero del candidato |
| `get_scoring_configuration` | Nessun argomento | Soli `settings/scoring`, `settings/instagramBenchmarks`, `settings/scoreLevels`; validatori originali; fonte default/stored esplicita |

L'ordine recente richiede date ISO stringa UTC canoniche, coerenti con lo schema attuale. Firestore esclude i documenti senza `date` dalla query. Un tipo/data/ordine inatteso nei risultati causa errore; i documenti storici e gli indici effettivi richiedono verifica separata prima del collegamento. Non viene nascosto un problema riordinando localmente un campione incompleto.

Streamable HTTP stateless con SDK MCP ufficiale, protocollo SDK più recente `2025-11-25`. Schemi input rigorosi, tre strumenti soltanto, annotazioni read-only e descrittori OAuth sia a livello tool sia in `_meta`, coerenti con l'esempio ufficiale OpenAI. Il client SDK generico rimuove il campo custom di primo livello, quindi un test verifica anche il JSON effettivo sul filo.

Nessuna annotazione viene considerata una barriera di autorizzazione: il controllo deve precedere ogni richiesta MCP. Host e Origin verificati; corpo MCP massimo 16 KiB, risposte Firestore massimo 256 KiB, letture con timeout e cancellazione dello stream. Nessun payload o token nei log applicativi del nuovo componente.

### Autenticazione: bozza non collegata

`src/auth.mjs` è una **bozza di confine resource-server**, testata con firme e autorità generate nel processo di test. Non è il sistema OAuth HUB, non implementa un login e non è attivata dal Worker predefinito.

La bozza richiede firma ES256, tipo access token, issuer esatto, audience unica dell'endpoint MCP, scope unico `collective:read`, UID HUB Founder esatto e ruolo applicativo admin, `iat/exp/jti`, durata massima cinque minuti e versione HUB. Verifica inoltre, nei test, grant attivo e versione dell'identità ad ogni richiesta, senza cache positiva. Manager, viewer, altri admin e UID legacy condivisi sono negati.

**Contratto nuovo soltanto proposto:** introspezione privata `OAUTH_AUTHORITY`. Non è stato trovato né aggiunto nell'HUB; i nomi dei claim OAuth sono provvisori. Il solo contratto privato verificato dal lato COLLECTIVE è `HUB_IDENTITY` `/internal/collective/check`. Non è dimostrato che possa essere usato dal nuovo componente senza cambi HUB: va letto il server.

`src/worker.mjs` restituisce sempre HTTP 503 con `HUB_AUTHENTICATION_REVIEW_REQUIRED`, anche con variabili apparentemente configurate. Non esiste flag per abilitarlo. La factory separata serve solo al test con dipendenze esplicite. Non vengono emessi token Firebase, caricati service account o usati i codici condivisi.

### Esecuzione

Requisito Node.js 24+. Dalla cartella:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

I test usano un vero client SDK MCP con trasporto Web Standard, JWT effimeri sintetici e Firestore REST simulato. La rete globale è disabilitata nei test. Non occorrono Java, Emulator, Firebase login, Google Login o credenziali.

```sh
npm start
```

Avvia soltanto il server bloccato su `127.0.0.1:8791`: risponde 503, non consente di collegare ChatGPT e non mostra token. Serve a verificare che il prototipo non attivi accidentalmente dati reali. I tre strumenti sono esercitabili nella suite isolata; non è pronta una connessione autenticata utilizzabile.

`wrangler.example.toml` è separato dal Wrangler di produzione: nome inedito, nessuna route, binding o variabile, workers.dev e preview disabilitati. Dry-run di compilazione, **non pubblicazione**:

```sh
WRANGLER_SEND_METRICS=false npx wrangler@4.149.0 deploy --config wrangler.example.toml --dry-run --outdir /tmp/evora-mcp-bundle
```

Non eseguire il comando senza `--dry-run`. Il bundle non prova il comportamento del runtime Cloudflare o l'integrazione HUB. Nessuna prova in un account Cloudflare è stata effettuata.

## Blocco 3 — Collegamento reale: prerequisiti, nessuna implementazione

### OAuth e identità

1. Rendere accessibile il codice HUB; verificare sessioni personali, Google login, UID stabile, concessione COLLECTIVE, revoca e superfici OAuth già presenti. Non aggiungere un nuovo login.
2. Accertare se esiste già un authorization server compatibile. I parametri custom SSO visibili (`client`, `challenge`, frammento `hub_code`) non dimostrano supporto a `client_id`, `redirect_uri`, `resource` e PKCE OAuth standard.
3. Definire, solo dopo quel controllo, Authorization Code + PKCE S256, redirect esatti, state e codici monouso consumati atomicamente; metadata RFC8414/OIDC e RFC9728; Resource Indicators RFC8707. Concordare registrazione client supportata da ChatGPT: preregistrata, dinamica o Client ID Metadata Document. Non inventare URL callback.
4. L'identità deve provenire dall'HUB verificato, non da email o ruolo dichiarati dal browser. La allowlist deve contenere soltanto l'UID personale del Founder configurato lato server. Il ruolo admin da solo non è sufficiente.
5. Grant di sola lettura, token brevi con audience MCP; eventuali refresh token ruotati, storage/revoca persistenti, scadenza e invalidazione del grant. Il token MCP non viene accettato da Firebase o inoltrato a Firestore; non si incollano credenziali in ChatGPT.
6. Verifica di revoca sia del grant OAuth sia dell'identità HUB; diniego se le autorità sono indisponibili. Proteggere metadati/JWKS configurati e limitare richieste per utente/client prima di esporre il servizio.

La libreria ufficiale Cloudflare per OAuth prova la fattibilità dell'hosting Workers e dell'introspezione su service binding. Richiede stato persistente/KV per il server autorizzativo; **non è stata installata né scelta come sostituto di HUB**. Prima va esaminata l'infrastruttura già disponibile.

### Accesso Firestore senza duplicare credenziali privilegiate

Il contratto `channel.fetch` di `src/reader.mjs` è soltanto un canale di test. Non usa `fetch` ambientale né un fallback al Worker pubblico. Nessun binding di lettura reale è stato creato.

Preferenza proposta: un piccolo facade privato con allowlist di operazioni/campi e limite rigido, usando la credenziale già custodita nel Worker COLLECTIVE, senza copiarla nel MCP. Tale entrypoint non esiste nel router esaminato. **Aggiungerlo richiederebbe modificare e ridistribuire il Worker esistente: serve nuova approvazione, e non è stato fatto.** Il facade deve applicare a sua volta proiezioni e limiti; non deve diventare un proxy Firestore generico.

Alternativa da valutare, non implementata: identità Google dedicata strettamente read-only/federata. Comporta provisioning IAM e possibile nuova gestione credenziali; `datastore.viewer` è più ampio di una singola raccolta e non va presentato come isolamento per collezione. Non copiare il service account amministrativo in un secondo servizio.

La lettura privilegiata server-side non è garantita dalle Rules client. Il percorso privato, IAM e le allowlist devono essere verificati separatamente. Nessuna modifica Rules è necessaria per il prototipo.

### Compatibilità dell'account ChatGPT: NON VERIFICATA

Non dispongo di un'API o di accesso alle impostazioni del tuo account/workspace per verificarne piano, policy o permessi. La presenza di un pulsante non dimostra nulla. Gli esempi OpenAI confermano la possibilità tecnica; le guide web dirette sono risultate bloccate dal proxy, mentre il codice ufficiale su GitHub è leggibile.

Prima del collegamento occorre verificare nel workspace effettivo:

- Creazione di app/MCP personalizzati privati e modalità sviluppatore realmente consentite dal piano e dall'amministratore.
- Possibilità di configurare OAuth per quell'app, non soltanto di visualizzare la sezione Apps.
- Policy delle app esterne, condivisione limitata al Founder e trattamento/retention dei dati compatibili con l'uso previsto.
- Callback/client metadata effettivamente forniti da ChatGPT, accessibilità HTTPS degli endpoint e riuscita del flusso OAuth con il Founder; accesso negato a un'altra identità.
- I client remoti ChatGPT non possono raggiungere automaticamente `localhost`. Non aprire tunnel o pubblicare URL del prototipo prima di avere completato le barriere di autenticazione.

Nessuna app ChatGPT creata, nessuna sessione Google avviata e nessun test live effettuato. I dati minimizzati sono pseudonimizzati, non garantiti anonimi: metriche e ID possono restare dati personali. Va verificata la copertura informativa/privacy per il trattamento tramite ChatGPT.

## Costi, rischi e decisioni necessarie

- Lavoro locale e test: nessun servizio a pagamento introdotto.
- Reale: possibili consumi Workers, stato OAuth e letture Firestore. Non conosco piano, crediti o quote degli account, quindi non prometto costo zero. Nessuna chiamata AI/Anthropic/OCR/Telegram viene aggiunta.
- Letture applicative: massimo 20 candidature per elenco; tre documenti per configurazione; candidatura + scoring + livelli per dettaglio. Si aggiungono eventuali costi query/indici, verifiche OAuth/HUB e minimi di fatturazione. Le chiamate ripetute di ChatGPT consumano letture: servono quote prima di attivare dati reali.
- Gli errori non abilitano fallback pubblici o a credenziali più privilegiate. Etichette di configurazione restano dati non attendibili come istruzioni; le risposte testuali dei candidati sono escluse.
- I limiti della provenienza, dello storico, dei documenti senza data e della cache scoring sono espliciti. Non si producono diagnosi certe di errore da un semplice delta tra score.

**Da decidere dopo accesso al codice HUB:** riuso dell'authorization server esistente, contratto token/revoca, percorso privato di lettura e approvazione di qualsiasi modifica a componenti esistenti. Solo dopo: provisioning minimo, verifica permessi ChatGPT e test reali esclusivamente in lettura. Nessuna di queste operazioni è autorizzata o eseguita da questo prototipo.

## Fonti ufficiali consultate

- [MCP authorization 2025-11-25](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/basic/authorization.mdx): RFC9728, OAuth 2.1, PKCE e audience/resource.
- [SDK MCP TypeScript](https://github.com/modelcontextprotocol/typescript-sdk): versione installata 1.32.2, protocollo più recente dichiarato dall'SDK 2025-11-25; Web Standard transport documenta compatibilità Workers.
- [Esempio OAuth ufficiale OpenAI](https://github.com/openai/openai-apps-sdk-examples/blob/main/authenticated_server_python/main.py): metadata, challenge e descrittori securitySchemes.
- [Collegamento a ChatGPT negli esempi OpenAI](https://github.com/openai/openai-apps-sdk-examples#testing-in-chatgpt): possibilità tecnica, non certificazione delle abilitazioni del tuo account.
- [Cloudflare OAuth provider](https://github.com/cloudflare/workers-oauth-provider): autorizzazione su Workers, stato persistente e separazione authorization/resource server su binding privato.

## Risultati effettivamente eseguiti

- **79 test MCP superati, zero fallimenti**, con rete esterna disabilitata: vero client SDK, tre strumenti, limiti e ordinamento, 24 profili sintetici in parità con il modulo originale, dati null/zero/legacy, provenienza e snapshot senza modifiche, confine di autorizzazione candidato, revoca simulata, dinieghi, minimizzazione e assenza di payload nei log.
- **534 test preesistenti superati, zero fallimenti**: validatore/scoring, Worker, integrazione HUB vista da COLLECTIVE e igiene repository. Non sono una verifica del server HUB o delle regole pubblicate.
- `npm audit --omit=dev`: **zero vulnerabilità note riportate** nelle dipendenze installate. Non è una garanzia di assenza di vulnerabilità.
- Wrangler **4.149.0 dry-run superato**: bundle circa 1.456 KiB, gzip circa 251 KiB; nessun binding, nessuna pubblicazione. Nessun runtime Cloudflare reale testato.
- Server locale avviato solo su loopback, GET `/mcp` ha risposto **503**, `dataAccessEnabled:false`; server successivamente arrestato.
- Controllo euristico nuovi file: nessun percorso incompatibile con Windows e nessuna corrispondenza per credenziali incorporate. Nessuna credenziale reale impiegata nei test.
- Diff dei file preesistenti rispetto alla base: **vuoto**. Nessun test browser o Emulator ufficiale eseguito: non ci sono UI/Rules nuove e Firestore è simulato.

**Non verificati:** sorgenti e deployment HUB, OAuth reale (PKCE/consenso/codici/refresh/registrazione client), UID Founder effettivo, revoca reale, permessi dell'account ChatGPT, accesso Firestore reale, configurazioni online e comportamento end-to-end in produzione. Il prototipo non va attivato finché questi punti non vengono risolti.
