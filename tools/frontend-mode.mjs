// Modalità del frontend (frontend-mode.json): "separated" (pagina pubblica + admin/) oppure "single-page" (ripristino).
// Il ripristino ricostruisce la pagina unica di prima con il codice ATTUALE dei moduli app/: torna indietro solo il modo
// di caricamento delle pagine, non il codice, quindi gli stessi test continuano a valere.
// Uso dalla radice:  node tools/frontend-mode.mjs            mostra la modalità e verifica le pagine
//                    node tools/frontend-mode.mjs single-page  scrive index.html e admin/index.html (pagina unica,
//                                                             che in admin/ apre l'area staff) e frontend-mode.json;
//                                                             da rieseguire dopo ogni modifica di app/ durante il ripristino
// Nessuna pagina del ripristino reindirizza: /#admin e /admin/ aprono entrambe l'area staff, con pagine vecchie o nuove.
// Ritorno alla separazione: vedi docs/separazione-pubblico-admin.md (pagine separate ripristinate e versioni aggiornate).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
export const MODES = Object.freeze(['separated', 'single-page']);
export const mode = () => {
  const { mode } = JSON.parse(read('frontend-mode.json'));
  if (!MODES.includes(mode)) throw new Error(`frontend-mode.json: modalità non valida ${mode}`);
  return mode;
};

// Moduli inclusi nella pagina unica, nell'ordine di caricamento dell'area staff.
export const SINGLE_PAGE_MODULES = Object.freeze(['app/shared.jsx', 'app/public-form.jsx', 'app/admin.jsx']);

// Testata comune: identica a quella delle pagine separate (un test lo verifica finché la modalità è "separated").
export const HEAD_META = `<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#0E0E0E">
<meta name="description" content="EVORΛ COLLECTIVE — il Partner Program EVORΛ dedicato a creator, coach e personalità del mondo fitness.">`;
export const CDN_SCRIPTS = `<script crossorigin="anonymous" src="https://unpkg.com/react@18.3.1/umd/react.production.min.js" integrity="sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z"></script>
<script crossorigin="anonymous" src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js" integrity="sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1"></script>
<script crossorigin="anonymous" src="https://unpkg.com/@babel/standalone@8.0.9/babel.min.js" integrity="sha384-oJpZjIuMGCcIQit2zkOhJc2+2WU5dMctZy8SOBPXQLHOxfFoBOU0kUGJibl9KCbo"></script>`;
export const FIREBASE_SCRIPTS = `<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>`;
export const REGISTRY_SCRIPT = `<script>
// Registro dei moduli app/ eseguiti per intero (vedi la fine di ogni modulo).
const CollectiveModules = new Set();
</script>`;
export const FIREBASE_BOOTSTRAP = `<script>
/* ============================================================================
   FIREBASE — selezione atomica Worker/Firebase prima di inizializzare SDK.
   localhost: staging · sito pubblico: progetto originale · candidature, settings
   ========================================================================== */
const environment = CollectiveEnvironment.current;
const firebaseConfig = environment.firebase;
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
// La sessione non sopravvive alla chiusura della scheda.
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(()=>{});
</script>`;

