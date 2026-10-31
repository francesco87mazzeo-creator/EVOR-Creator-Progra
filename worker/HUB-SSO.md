# Adattamento opzionale EVORΛ HUB — nessun rilascio eseguito

Ramo `implementation/hub-passkey-sso`, baseline COLLECTIVE `eb21bb6b81d2b99007dfc0a7fc6620741b7c2bde`.
Controparte Social Analytics: ramo `implementation/hub-passkey-firebase`, report `docs/hub-auth/18-persistent-firebase-hub-first-block.md`.

## Modifiche

- `src/hub-sso.mjs`: proxy same-origin limitato a `/admin/hub-sso/{start,callback,complete,status,logout}` e verifica privata dell'identità HUB.
- `src/worker.js`: conserva firma/provider/ruolo dei JWT e permessi amministrativi; per `evoraHub: true` verifica sempre account/versione/ruolo nel servizio privato. Nessun ripiego legacy se il servizio manca o nega l'accesso. Il vecchio login di emergenza mantiene il comportamento e limite temporale preesistente.
- `../public/hub-sso-client.js`: Firebase LOCAL, scambio same-origin senza token nell'URL, signOut dell'identità precedente PRIMA del nuovo SSO, UID/ruolo verificati prima del montaggio. Controllo server al focus e ogni 60 secondi, senza timeout di inattività.
- `../admin/index.html`, `../app/admin-main.jsx`, `../app/admin.jsx`: bootstrap amministrativo attende la verifica; cambio utente pulisce il precedente ruolo/pannello. Compatibilità vecchi asset e login legacy conservata. Generatore rollback `tools/frontend-mode.mjs` aggiornato per non perdere la guardia.
- Nessuna modifica a modulo pubblico, candidature, configurazione Firebase, Rules, wrangler, Secrets o dati.

## Configurazione futura, solo previa autorizzazione

Sul Worker COLLECTIVE servono due Service Binding (nessun fallback a endpoint pubblico):

```toml
[[services]]
binding = "HUB_IDENTITY"
service = "NOME_WORKER_HUB_DA_APPROVARE"
entrypoint = "HubIdentityService"

[[services]]
binding = "HUB_COLLECTIVE"
service = "NOME_WORKER_HUB_DA_APPROVARE"
entrypoint = "HubCollectiveService"
```

Occorre instradare SOLO `https://collective.evorafitness.it/admin/hub-sso/*` al Worker COLLECTIVE: GET start/callback, POST complete/status/logout. Verificare DNS/proxy/hosting attuale prima di scegliere la route. Non cambiare routing del modulo pubblico né l'endpoint Worker esistente. Registrare in Firebase i due UID individuali Admin/Manager; niente UID legacy condivisi e nessuna modifica alle candidature. Configurazione/provisioning nel report HUB, non ancora eseguiti.

Il percorso metadati privati HUB `__evoraHub/registry` deve risultare negato ai client dalle Rules effettivamente pubblicate prima di usarlo. Non applicare B1, Rules sperimentali o correzioni Insights durante questo collegamento.

## Verifiche eseguite

- 204 test Worker/nuove integrazioni: superati.
- 567 test contratti/repository: superati, 2 esclusioni preesistenti.
- 103 test browser COLLECTIVE: superati, modulo pubblico incluso; rete Firebase simulata nella suite esistente.
- Nella controparte HUB: 435 test automatici e 13 browser superati; 1 duplicazione mobile esclusa. Auth Emulator reale e autenticatore WebAuthn virtuale; non Firebase o passkey fisiche di produzione.

Test nuove integrazioni:

```sh
node --test worker/test/hub-sso.test.mjs test/hub/client.test.mjs
```

Prima del rilascio provare entrambe le identità, cambio Admin→Manager sul medesimo browser, Manager negato a impostazioni e endpoint Admin, replay, errore binding, sessione persistente, revoca, login d'emergenza e form pubblico. Verificare dispositivi/HTTPS e quote reali. Non eseguiti emulatori Firestore né verifica delle Rules pubblicate.

## Limiti e rollback

La revoca è verificata live dal Worker e dalle API HUB. **Non è istantanea per richieste dirette Firestore con ID token già emesso**: può servire la scadenza tecnica (~1 ora); listener già aperti e dati scaricati hanno ulteriori limiti. Il polling client non sostituisce controlli server. F1 e problemi Insights restano backlog separato.

Rollback: ripristinare bundle admin e Worker della baseline, preservare login legacy e candidature. Revocare le nuove identità tramite procedura autorizzata; ripristinare il codice da solo non revoca ID token già emessi. Nessuna cancellazione automatica dei dati o degli utenti.
