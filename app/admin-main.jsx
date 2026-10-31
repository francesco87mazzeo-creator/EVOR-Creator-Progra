/* app/admin-main.jsx — router dell'area staff: pannello e simulazione della candidatura (nessun invio). */
function App(){
  const [view,setView] = useState("admin");

  useEffect(()=>{ window.scrollTo(0,0); },[view]);

  // "Esci dall'area" riporta alla pagina pubblica.
  const goHome = () => { window.location.href = "../"; };

  return (
    <>
      {view==="admin"     && <AdminPanel onBack={goHome} onTestForm={()=>setView("apply-test")}/>}
      {view==="apply-test"&& <ApplicationForm onBack={()=>setView("admin")} testMode={true}/>}
    </>
  );
}

const REQUIRED_MODULES = ["app/shared.jsx","app/public-form.jsx","app/admin.jsx"];
const HUB_READY = typeof CollectiveHub === "undefined"
  ? (new URLSearchParams(location.search).get("sso") === "ready"
    ? auth.signOut().then(()=>{throw new Error("HUB bootstrap missing");}) : Promise.resolve())
  : CollectiveHub.ready;
if (REQUIRED_MODULES.every(m => CollectiveModules.has(m))) HUB_READY.then(()=>ReactDOM.createRoot(document.getElementById("root")).render(<App/>)).catch(()=>{document.getElementById("root").textContent="Accesso HUB non completato. Torna al portale e riprova.";});
else console.error("EVORΛ COLLECTIVE: moduli non caricati", REQUIRED_MODULES.filter(m => !CollectiveModules.has(m)));
