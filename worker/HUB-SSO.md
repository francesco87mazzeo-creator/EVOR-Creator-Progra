# EVORΛ HUB → COLLECTIVE reale

Ramo `implementation/hub-passkey-sso`, baseline `main` `eb21bb6b81d2b99007dfc0a7fc6620741b7c2bde`.
Controparte HUB: `evora-social-analytics`, ramo `implementation/hub-passkey-firebase`.
Decisione del founder (31 ottobre 2026): l'HUB attuale
(`evora-hub-auth-test.francesco87-mazzeo.workers.dev`, stesse passkey) diventa l'autorità di accesso.

## Perché non le route `/admin/hub-sso/*` sul dominio

`collective.evorafitness.it` è servito direttamente da GitHub Pages (DNS sugli IP GitHub, `Server: GitHub.com`):
nessuna route Cloudflare è possibile senza cambiare il DNS. Inoltre l'HUB usa il progetto Firebase
`evora-hub-auth-test`, mentre il gestionale usa `evora-athletes`: un custom token dell'HUB non vale qui.

## Flusso

1. HUB → «COLLECTIVE» apre `https://collective.evorafitness.it/admin/?hub=start`.
2. `public/hub-sso-client.js` genera `state` e `verifier` PKCE, li tiene solo nel `sessionStorage` della scheda
   e va su `HUB/authorize?client=collective-real&state&challenge`.
3. L'HUB (utente con passkey/sessione persistente) crea un codice monouso di 60 s legato a utente,
   versione e challenge, e torna a `https://collective.evorafitness.it/admin/#hub_code=…&hub_state=…`.
   Il frammento non arriva mai a GitHub Pages, CDN o Referer; la pagina lo cancella subito.
4. La pagina verifica `state` (stessa scheda, massimo 5 minuti) e invia `code`+`verifier` al Worker
   `POST /hub-sso/exchange` (CORS solo `collective.evorafitness.it`, nessun cookie).
5. Il Worker riscatta il codice tramite il service binding privato `HUB_IDENTITY`
   (`/internal/collective/exchange`) e conia con il **proprio** service account un custom token
   `evora-athletes` per l'UID personale HUB: claim `role` (admin/manager), `evoraHub: true`, `evoraVersion`.
6. La pagina fa `signInWithCustomToken`: Rules e funzioni esistenti leggono `role` come oggi.

Controlli continui: `POST /hub-sso/status` (al focus e ogni 60 s) e gli endpoint `/admin/*` verificano
la firma `evora-athletes` e poi chiedono all'HUB se lo stesso UID/ruolo/versione è ancora attivo.
Diniego esplicito → logout locale e invalidazione dei refresh token `evora-athletes` di quella persona.
Errore di rete → nessuna estensione, nuovo controllo più tardi. `POST /hub-sso/logout` → revoca
globale nell'HUB e invalidazione Firebase.

## Invariato

Modulo pubblico, `/applications`, OCR, notifiche, candidature, impostazioni, scoring, Rules, Secrets.
**Login con codice (`/auth`, UID `staff-admin`/`staff-manager`) resta la procedura di recupero**, con il
suo limite di 8 ore, finché il nuovo accesso non è verificato.

## Limiti

- Le Rules non verificano la revoca: un ID token già emesso può restare valido fino a circa 1 ora.
- L'invalidazione Firebase richiede che il service account possa aggiornare gli account
  (`accounts:update`); se non può, il logout HUB funziona comunque e la risposta riporta `firebaseRevoked: false`.
- Al primo accesso Firebase crea in `evora-athletes` gli utenti con gli UID HUB personali.

## Test

`node --test worker/test/hub-sso.test.mjs test/hub/client.test.mjs` più le suite esistenti
(Worker 204, frontend 234, browser 103, server 310, contratti 21, repository 11).

## Backup e rollback

- Backup dati in sola lettura: `tools/backup-firestore-readonly.py` in Cloud Shell (solo conteggi a schermo).
- Worker: versione attiva prima del rilascio `51156046-b575-4175-b28c-9ad6c15c3bb9` → `wrangler rollback`.
- Frontend: revert del merge su `main` (GitHub Pages ripubblica la versione precedente).
- HUB: versione precedente `33daff63-3d0b-4c70-8f8c-5e3aab6a2c2f`.
- Il rollback del codice non revoca sessioni già emesse: revocare dall'HUB (Admin) se necessario.
