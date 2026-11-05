# MCP: percorso pilota di produzione (dati reali, sola lettura)

Stato: codice e configurazioni pronti sul branch `feature/mcp-production`. Nessuna risorsa cloud creata, nessun deploy.

Stessa logica OAuth e MCP già verificata su EVORΛ COLLECTIVE — TEST; cambiano solo nomi, progetti e il profilo `production`. Lo staging resta invariato (`STAGING.md`).

## Componenti

| Componente | Configurazione | Worker | Progetto |
|---|---|---|---|
| HUB OAuth e identità | repository HUB: `apps/hub/wrangler.mcp.jsonc` (profilo `mcp`) | `evora-hub-mcp` | `evora-hub-mcp` (nuovo, solo identità e stato OAuth) |
| Facade di sola lettura | `worker/wrangler.mcp-production.jsonc` | `evora-collective-mcp-read` (senza URL pubblico) | `evora-athletes`, sola lettura |
| Server MCP | `integrations/collective-mcp/wrangler.production.jsonc` | `evora-collective-mcp` | nessuna credenziale Google |

- **Separazione:**
  - **Worker di produzione:** `throbbing-feather-957f` e il suo `wrangler.toml` non cambiano, e il facade non usa il suo account di servizio.
  - **Database:** l'HUB non conosce `evora-athletes` e non scrive mai nel database COLLECTIVE.
- **Attestazioni:** ogni Worker controlla, prima di qualunque token o lettura, il profilo dei Worker collegati.
  - Il server MCP accetta solo un HUB `mcp` del progetto `evora-hub-mcp`, all'URL `evora-hub-mcp`.
  - Il server MCP accetta solo il facade `production` su `evora-athletes`.
  - Staging, prototipo senza profilo e produzione non possono essere scambiati tra loro.
- **Dati restituiti:** la stessa proiezione di `server/collective/mcp-read-policy.mjs`. Contiene date, stato, metriche, punteggi, letture OCR numeriche e correzioni. Non contiene mai nomi, contatti, handle, note, valutazioni, codici creator o screenshot.
- **Riuso per Instagram Analytics:** l'HUB `evora-hub-mcp` è il punto unico previsto. Oggi emette token solo per la risorsa COLLECTIVE. Aggiungere `analytics:read` richiede la modifica OAuth multi-risorsa pianificata a parte.

## Prerequisiti (richiedono autorizzazione)

1. **Progetto Firebase `evora-hub-mcp`:**
   - Firestore e Authentication attivi;
   - un'app Web, la cui chiave pubblica sostituisce `__PRODUCTION_WEB_API_KEY__` nella configurazione HUB;
   - Rules `allow read, write: if false`;
   - account di servizio `evora-hub-mcp` con il ruolo personalizzato dello staging: `datastore.entities.get/create/update` e `firebaseauth.users.get/update`.
2. **Identità Founder** nel progetto `evora-hub-mcp`, creata con l'operatore HUB. Gli inviti e la passkey vanno rifatti, perché sono separati dallo staging.
3. **Account di servizio `evora-mcp-read@evora-athletes`:**
   - ruolo personalizzato con solo `datastore.entities.get` e `datastore.entities.list`;
   - una chiave, usata solo come Secret del facade.
4. **Secret**, nuovi e distinti da quelli dello staging:

   | Worker | Secret |
   |---|---|
   | HUB | `FIREBASE_SERVICE_ACCOUNT` (`evora-hub-mcp`), `MCP_OAUTH_FOUNDER_UID`, `MCP_OAUTH_SIGNING_JWK` (nuova chiave) |
   | Facade | `FIREBASE_SERVICE_ACCOUNT` (`evora-mcp-read`), `MCP_FOUNDER_UID`, `MCP_PRIVATE_SHARED_KEY` (nuova) |
   | Server MCP | `MCP_FOUNDER_UID`, `MCP_PRIVATE_SHARED_KEY` |

## Verifiche

Locali, senza rete:

```sh
node integrations/collective-mcp/scripts/check-production.mjs /percorso/HUB/apps/hub/wrangler.mcp.jsonc
node integrations/collective-mcp/scripts/test-hub-integration.mjs /percorso/HUB --profile=production
node --test integrations/collective-mcp/test/*.test.mjs worker/test/mcp-entrypoint.test.mjs
```

Dopo la creazione dell'account di sola lettura, e prima del deploy, esegui `scripts/scan-production-projection.mjs <chiave privata>`. È in sola lettura e riporta solo conteggi, tipi, pattern sospetti (email, URL, handle, immagini, numeri di telefono) e i permessi effettivi dell'account.

## Pubblicazione e ripristino

- **Ordine:** `evora-hub-mcp`, poi `evora-collective-mcp-read`, poi `evora-collective-mcp`.
- **Come pubblicare:** Wrangler 4.149.0, `--dry-run` prima, Secret con `--secrets-file` da una cartella privata.
- **Collegamento in ChatGPT:** un nuovo collegamento verso `https://evora-collective-mcp.francesco87-mazzeo.workers.dev/mcp`, separato da EVORΛ COLLECTIVE — TEST.
- **Ripristino:** eliminare i tre Worker e disattivare la chiave `evora-mcp-read`. La produzione COLLECTIVE non è mai coinvolta.
