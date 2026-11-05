# Valutazione AI da ChatGPT

Stato: attiva **solo sullo staging**, con candidature sintetiche e criteri provvisori `rubric-test-0`. In produzione la scrittura è spenta: il facade di produzione non ha l'identità `aiwriter`, e la regola AI non è nelle Rules di produzione.

## Strumenti MCP

| Strumento | Scope | Effetto |
|---|---|---|
| `search_applications` | `collective:read` | Ricerca per nome, cognome, username Instagram o ID; in caso di omonimie elenca e chiede quale scegliere |
| `get_application_details` | `collective:read` | Una candidatura nei soli campi autorizzati (`server/collective/mcp-candidate-policy.mjs`), con domande e risposte oscurate |
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

## Proposta di criteri `rubric-test-1` (TEST, da approvare)

| Criterio | Peso | Fonti |
|---|---|---|
| Allineamento con EVORΛ | 25 | motivazione, cosa apprezza, cosa significa rappresentare un brand, immagine, integrazione nei contenuti |
| Audience e performance Instagram | 20 | follower, visualizzazioni, interazioni, account raggiunti, follower netti (con provenienza) |
| Qualità della comunicazione | 15 | tre parole, tipo di contenuti, cosa trasmette, perché lo seguono, come racconterebbe EVORΛ |
| Mentalità professionale | 15 | scenario brand e performance, reazione ai risultati, analisi, periodo di prova, linee guida |
| Affidabilità e capacità produttiva | 15 | contenuti al mese, costanza, disponibilità (eventi, shooting, UGC, file originali) |
| Valore aggiunto e potenziale | 10 | valore oltre i contenuti, collaborazioni, categorie, prodotti, miglioramenti, altro |

- **Regole del punteggio:**
  - ogni criterio vale da 0 a 100;
  - l'AI Score è la media pesata dei criteri, arrotondata, e il server rifiuta un punteggio diverso;
  - sono obbligatori: tutti i criteri nell'ordine indicato, punti di forza, criticità, potenziale per EVORΛ, dati mancanti e limiti.

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
