# Valutazione AI da ChatGPT

Stato: attiva **solo sullo staging**, con candidature sintetiche e criteri provvisori `rubric-test-0`. In produzione la scrittura è spenta: il facade di produzione non ha l'identità `aiwriter`, e la regola AI non è nelle Rules di produzione.

## Strumenti MCP

| Strumento | Scope | Effetto |
|---|---|---|
| `search_applications` | `collective:read` | Ricerca per nome, cognome, username Instagram o ID; in caso di omonimie elenca e chiede quale scegliere |
| `get_application_details` | `collective:read` | Una candidatura nei soli campi autorizzati (`server/collective/mcp-candidate-policy.mjs`), con domande e risposte oscurate |
| `propose_ai_evaluation` | `collective:read collective:evaluate` | Valida punteggio (0–100), motivazione e criteri, e restituisce una proposta firmata valida 10 minuti. Non scrive nulla |
| `save_ai_evaluation` | `collective:read collective:evaluate` | Salva solo la proposta confermata: stessi valori, `proposalToken`, `confirmed: true` |

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
