# MCP: collaudo isolato Cloudflare + ChatGPT

## Stato e confini

Stato al 2026-11-05: prerequisiti completati sul solo progetto `evora-mcp-staging` (identità HUB di test, 8 candidature sintetiche e configurazione scoring v3 caricate con `scripts/seed-staging.mjs`), `MCP_ENABLED=1` nel solo file staging, deploy dei tre Worker staging autorizzato. Nessun servizio di produzione modificato. Gli esiti locali non certificano binding, IAM, quote o disponibilità ChatGPT reali.

Il profilo dedicato usa esclusivamente il progetto `evora-mcp-staging`. Non riutilizzare `evora-athletes`, il vecchio HUB test (collegato a servizi attivi), credenziali di produzione o copie di candidature reali. Riutilizzare account Cloudflare/Firebase esistenti è possibile; verificare prima disponibilità, quote gratuite e policy. Nessun servizio a pagamento viene attivato da questi file.

| Componente | Configurazione | Destinazione |
|---|---|---|
| HUB OAuth e identità | repository HUB: `apps/hub/wrangler.mcp-staging.jsonc` | `evora-hub-mcp-staging` |
| Facade privata | `worker/wrangler.mcp-staging.jsonc` | `evora-collective-mcp-read-staging` |
| Server MCP | `integrations/collective-mcp/wrangler.staging.jsonc` | `evora-collective-mcp-staging` |

La facade non ha URL pubblico né endpoint applicazioni/OCR/scoring. Il server MCP non possiede una service account. I binding HUB e facade devono attestare profilo/progetto staging prima di qualsiasi introspezione o query. Progetto, audience e issuer errati bloccano le richieste, senza fallback. Le attestazioni verificano errori di collegamento; IAM deve anche impedire alle credenziali staging di leggere altri progetti.

## Prerequisiti da completare prima del deploy

1. Verificare o predisporre **solo** il progetto isolato sopra indicato, database e app Web; sostituire `__STAGING_WEB_API_KEY__` nella configurazione HUB con la chiave pubblica della relativa app. Non usare configurazioni di altre app. Il placeholder impedisce il collaudo login completo.
2. Predisporre identità personali **di test**, senza copiare identità/dati di produzione. Il Founder autorizzato è l'UID esatto dell'identità di test configurata, non un generico ruolo admin. Per provisioning HUB usare il suo operatore esistente con configurazione privata fuori repository: `operator:preflight` non effettua chiamate di rete; l'applicazione richiede approvazione esplicita, conferma progetto e verifica Rules/quote. L'operatore richiede due identità sintetiche (admin e manager). Non usare gli script legacy che fissano il vecchio HUB test né il bootstrap local-demo.
3. Configurare soltanto sui tre nuovi Worker i Secret sotto elencati tramite gestione sicura Cloudflare. Non inserirli nel codice, negli argomenti dei comandi, nei log o in ChatGPT. Nessun Secret è contenuto nelle configurazioni versionate.

| Worker | Secret necessari |
|---|---|
| HUB staging | `FIREBASE_SERVICE_ACCOUNT` del progetto staging, `MCP_OAUTH_FOUNDER_UID`, `MCP_OAUTH_SIGNING_JWK` (EC P-256 privata) |
| Facade staging | `FIREBASE_SERVICE_ACCOUNT` staging in sola lettura, `MCP_FOUNDER_UID`, `MCP_PRIVATE_SHARED_KEY` |
| MCP staging | `MCP_FOUNDER_UID`, `MCP_PRIVATE_SHARED_KEY` |

I tre UID devono indicare lo stesso Founder di test. La chiave privata di canale coincide soltanto tra facade e MCP staging ed è distinta da qualsiasi chiave online. Riutilizziamo il **nome esistente** `FIREBASE_SERVICE_ACCOUNT`, senza creare un alias di credenziale. Preferire account di servizio staging con permessi distinti: HUB per Auth/registro OAuth, facade con sola lettura Firestore. Le credenziali non devono avere accesso al progetto produzione. OAuth scrive soltanto il suo stato nel progetto staging; i tool non scrivono candidature.

