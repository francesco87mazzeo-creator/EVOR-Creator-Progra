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
if (REQUIRED_MODULES.every(m => CollectiveModules.has(m))) ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
else console.error("EVORΛ COLLECTIVE: moduli non caricati", REQUIRED_MODULES.filter(m => !CollectiveModules.has(m)));