// Router della pagina unica: quello di index.html prima della separazione (main @ eec5d29). Unica aggiunta:
// la stessa pagina servita da admin/ apre direttamente l'area staff, senza reindirizzamenti. Così nessuna
// combinazione di pagine vecchie e nuove in cache può rimbalzare tra /#admin e /admin/.
export const SINGLE_PAGE_ROUTER = `/* ============================================================================
   16. APP — pagina unica (ripristino): pubblico e area staff, che si apre con /#admin oppure da /admin/
   ========================================================================== */
function App(){
  const onAdminPath = /\\/admin\\/(index\\.html)?$/.test(window.location.pathname);
  const routeFromHash = () => (onAdminPath || (window.location.hash||"").toLowerCase()==="#admin") ? "admin" : "landing";
  const [view,setView] = useState(routeFromHash);
  // Dati raccolti nello step di verifica screenshot, passati al form vero e proprio.
  const [precheckData,setPrecheckData] = useState(null);

  // L'accesso staff esiste solo come indirizzo diretto: /#admin
  useEffect(()=>{
    const onHash = () => {
      const r = routeFromHash();
      setView(v => (r==="admin" || v==="admin") ? r : v);
    };
    window.addEventListener("hashchange", onHash);
    return ()=>window.removeEventListener("hashchange", onHash);
  },[]);

  useEffect(()=>{ window.scrollTo(0,0); },[view]);

  const goHome = () => {
    // Da admin/ si torna alla pagina pubblica, come nella modalità separata.
    if(onAdminPath){ window.location.href = "../"; return; }
    if(window.location.hash) history.replaceState(null,"",window.location.pathname+window.location.search);
    setView("landing");
    setPrecheckData(null);
  };

  return (
    <>
      {view==="landing"   && <Landing onApply={()=>setView("precheck")}/>}
      {view==="precheck"  && <InstagramPreCheck onBack={()=>setView("landing")}
                                onComplete={(data)=>{ setPrecheckData(data); setView("apply"); }}/>}
      {view==="apply"     && <ApplicationForm onBack={goHome} precheckData={precheckData}/>}
      {view==="apply-test"&& <ApplicationForm onBack={()=>setView("admin")} testMode={true}/>}
      {view==="admin"     && <AdminPanel onBack={goHome} onTestForm={()=>setView("apply-test")}/>}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);`;

/**
 * Pagina unica: stessi script, stili e moduli di oggi, in un solo documento come prima della separazione.
 * admin: la stessa pagina per admin/index.html (percorsi "../", noindex), che apre l'area staff senza reindirizzare.
 */
export function buildSinglePage({ admin = false } = {}) {
  const modules = SINGLE_PAGE_MODULES.map(m => read(m).trimEnd()).join('\n\n');
  const base = admin ? '../' : '';
  return `<!DOCTYPE html>
<html lang="it">
<head>
${HEAD_META}
${admin ? '<meta name="robots" content="noindex, nofollow">\n<title>EVORΛ COLLECTIVE — Area riservata</title>' : '<title>EVORΛ COLLECTIVE — Partner Program</title>'}

<!-- Pagina unica (ripristino, frontend-mode.json = "single-page"): generata da tools/frontend-mode.mjs. Non modificare a mano. -->
<script src="${base}public/worker-config.js"></script>
<script src="${base}public/applications-client.js"></script>
<script src="${base}public/admin-scoring-client.js"></script>
${CDN_SCRIPTS}
${FIREBASE_SCRIPTS}
<style>
${read('app/styles.css').trimEnd()}
</style>
</head>
<body>
<div id="root"></div>

${REGISTRY_SCRIPT}

${FIREBASE_BOOTSTRAP}

<script type="text/babel">
${modules}

${SINGLE_PAGE_ROUTER}
</script>
</body>
</html>
`;
}

/** admin/ durante il ripristino: la pagina unica stessa, che apre l'area staff (nessun reindirizzamento). */
export const buildAdminPage = () => buildSinglePage({ admin: true });

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const target = process.argv[2];
  if (target === 'single-page') {
    // Idempotente: durante il ripristino rigenera le pagine dopo una modifica dei moduli app/.
    writeFileSync(new URL('index.html', root), buildSinglePage());
    writeFileSync(new URL('admin/index.html', root), buildAdminPage());
    writeFileSync(new URL('frontend-mode.json', root), JSON.stringify({ mode: 'single-page' }, null, 2) + '\n');
    console.log('Pagina unica scritta: index.html, admin/index.html (area staff), frontend-mode.json. app/ resta invariata.');
  } else if (target === undefined) {
    const current = mode();
    const ok = current === 'separated' || (read('index.html') === buildSinglePage() && read('admin/index.html') === buildAdminPage());
    console.log(`Modalità: ${current}${current === 'single-page' ? (ok ? ' (pagine allineate ai moduli app/)' : ' (PAGINE NON ALLINEATE: rieseguire il ripristino)') : ''}`);
    process.exitCode = ok ? 0 : 1;
  } else { console.error('Uso: node tools/frontend-mode.mjs [single-page]'); process.exit(2); }
}