4. Inserire esclusivamente fixture sintetiche e configurazioni di test. Verificare IAM, Rules del progetto di test e permessi delle service account separatamente. Nessuna modifica alle Rules produzione è necessaria.
5. Prima dell'attivazione cambiare **soltanto nelle configurazioni staging** `HUB_MCP_OAUTH_ENABLED` e `MCP_ENABLED` da `0` a `1`, dopo avere controllato i prerequisiti. I file sono volutamente disabilitati per impostazione iniziale. Le variabili dichiarate nei file prevalgono durante deploy anche con `--keep-vars`: non affidarsi a una modifica manuale del solo pannello.

## Verifiche locali riproducibili

Con Node 24.22.1 e dipendenze installate, dal repository COLLECTIVE:

```sh
node integrations/collective-mcp/scripts/check-staging.mjs /percorso/HUB/apps/hub/wrangler.mcp-staging.jsonc
node integrations/collective-mcp/scripts/test-hub-integration.mjs /percorso/HUB
node --test integrations/collective-mcp/test/*.test.mjs worker/test/mcp-entrypoint.test.mjs
```

Il test incrociato usa le implementazioni effettive OAuth/MCP/facade, chiavi effimere e REST simulato. Ogni fetch imprevista fallisce; nessuna rete reale o credenziale personale. Verifica tre tool, proiezioni, progetto isolato e revoca della famiglia dopo replay. Non equivale a un test Cloudflare end-to-end.

## Pubblicazione staging, solo dopo autorizzazione separata

Ordine: build HUB e Worker HUB staging, facade privata staging, server MCP staging. Usare esclusivamente i tre file di configurazione della tabella con Wrangler 4.149.0; fare prima `deploy --dry-run`, poi eventualmente `deploy --keep-vars`. **Non usare i wrangler di produzione**. I dry-run non installano i Secret, non verificano IAM e non provano la presenza dei servizi remoti. Registrare Version ID e verificare i binding reali dopo ogni passo.

## Collaudo ChatGPT

1. Verificare sul proprio account/workspace la disponibilità effettiva di app MCP personalizzate con OAuth e le policy amministrative. La sola presenza di un pulsante non dimostra l'abilitazione.
2. Controllare discovery OAuth, protected-resource metadata e JWKS pubbliche: issuer e resource devono essere i due URL staging configurati; nessun parametro privato `d` nelle JWKS. Una richiesta MCP senza token deve ottenere 401, senza dati.
3. Aggiungere il connettore con URL `https://evora-collective-mcp-staging.francesco87-mazzeo.workers.dev/mcp` e OAuth. Non inserire bearer statici o password condivise. L'allowlist corrente richiede client `https://chatgpt.com/oauth/client.json` e callback ChatGPT `https://chatgpt.com/connector_platform_oauth_redirect`: se il client reale richiede identificativi differenti, fermarsi e revisionare esplicitamente l'allowlist; non aprirla indiscriminatamente.
4. Autenticarsi esclusivamente nel HUB staging con l'identità Founder di test, completare consenso e PKCE S256; provare i tre strumenti sui soli dati sintetici. Controllare limiti, ordinamento e assenza di dati personali/screenshot.
5. Verificare rifiuto di manager e di un altro admin non Founder, scope/audience errati, token scaduto e accesso revocato. Con client OAuth di test, verificare rotazione e replay: il refresh consumato deve invalidare access e refresh di tutta la famiglia, lasciando intatte altre famiglie. Non copiare token in chat/log.
6. Verificare persistenza dopo riavvio/versione nuova e concorrenza reale. In caso di errore disabilitare solo i nuovi servizi staging; non intervenire sui servizi online esistenti.

## Limiti residui

Non sono stati verificati l'esistenza del nuovo progetto, i permessi Cloudflare/IAM, i Secret gestiti, la disponibilità ChatGPT o il collaudo browser remoto. Il profilo staging disabilita catalogo e redirect SSO verso applicazioni: non è una seconda HUB operativa. La revoca della famiglia è persistente, scadenza assoluta sette giorni; access token massimo cinque minuti con introspezione. Lo stato conserva solo hash dei refresh consumati, con capacità limitata e rifiuto sicuro al raggiungimento del limite.
