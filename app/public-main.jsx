/* app/public-main.jsx — router della pagina pubblica: landing, verifica Instagram, candidatura.
   L'area staff è una pagina separata (admin/): un suo errore non può bloccare la raccolta. */
function App(){
  const [view,setView] = useState("landing");
  // Dati raccolti nello step di verifica screenshot, passati al form vero e proprio.
  const [precheckData,setPrecheckData] = useState(null);

  // Indirizzo storico dello staff: /#admin porta ad admin/ anche se digitato a pagina aperta.
  useEffect(()=>{
    const onHash = () => { if((window.location.hash||"").toLowerCase()==="#admin") window.location.replace("admin/"); };
    window.addEventListener("hashchange", onHash);
    return ()=>window.removeEventListener("hashchange", onHash);
  },[]);

  useEffect(()=>{ window.scrollTo(0,0); },[view]);

  const goHome = () => {
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
    </>
  );
}

const REQUIRED_MODULES = ["app/shared.jsx","app/public-form.jsx"];
if (REQUIRED_MODULES.every(m => CollectiveModules.has(m))) ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
else console.error("EVORΛ COLLECTIVE: moduli non caricati", REQUIRED_MODULES.filter(m => !CollectiveModules.has(m)));
