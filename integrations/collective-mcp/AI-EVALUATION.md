# Valutazione AI da ChatGPT

Stato: attiva **solo sullo staging**, con candidature sintetiche e la rubrica definitiva `rubric-v1`. In produzione la scrittura è spenta: il facade di produzione non ha l'identità `aiwriter`, e la regola AI non è nelle Rules di produzione.

## Strumenti MCP

| Strumento | Scope | Effetto |
|---|---|---|
| `search_applications` | `collective:read` | Ricerca per nome, cognome, username Instagram o ID; in caso di omonimie elenca e chiede quale scegliere |
| `get_application_details` | `collective:read` | Vista amministrativa nei soli campi autorizzati (`server/collective/mcp-candidate-policy.mjs`): risposte oscurate, scoring, valutazione dello staff, stato e valutazioni AI salvate. Non va usata per generare un nuovo AI Score |
| `get_application_for_ai_evaluation` | `collective:read` | Solo dati originali per la valutazione indipendente, senza punteggi, giudizi, stato o valutazioni AI precedenti; rilascia l'`inputTicket` |
| `propose_ai_evaluation` | `collective:read collective:evaluate` | Richiede l'`inputTicket`; valida punteggio (0–100), motivazione, criteri e campi strutturati, e restituisce una proposta firmata valida 10 minuti. Non scrive nulla |
| `save_ai_evaluation` | `collective:read collective:evaluate` | Salva solo la proposta confermata: stessi valori, `proposalToken`, `confirmed: true` |

## Valutazione indipendente (blocco 3)

- **Lettura dedicata:** `get_application_for_ai_evaluation` (scope `collective:read`) restituisce solo dati originali: domande e risposte (oscurate), categorie, disponibilità, metriche Instagram con la loro provenienza e link ai contenuti (non aperti dal server).
- **Cosa resta escluso:** Social Score e sue componenti, valutazioni dello staff, stato, valutazioni AI precedenti e note. L'esclusione è applicata dalla maschera dei campi Firestore (`EVALUATION_FIELDS` in `server/collective/mcp-candidate-policy.mjs`), prima che i dati lascino il database.
- **Provenienza di ogni metrica:**
  - letta dallo screenshot;
  - modificata dal candidato;
  - corretta dallo staff;
  - inserita dal candidato;
  - mancante.

  Nessuna è una verifica indipendente dell'account.
- **Collegamento tra lettura e proposta:** `propose_ai_evaluation` richiede l'`inputTicket` rilasciato dalla lettura dedicata, valido 30 minuti e legato a candidatura e rubrica. La proposta dice solo se esiste una valutazione AI precedente, senza mostrarne il punteggio.
- **Strumento amministrativo:** `get_application_details` resta invariato (con scoring e valutazione dello staff), ma la sua descrizione lo esclude dall'uso per la valutazione AI.

## Rubrica definitiva `rubric-v1`

Sei aree di analisi, **senza pesi fissi**. ChatGPT decide quanto conta ogni area per il profilo specifico e lo spiega nella motivazione. L'AI Score è il suo giudizio complessivo, non una media, e il server non lo ricalcola.

| Area | Su cosa si basa |
|---|---|
| Allineamento con EVORΛ | motivazione, cosa apprezza, cosa significa rappresentare un brand, immagine, integrazione nei contenuti |
| Audience e performance Instagram | follower, visualizzazioni, interazioni, account raggiunti, follower netti, con la loro provenienza |
| Qualità della comunicazione | tre parole, tipo di contenuti, cosa trasmette, perché lo seguono, come racconterebbe EVORΛ |
| Mentalità professionale | scenario brand e performance, reazione ai risultati, analisi, periodo di prova, linee guida |
| Affidabilità e capacità produttiva | contenuti al mese, costanza, disponibilità per eventi, shooting, UGC e file originali |
| Valore aggiunto e potenziale | valore oltre i contenuti, collaborazioni, categorie, prodotti, miglioramenti, altro |

**Scala comune 0–100**, con fasce descritte per la confrontabilità (`SCORE_BANDS` in `server/collective/mcp-ai-policy.mjs`):

| Fascia | Punteggio |
|---|---|
| Eccezionale | 90–100 |
| Molto buono | 75–89 |
| Buono con riserve | 60–74 |
| Incerto | 40–59 |
| Debole | 20–39 |
| Non idoneo | 0–19 |

**Risultato obbligatorio:**
- AI Score complessivo;
- motivazione complessiva;
- le sei aree nell'ordine indicato, ciascuna con un punteggio 0–100 e un'analisi motivata di almeno 20 caratteri;
- punti di forza;
- criticità;
- potenziale per EVORΛ;
- possibili ruoli, anche nessuno;
- dati mancanti e limiti della valutazione.

**Regole di valutazione:**
- è una valutazione generale della candidatura, non per una campagna specifica;
- non giudica la qualità di contenuti che non ha esaminato e non inventa metriche.

**Rubriche precedenti:** `rubric-test-0` e `rubric-test-1` restano leggibili nello storico e nell'Admin, marcate TEST e mai convertite, ma non accettano nuove valutazioni.

**Consultazione amministrativa:** `get_application_details` mostra Social Score, valutazione dello staff, stato e le valutazioni AI già salvate (corrente e storico, di qualunque rubrica), per rispondere alle domande del Founder o confrontare valutazioni. Questi dati non entrano nella lettura indipendente.

## Garanzie

- **Scrittura limitata ai campi AI dal database:** la facade scrive con un'identità Firebase email/password con ruolo `aiwriter`, non con credenziali IAM.
  - Le Rules (`security/firestore/staging/ai-evaluation.rules`) consentono a quell'identità solo l'aggiornamento di `aiEvaluation` e `aiEvaluationHistory`, con schema chiuso, data impostata dal server, storico in sola aggiunta (massimo 20 voci) e nessuna lettura.
  - Le letture usano l'account di servizio di sola lettura.
- **Proposta:** firmata con HMAC (chiave derivata dalla chiave del canale privato). Lega Founder, candidatura, impronta del contenuto esatto, versione del documento e scadenza.
- **Conferma:** il salvataggio richiede la proposta, gli stessi valori e la conferma esplicita.
- **Riutilizzo e concorrenza:**
  - una proposta già salvata risponde «già salvata» e non scrive di nuovo;
  - qualunque scrittura sulla candidatura dopo la proposta (staff, altra valutazione) la rende non valida, perché la scrittura ha la precondizione sulla versione del documento.
- **Founder:** ogni operazione verifica l'identità Founder presso l'HUB.
- **Riautorizzazione:** con un token di sola lettura, gli strumenti AI rispondono con `mcp/www_authenticate` (`insufficient_scope`, `scope="collective:read collective:evaluate"`). ChatGPT propone di riautorizzare lo stesso connettore, mentre gli strumenti di lettura continuano a funzionare.
- **Admin:** la scheda candidato mostra la sezione «Valutazione AI» in sola lettura (punteggio, motivazione, criteri, data, versione dei criteri, storico), separata da scoring e valutazione del team.

## Prima della produzione

- Criteri di valutazione approvati, al posto di `rubric-test-0`.
- Verifica privacy e base giuridica per l'uso di AI esterna sui dati reali.
- In `evora-athletes`: accesso email/password attivo, identità `aiwriter`, regola AI aggiunta alle Rules attive (`migration/firestore.rules`). L'accesso anonimo resta invariato.
- Deploy autorizzato di HUB, facade e server MCP di produzione.
