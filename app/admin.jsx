/* app/admin.jsx — area staff: Firestore, accesso, Telegram, scoring e pannelli. Caricato solo da admin/
   Codice spostato senza modifiche da index.html (main @ eec5d29). */

/* ============================================================================
   2. FIRESTORE — collezioni e campi invariati
   ========================================================================== */
const FB = {
  async getApps(){
    const snap = await db.collection("candidature").orderBy("date","desc").get();
    return snap.docs.map(d=>({ id:d.id, ...d.data() }));
  },
  async updateApp(id, patch){
    await db.collection("candidature").doc(String(id)).update({ ...patch, updatedAt:new Date().toISOString() });
  },
  async deleteApp(id){
    await db.collection("candidature").doc(String(id)).delete();
  },
  async getScoring(){
    const doc = await db.collection("settings").doc("scoring").get();
    return doc.exists ? doc.data() : null;
  },
  async saveScoring(cfg){
    await CollectiveAdminScoring.saveScoring({endpoint:ADMIN_SCORING_URL,auth,config:cfg});
  }
};

/* ============================================================================
   2b. AUTENTICAZIONE STAFF
   Il codice viaggia verso il Worker, che lo confronta con i propri secret e
   restituisce un token Firebase contenente il ruolo. Il ruolo arriva quindi
   firmato dal server: modificarlo dal browser non produce alcun effetto,
   perché le regole Firestore leggono il claim del token, non lo stato React.
   ========================================================================== */
const AUTH = {
  async login(code){
    let res;
    try{
      res = await fetch(AUTH_URL, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ code })
      });
    }catch(e){ throw new Error("Servizio di accesso non raggiungibile."); }

    let data = {};
    try{ data = await res.json(); }catch(e){}

    if(res.status===401) throw new Error("Codice non riconosciuto.");
    if(res.status===429) throw new Error("Troppi tentativi. Riprova tra qualche minuto.");
    if(!res.ok || !data.token) throw new Error(data.error || "Accesso non riuscito.");

    // Timestamp PRIMA del login: onAuthStateChanged chiama subito currentRole(), che senza timestamp esegue il logout.
    localStorage.setItem("evora_login_at", String(Date.now()));
    let role;
    try{
      await auth.signInWithCustomToken(data.token);
      const t = await auth.currentUser.getIdTokenResult(true);
      role = t.claims.role;
    }catch(e){ await AUTH.logout(); throw new Error("Accesso non riuscito."); }
    if(role!=="admin" && role!=="manager"){
      await AUTH.logout();
      throw new Error("Ruolo non valido.");
    }
    sessionStorage.setItem("evora_last_role", role);
    return role;
  },

  /** Ruolo corrente letto dal token firmato, mai da uno stato locale. */
  async currentRole(){
    const u = auth.currentUser;
    if(!u) return null;
    const started = parseInt(localStorage.getItem("evora_login_at")||"0",10);
    if(!started || Date.now()-started > SESSION_HOURS*3600*1000){
      await AUTH.logout();
      return null;
    }
    try{
      const t = await u.getIdTokenResult();
      const r = t.claims.role;
      return (r==="admin"||r==="manager") ? r : null;
    }catch(e){
      // Errore di rete o refresh: non sloggo. Il claim precedente resta valido finché il timer non scade.
      console.warn("Verifica ruolo non riuscita, mantengo la sessione:", e);
      return sessionStorage.getItem("evora_last_role") || null;
    }
  },

  async logout(){
    localStorage.removeItem("evora_login_at");
    sessionStorage.removeItem("evora_last_role");
    try{ await auth.signOut(); }catch(e){}
  }
};

/* ============================================================================
   4. TELEGRAM — invariato
   ========================================================================== */
/**
 * Invia la notifica tramite il Worker: token e chat ID restano server-side.
 * Il browser non conosce né l'uno né l'altro.
 */
const sendTelegram = async (message) => {
  try{
    const res = await fetch(NOTIFY_URL, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ text: message })
    });
    return await res.json();
  }catch(e){ return { ok:false, description:e.message }; }
};

/* ============================================================================
   5. SOCIAL PERFORMANCE SCORE
   Valuta ESCLUSIVAMENTE i dati numerici Instagram.
   Nessuna analisi delle risposte, nessuna keyword, nessun giudizio automatico.
   ========================================================================== */
const SCORING_VERSION = 2;   // incrementare quando cambiano formule o benchmark predefiniti

const DEFAULT_SCORING = {
  version: SCORING_VERSION,
  // Le visualizzazioni vengono salvate e mostrate ma non entrano nel punteggio.
  weights: { er:45, reach:35, growth:20 },
  levels: [
    {v:"HIGH",    l:"Performance numerica alta",  min:75, c:"#3A7BD5"},
    {v:"GOOD",    l:"Performance numerica buona", min:55, c:"#27AE60"},
    {v:"AVERAGE", l:"Performance numerica media", min:35, c:"#E67E22"},
    {v:"LOW",     l:"Performance numerica bassa", min:0,  c:"#C0392B"}
  ],
  bands: [
    { label:"0–1K",     max:1000,
      er:{avg:3,good:6,excellent:10},    reach:{avg:60,good:120,excellent:250}, growth:{avg:1,good:3,excellent:7} },
    { label:"1K–5K",    max:5000,
      er:{avg:2.5,good:5,excellent:8},   reach:{avg:40,good:80,excellent:160},  growth:{avg:0.5,good:1.5,excellent:4} },
    { label:"5K–20K",   max:20000,
      er:{avg:2,good:4,excellent:7},     reach:{avg:30,good:60,excellent:120},  growth:{avg:0.3,good:1,excellent:3} },
    { label:"20K–100K", max:100000,
      er:{avg:1.5,good:3,excellent:5},   reach:{avg:20,good:40,excellent:80},   growth:{avg:0.15,good:0.5,excellent:1.5} },
    { label:"100K+",    max:Infinity,
      er:{avg:1,good:2,excellent:4},     reach:{avg:15,good:30,excellent:60},   growth:{avg:0.08,good:0.25,excellent:0.8} }
  ]
};

// Normalizza config salvate con lo schema precedente (tiers ELITE/PRO/...).
const normalizeScoring = (cfg) => {
  // Una configurazione salvata con lo schema precedente (formule e benchmark diversi)
  // non viene applicata: si riparte dai valori predefiniti aggiornati.
  // Il documento su Firestore resta invariato finché l'admin non salva di nuovo.
  if(!cfg || cfg.version !== SCORING_VERSION) return JSON.parse(JSON.stringify(DEFAULT_SCORING));
  const out = JSON.parse(JSON.stringify(DEFAULT_SCORING));
  if(cfg.weights) out.weights = { ...out.weights, ...cfg.weights };
  if(Array.isArray(cfg.bands) && cfg.bands.length){
    out.bands = cfg.bands.map((b,i)=>({
      label: b.label || out.bands[i] && out.bands[i].label || ("Fascia "+(i+1)),
      max:   (b.max===null || b.max===undefined) ? Infinity : b.max,
      er:    { ...out.bands[i] ? out.bands[i].er : {},     ...(b.er||{}) },
      reach: { ...out.bands[i] ? out.bands[i].reach : {},  ...(b.reach||{}) },
      growth:{ ...out.bands[i] ? out.bands[i].growth : {}, ...(b.growth||{}) }
    }));
    // Vecchio schema: soglia "poor" invece di "excellent"
    out.bands.forEach(b=>["er","reach","growth"].forEach(m=>{
      if(b[m].excellent===undefined && b[m].good!==undefined) b[m].excellent = b[m].good*2;
      if(b[m].avg===undefined) b[m].avg = (b[m].poor!==undefined ? b[m].poor : 0);
    }));
  }
  if(Array.isArray(cfg.levels) && cfg.levels.length) out.levels = cfg.levels;
  else if(Array.isArray(cfg.tiers) && cfg.tiers.length){
    const byMin = [...cfg.tiers].sort((a,b)=>b.min-a.min);
    out.levels = out.levels.map((lv,i)=> byMin[i] ? { ...lv, min:byMin[i].min } : lv);
  }
  return out;
};

const bandFor = (followers, cfg) =>
  cfg.bands.find(b => followers <= (b.max===null?Infinity:b.max)) || cfg.bands[cfg.bands.length-1];

// 4 livelli: <avg Scarso(0-25) · avg→good Medio(25-50) · good→excellent Buono(50-75) · >excellent Eccellente(75-100)
const normalizeMetric = (value, th) => {
  if(!th || value<=0) return 0;
  const {avg,good,excellent} = th;
  if(value >= excellent) return Math.min(100, 75 + ((value-excellent)/Math.max(excellent,0.01))*25);
  if(value >= good)      return 50 + ((value-good)/Math.max(excellent-good,0.01))*25;
  if(value >= avg)       return 25 + ((value-avg)/Math.max(good-avg,0.01))*25;
  return Math.max(0, (value/Math.max(avg,0.01))*25);
};

const METRIC_GRADES = [
  {min:75, l:"Eccellente", c:"#3A7BD5", bg:"rgba(58,123,213,.12)"},
  {min:50, l:"Buono",      c:"#27AE60", bg:"rgba(39,174,96,.12)"},
  {min:25, l:"Medio",      c:"#E67E22", bg:"rgba(230,126,34,.12)"},
  {min:0,  l:"Scarso",     c:"#C0392B", bg:"rgba(192,57,43,.12)"}
];
const gradeOf = s => METRIC_GRADES.find(g=>s>=g.min) || METRIC_GRADES[3];

/**
 * Calcola il Social Performance Score.
 * Ricalcolato a ogni lettura: modificare i benchmark aggiorna anche i profili storici.
 */
const computeSocial = (data, cfgRaw) => {
  const cfg = cfgRaw || DEFAULT_SCORING;
  const n = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
  const has = v => !(v===undefined || v===null || v==="");

  const followers    = n(data.followers);
  const views        = n(data.views);
  const interactions = n(data.interactions);
  // Compatibilità con le candidature precedenti:
  // se manca accountsReached si usano le visualizzazioni, se manca netFollowers si usa newFollowers.
  const reached = has(data.accountsReached) ? n(data.accountsReached) : views;
  const net     = has(data.netFollowers)    ? n(data.netFollowers)    : n(data.newFollowers);

  const band   = bandFor(followers, cfg);
  const er     = reached>0   ? (interactions/reached)*100 : 0;   // interazioni / account raggiunti
  const reach  = followers>0 ? (reached/followers)*100    : 0;   // account raggiunti / follower
  const growth = followers>0 ? (net/followers)*100        : 0;   // follower netti / follower

  const erScore     = normalizeMetric(er, band.er);
  const reachScore  = normalizeMetric(reach, band.reach);
  const growthScore = normalizeMetric(Math.max(growth,0), band.growth);

  const w  = cfg.weights;
  const tw = (+w.er||0)+(+w.reach||0)+(+w.growth||0) || 100;
  const socialScore = Math.round((erScore*(+w.er||0) + reachScore*(+w.reach||0) + growthScore*(+w.growth||0)) / tw);

  const level = [...cfg.levels].sort((a,b)=>b.min-a.min).find(l=>socialScore>=l.min) || cfg.levels[cfg.levels.length-1];

  return {
    socialScore,
    erScore:Math.round(erScore), reachScore:Math.round(reachScore), growthScore:Math.round(growthScore),
    er, reach, growth,
    views, reached, net, interactions, followers,
    erGrade:gradeOf(erScore), reachGrade:gradeOf(reachScore), growthGrade:gradeOf(growthScore),
    bandLabel:band.label, band,
    perfLevel:level.v, perfLabel:level.l, perfColor:level.c
  };
};

/* ============================================================================
   10. EXPORT CSV (compatibile Excel IT)
   ========================================================================== */
const exportCSV = (rows, cfg) => {
  const head = [
    "Data","Ultima modifica","Stato","Nome","Età","Email","Città","Paese","Categorie","Altra categoria",
    "Instagram","Follower IG","TikTok","Follower TikTok",
    "Visualizzazioni","Account raggiunti","Interazioni","Follower netti",
    "ER %","Reach %","Growth %","Social Performance Score","Livello performance","Fascia follower",
    "Valutazione interna","Brand Fit","Qualità contenuti","Credibilità","Affidabilità","Potenziale","Valore strategico",
    "Codice creator","Note interne",
    "Contenuto 1","Contenuto 2","Contenuto 3",
    "Tre parole","Tipo contenuti","Cosa trasmette","Perché lo seguono",
    "Collaborazioni","Dettagli collaborazioni",
    "Perché collaborazione credibile","Cosa apprezza","Come integrerebbe","Come racconterebbe",
    "Valore oltre i contenuti","Immagine del rappresentante",
    "Scenario contenuto brand","Periodo di prova","Reazione a contenuto sotto attese","Elementi analizzati","Significato rappresentare",
    "Contenuti/mese","Costanza","Linee guida","Eventi","Shooting","UGC per canali EVORΛ","File originali",
    "Prodotti acquistati","Miglioramenti","Nota finale","Consenso privacy"
  ];
  const line = a => {
    const s = computeSocial(a, cfg);
    const ev = a.evaluation || {};
    const vals = EVAL_CRITERIA.map(c=>ev[c.k]).filter(v=>typeof v==="number" && v>0);
    const avg = vals.length ? (vals.reduce((x,y)=>x+y,0)/vals.length).toFixed(2) : "";
    return [
      fmtDate(a.date), a.updatedAt?fmtDateTime(a.updatedAt):"", statusMeta(a.status).l,
      a.fullName, a.age, a.email, a.city, a.country||"", categoriesOf(a).map(catLabel).join(" | "), a.otherProfileCategory||"",
      a.instagram, a.followers, a.tiktok||"", a.tiktokFollowers||"",
      s.views, s.reached, s.interactions, s.net,
      s.er.toFixed(2), s.reach.toFixed(1), s.growth.toFixed(2), s.socialScore, s.perfLabel, s.bandLabel,
      avg, ev.brandFit||"", ev.contentQuality||"", ev.credibility||"", ev.reliability||"", ev.potential||"", ev.strategicValue||"",
      a.creatorCode||"", a.notes||"",
      a.contentUrl1||"", a.contentUrl2||"", a.contentUrl3||"",
      a.threeWords||"", a.contentType||"", a.whatToTransmit||"", a.whyFollow||"",
      a.hasBrandCollabs||"", a.brandCollabDetails||"",
      a.motivation||"", a.brandLike||"", a.contentIntegration||"", a.howWouldTell||"",
      a.valueBeyondContent||"", a.athleteImage||"",
      a.scenarioBrandContent||"", a.buildWithoutEarnings||"", a.badContentReaction||"", a.analysisElements||"", a.brandMeaning||"",
      a.contentPerMonth||"", a.hasRoutine||"", a.followsGuidelines||"",
      a.availEvents||"", a.availShooting||"", a.availUgc||"", a.availRawFiles||"",
      a.boughtProducts||"", a.improvements||"", a.extra||"",
      a.privacyConsent?"Sì":"No"
    ];
  };
  const esc = v => '"'+String(v===undefined||v===null?"":v).replace(/"/g,'""').replace(/\r?\n/g," ")+'"';
  const csv = "\uFEFF" + [head, ...rows.map(line)].map(r=>r.map(esc).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));
  const a = document.createElement("a");
  a.href=url; a.download="evora_collective_"+new Date().toISOString().slice(0,10)+".csv"; a.click();
  URL.revokeObjectURL(url);
};

/* ============================================================================
   11. PANNELLO CANDIDATURE
   ========================================================================== */
const FOLLOWER_BANDS = [
  {v:"b1",l:"0–1K",     min:0,      max:1000},
  {v:"b2",l:"1K–5K",    min:1001,   max:5000},
  {v:"b3",l:"5K–20K",   min:5001,   max:20000},
  {v:"b4",l:"20K–100K", min:20001,  max:100000},
  {v:"b5",l:"100K+",    min:100001, max:Infinity}
];
const PERF_FILTERS = [
  {v:"HIGH",l:"Alta"},{v:"GOOD",l:"Buona"},{v:"AVERAGE",l:"Media"},{v:"LOW",l:"Bassa"}
];
const DATE_FILTERS = [
  {v:"all",l:"Sempre"},{v:"7",l:"Ultimi 7 giorni"},{v:"30",l:"Ultimi 30 giorni"},{v:"90",l:"Ultimi 90 giorni"}
];
const PER_PAGE = 10;

function ApplicationsPanel({role, scoring}){
  const [apps,setApps]       = useState([]);
  const [sel,setSel]         = useState(null);
  const [loading,setLoading] = useState(true);
  const [loadErr,setLoadErr] = useState("");
  const [q,setQ]             = useState("");
  const [fStatus,setFStatus] = useState("all");
  const [fCat,setFCat]       = useState("all");
  const [fBand,setFBand]     = useState("all");
  const [fPerf,setFPerf]     = useState("all");
  const [fDate,setFDate]     = useState("all");
  const [fPlace,setFPlace]   = useState("");
  const [fCollab,setFCollab] = useState("all");
  const [fNotes,setFNotes]   = useState("all");
  const [sort,setSort]       = useState("date");
  const [page,setPage]       = useState(1);
  const [openFilters,setOpenFilters] = useState(false);

  const load = useCallback(()=>{
    setLoading(true);
    FB.getApps()
      .then(a=>{ setApps(a); setLoadErr(""); })
      .catch(()=> setLoadErr("Impossibile caricare le candidature. Verifica la connessione."))
      .finally(()=> setLoading(false));
  },[]);
  useEffect(()=>{ load(); },[load]);

  // Metriche ricalcolate a runtime con i benchmark correnti
  const enriched = useMemo(()=> apps.map(a=>({ ...a, _s:computeSocial(a,scoring), _status:normStatus(a.status) })), [apps,scoring]);

  const overdue = useMemo(()=> enriched.filter(a=> a._status==="new" && daysSince(a.date)>7), [enriched]);

  const filtered = useMemo(()=>{
    const needle = q.trim().toLowerCase();
    const place  = fPlace.trim().toLowerCase();
    return enriched.filter(a=>{
      if(fStatus!=="all" && a._status!==fStatus) return false;
      if(fCat!=="all" && (a.category||"")!==fCat) return false;
      if(fPerf!=="all" && a._s.perfLevel!==fPerf) return false;
      if(fBand!=="all"){
        const b = FOLLOWER_BANDS.find(x=>x.v===fBand); const n = parseInt(a.followers)||0;
        if(!(n>=b.min && n<=b.max)) return false;
      }
      if(fDate!=="all" && daysSince(a.date) > parseInt(fDate)) return false;
      if(place && !((a.city||"")+" "+(a.country||"")).toLowerCase().includes(place)) return false;
      if(fCollab!=="all" && (a.hasBrandCollabs||"")!==fCollab) return false;
      if(fNotes==="with" && !String(a.notes||"").trim()) return false;
      if(fNotes==="without" && String(a.notes||"").trim()) return false;
      if(needle){
        const hay = [a.fullName,a.email,a.instagram,a.tiktok,a.city].join(" ").toLowerCase();
        if(!hay.includes(needle)) return false;
      }
      return true;
    });
  },[enriched,q,fStatus,fCat,fBand,fPerf,fDate,fPlace,fCollab,fNotes]);

  const sorted = useMemo(()=>{
    const arr=[...filtered];
    const by = {
      date:      (a,b)=> new Date(b.date||0)-new Date(a.date||0),
      followers: (a,b)=> (parseInt(b.followers)||0)-(parseInt(a.followers)||0),
      score:     (a,b)=> b._s.socialScore-a._s.socialScore,
      er:        (a,b)=> b._s.er-a._s.er,
      reach:     (a,b)=> b._s.reach-a._s.reach,
      growth:    (a,b)=> b._s.growth-a._s.growth,
      views:        (a,b)=> b._s.views-a._s.views,
      reached:      (a,b)=> b._s.reached-a._s.reached,
      interactions: (a,b)=> b._s.interactions-a._s.interactions,
      net:          (a,b)=> b._s.net-a._s.net,
      name:      (a,b)=> String(a.fullName||"").localeCompare(String(b.fullName||""),"it")
    };
    return arr.sort(by[sort]||by.date);
  },[filtered,sort]);

  const pages = Math.max(1, Math.ceil(sorted.length/PER_PAGE));
  const cur   = Math.min(page,pages);
  const slice = sorted.slice((cur-1)*PER_PAGE, cur*PER_PAGE);
  useEffect(()=>{ setPage(1); },[q,fStatus,fCat,fBand,fPerf,fDate,fPlace,fCollab,fNotes,sort]);

  const counts = useMemo(()=>{
    const c={ total:enriched.length, new:0, review:0, shortlist:0, watchlist:0, approved:0, rejected:0 };
    enriched.forEach(a=>{ if(c[a._status]!==undefined) c[a._status]++; });
    return c;
  },[enriched]);

  const resetFilters = ()=>{ setQ("");setFStatus("all");setFCat("all");setFBand("all");setFPerf("all");setFDate("all");setFPlace("");setFCollab("all");setFNotes("all"); };
  const activeFilters = [fStatus,fCat,fBand,fPerf,fDate,fCollab,fNotes].filter(v=>v!=="all").length + (fPlace?1:0);

  const patchApp = async (id, data) => {
    await FB.updateApp(id, data);
    const stamped = { ...data, updatedAt:new Date().toISOString() };
    setApps(prev => prev.map(x => String(x.id)===String(id) ? {...x, ...stamped} : x));
    setSel(prev => prev && String(prev.id)===String(id) ? {...prev, ...stamped} : prev);
  };
  const removeApp = async (id) => {
    if(role!=="admin") return;
    await FB.deleteApp(id);
    setApps(prev => prev.filter(x => String(x.id)!==String(id)));
    setSel(null);
  };

  if(sel) return (
    <CandidateDetail app={sel} role={role} scoring={scoring}
      onBack={()=>setSel(null)} onPatch={patchApp} onDelete={removeApp}/>
  );

  if(loading) return (
    <div style={{padding:"70px 20px",textAlign:"center"}}>
      <div className="spinner" style={{width:26,height:26,margin:"0 auto 14px"}}/>
      <div className="label-xs">Caricamento candidature…</div>
    </div>
  );

  return (
    <div style={{flex:1,overflow:"auto"}}>
      {/* ALERT 7 GIORNI */}
      {overdue.length>0 && (
        <div style={{background:"rgba(230,126,34,.10)",borderBottom:"1px solid rgba(230,126,34,.4)"}}>
          <div className="wrap-panel" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"12px 16px",flexWrap:"wrap"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
              <div className="dot" style={{background:"var(--warn)"}}/>
              <div style={{minWidth:0}}>
                <div style={{fontFamily:"var(--fh)",fontWeight:700,fontSize:12,color:"var(--warn)",letterSpacing:".06em"}}>
                  {overdue.length===1 ? "1 candidatura in attesa da oltre 7 giorni" : overdue.length+" candidature in attesa da oltre 7 giorni"}
                </div>
                <div className="body-sm" style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {overdue.slice(0,4).map(a=>a.fullName||a.instagram).join(" · ")}{overdue.length>4?" …":""}
                </div>
              </div>
            </div>
            <button className="btn btn-sm" style={{background:"var(--warn)",color:"#111"}}
              onClick={()=>{resetFilters();setFStatus("new");setSort("date");}}>Vedi</button>
          </div>
        </div>
      )}

      {loadErr && (
        <div className="wrap-panel" style={{padding:"14px 16px"}}>
          <div className="status-box" style={{borderColor:"#B03A3A"}}>
            <div className="dot" style={{background:"var(--bad)",marginTop:6}}/>
            <div className="body-sm">{loadErr} <button className="nav-link" style={{background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}} onClick={load}>Riprova</button></div>
          </div>
        </div>
      )}

      {/* CONTATORI */}
      <div style={{borderBottom:"1px solid var(--brd)",background:"var(--bg-2)"}}>
        <div className="wrap-panel" style={{padding:0}}>
          <div style={{display:"flex",flexWrap:"wrap"}}>
            {[
              ["all","Totali",counts.total,"var(--t1)"],
              ["new","Nuove",counts.new,"#B22222"],
              ["review","In valutazione",counts.review,"#C0A060"],
              ["shortlist","Shortlist",counts.shortlist,"#3A7BD5"],
              ["watchlist","Da monitorare",counts.watchlist,"#7A6AD5"],
              ["approved","Approvate",counts.approved,"#27AE60"],
              ["rejected","Rifiutate",counts.rejected,"#8A2A2A"]
            ].map(([v,l,n,c])=>(
              <button key={v} className={"stat"+(fStatus===v?" stat-on":"")}
                style={{flex:"1 1 100px",minWidth:96}}
                onClick={()=>setFStatus(v)}>
                <div className="stat-n" style={{color:c}}>{n}</div>
                <div className="stat-l">{l}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* BARRA COMANDI */}
      <div style={{borderBottom:"1px solid var(--brd)"}}>
        <div className="wrap-panel" style={{padding:"12px 16px",display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <input style={{flex:"1 1 240px",padding:"11px 14px",fontSize:14}}
              placeholder="Cerca nome, email o username…" value={q} onChange={e=>setQ(e.target.value)} aria-label="Cerca"/>
            <select value={sort} onChange={e=>setSort(e.target.value)} style={{width:"auto",minWidth:150,padding:"11px 34px 11px 12px",fontSize:13}} aria-label="Ordina per">
              <option value="date">Più recenti</option>
              <option value="score">Social Score ↓</option>
              <option value="followers">Follower ↓</option>
              <option value="er">Engagement ↓</option>
              <option value="reach">Reach ↓</option>
              <option value="growth">Growth ↓</option>
              <option value="views">Visualizzazioni ↓</option>
              <option value="reached">Account raggiunti ↓</option>
              <option value="interactions">Interazioni ↓</option>
              <option value="net">Follower netti ↓</option>
              <option value="name">Nome A–Z</option>
            </select>
            <button className="btn btn-ghost btn-sm" onClick={()=>setOpenFilters(o=>!o)}>
              Filtri{activeFilters?" ("+activeFilters+")":""}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={()=>exportCSV(sorted,scoring)}>Esporta CSV</button>
          </div>

          {openFilters && (
            <div style={{border:"1px solid var(--brd)",background:"var(--bg-2)",padding:14}}>
              <div className="g3-gap">
                <Field label="Stato"><select value={fStatus} onChange={e=>setFStatus(e.target.value)}>
                  <option value="all">Tutti</option>
                  {STATUSES.map(s=><option key={s.v} value={s.v}>{s.l}</option>)}
                </select></Field>
                <Field label="Categoria"><select value={fCat} onChange={e=>setFCat(e.target.value)}>
                  <option value="all">Tutte</option>
                  {CATEGORIES.map(c=><option key={c.v} value={c.v}>{c.l}</option>)}
                </select></Field>
                <Field label="Fascia follower"><select value={fBand} onChange={e=>setFBand(e.target.value)}>
                  <option value="all">Tutte</option>
                  {FOLLOWER_BANDS.map(b=><option key={b.v} value={b.v}>{b.l}</option>)}
                </select></Field>
                <Field label="Performance numerica"><select value={fPerf} onChange={e=>setFPerf(e.target.value)}>
                  <option value="all">Tutte</option>
                  {PERF_FILTERS.map(p=><option key={p.v} value={p.v}>{p.l}</option>)}
                </select></Field>
                <Field label="Periodo"><select value={fDate} onChange={e=>setFDate(e.target.value)}>
                  {DATE_FILTERS.map(d=><option key={d.v} value={d.v}>{d.l}</option>)}
                </select></Field>
                <Field label="Città o Paese"><input value={fPlace} onChange={e=>setFPlace(e.target.value)} placeholder="Es. Milano"/></Field>
                <Field label="Collaborazioni precedenti"><select value={fCollab} onChange={e=>setFCollab(e.target.value)}>
                  <option value="all">Indifferente</option><option value="yes">Sì</option><option value="no">No</option>
                </select></Field>
                <Field label="Note interne"><select value={fNotes} onChange={e=>setFNotes(e.target.value)}>
                  <option value="all">Indifferente</option><option value="with">Con note</option><option value="without">Senza note</option>
                </select></Field>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={resetFilters}>Azzera filtri</button>
            </div>
          )}

          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span className="label-xs">{sorted.length} risultati</span>
            <Tip text={METRIC_LEGEND}/>
            <span className="body-sm" style={{fontSize:12}}>I colori indicano solo la performance numerica.</span>
          </div>
        </div>
      </div>

      {/* LISTA */}
      <div className="wrap-panel" style={{padding:"0 16px"}}>
        {slice.length===0 && (
          <div style={{padding:"60px 20px",textAlign:"center"}}>
            <div className="h-sm" style={{marginBottom:6}}>Nessuna candidatura</div>
            <div className="body-sm">Modifica i filtri o azzerali per vedere tutti i profili.</div>
          </div>
        )}

        {slice.map(a=>{
          const s=a._s, st=statusMeta(a._status), late = a._status==="new" && daysSince(a.date)>7;
          return (
            <button key={a.id} className="row" style={{borderLeftColor:s.perfColor}} onClick={()=>setSel(a)}>
              <div style={{padding:"13px 14px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                <div style={{flex:"1 1 190px",minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap",marginBottom:3}}>
                    <span style={{fontFamily:"var(--fh)",fontWeight:700,fontSize:14,color:"var(--t1)"}}>{a.fullName||"—"}</span>
                    <Badge color={st.c}>{st.l}</Badge>
                    {String(a.notes||"").trim() && <Badge color="#7A6AD5">Note</Badge>}
                  </div>
                  <div className="body-sm" style={{fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {(()=>{
                       const ig=socialLink(a,"instagram");
                       const cats=categoriesOf(a).slice(0,2).map(catLabel).join(", ");
                       return <>
                         {ig.handle
                           ? <a href={ig.url} target="_blank" rel="noopener noreferrer"
                                onClick={e=>e.stopPropagation()}
                                style={{color:"var(--info)",textDecoration:"none"}}>@{ig.handle}</a>
                           : "—"}
                         {cats?" · "+cats:""}{a.city?" · "+a.city:""}
                       </>;
                     })()}
                  </div>
                  <div className="label-xs" style={{marginTop:4,color:"var(--t3)",letterSpacing:".06em"}}>
                    Visual. {fmtShort(s.views)} · Raggiunti {fmtShort(s.reached)} · Interaz. {fmtShort(s.interactions)} · Netti {s.net>0?"+":""}{fmtShort(Math.abs(s.net))}
                  </div>
                  <div className="label-xs" style={{marginTop:3,color: late ? "var(--warn)" : "var(--t4)"}}>
                    {fmtDate(a.date)} · {agoLabel(a.date)}
                  </div>
                </div>

                <div style={{display:"flex",alignItems:"center",gap:14,flex:"1 1 320px",justifyContent:"flex-end"}}>
                  <div className="metric-cell" style={{minWidth:58}}>
                    <div className="metric-l">Follower</div>
                    <div className="metric-v" style={{color:"var(--t1)"}}>{fmtShort(a.followers)}</div>
                  </div>
                  {[["ER",s.er.toFixed(1)+"%",s.erGrade],["Reach",s.reach.toFixed(0)+"%",s.reachGrade],["Growth",s.growth.toFixed(2)+"%",s.growthGrade]].map(([l,v,g])=>(
                    <div className="metric-cell" key={l} style={{minWidth:58}}>
                      <div className="metric-l">{l}</div>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
                        <span className="dot" style={{background:g.c}}/>
                        <span className="metric-v" style={{color:g.c}}>{v}</span>
                      </div>
                    </div>
                  ))}
                  <ScoreRing value={s.socialScore} color={s.perfColor} size={46} label="SPS"/>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* PAGINAZIONE */}
      {pages>1 && (
        <div className="wrap-panel" style={{padding:"14px 16px 26px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
          <span className="label-xs">Pagina {cur} di {pages}</span>
          <div style={{display:"flex",gap:4}}>
            <button className="btn btn-ghost btn-sm" disabled={cur===1} onClick={()=>setPage(cur-1)}>‹</button>
            {Array.from({length:Math.min(5,pages)},(_,i)=>{
              let p;
              if(pages<=5) p=i+1; else if(cur<=3) p=i+1; else if(cur>=pages-2) p=pages-4+i; else p=cur-2+i;
              return <button key={p} className={"btn btn-sm "+(p===cur?"btn-primary":"btn-ghost")} onClick={()=>setPage(p)}>{p}</button>;
            })}
            <button className="btn btn-ghost btn-sm" disabled={cur===pages} onClick={()=>setPage(cur+1)}>›</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   12. SCHEDA CANDIDATURA
   ========================================================================== */
const ENUM_LABELS = {
  yes:"Sì", no:"No", maybe:"Da valutare", mostly:"Sì, con margine creativo", building:"La sto costruendo",
  yes_conditions:"Sì, entro condizioni definite", depends:"Dipende dal progetto", paid_only:"Preferisce compenso garantito",
  lt1:"Meno di 1 al mese", "1-2":"1–2 al mese", "3-4":"3–4 al mese", "5+":"5 o più",
  "3-5":"3–5 al mese", "6-10":"6–10 al mese", "10+":"10 o più"
};
const enumLabel = v => ENUM_LABELS[v] || (v || "—");

/** Categorie mostrate come badge multipli, con fallback al vecchio campo `category` singolo. */
const categoriesOf = a => {
  const list = Array.isArray(a.profileCategories) ? a.profileCategories.filter(Boolean) : [];
  if(list.length) return list;
  if(a.category)  return [a.category];
  return [];
};

/** Restituisce URL e handle "puliti" gestendo anche le candidature precedenti. */
const socialLink = (a, net) => {
  const url    = net==="tiktok" ? a.tiktokUrl    : a.instagramUrl;
  const handle = net==="tiktok" ? a.tiktokHandle : a.instagramHandle;
  const raw    = net==="tiktok" ? a.tiktok       : a.instagram;
  if(url && handle) return { url, handle };
  const p = parseSocial(raw, net);
  return p.handle ? { url:p.url, handle:p.handle } : { url:"", handle:"" };
};

function Section({title, children}){
  return (
    <section style={{marginBottom:24}}>
      <div className="eyebrow" style={{marginBottom:12}}>{title}</div>
      {children}
    </section>
  );
}
function QA({q,a}){
  if(!a) return null;
  return <div className="detail-block"><div className="detail-q">{q}</div><div className="detail-a">{a}</div></div>;
}
function KV({k,v,color}){
  return <div className="kv"><div className="kv-k">{k}</div><div className="kv-v" style={color?{color}:null}>{v||"—"}</div></div>;
}

function InsightsEditor({app, scoring, onPatch}){
  const [editing,setEditing] = useState(false);
  const [vals,setVals]       = useState({
    views:           String(app.views||""),
    netFollowers:    String(app.netFollowers!=null ? app.netFollowers : (app.newFollowers||"")),
    interactions:    String(app.interactions||""),
    accountsReached: String(app.accountsReached!=null ? app.accountsReached : (app.views||""))
  });
  const [note,setNote]     = useState("");
  const [busy,setBusy]     = useState(false);
  const [msg,setMsg]       = useState("");

  if(!editing) return (
    <div style={{marginTop:10}}>
      <button className="btn btn-ghost btn-sm" onClick={()=>setEditing(true)}>Correggi dati Insights</button>
      {app.insightsCorrection && (
        <div className="body-sm" style={{fontSize:12,marginTop:6,color:"var(--t3)"}}>
          Ultima correzione: {fmtDateTime(app.insightsCorrection.correctedAt)} da {app.insightsCorrection.correctedBy||"staff"}
        </div>
      )}
    </div>
  );

  const save = async () => {
    if(note.length>MANAGEMENT_LIMITS.insightsNote){ setMsg("La nota sulla correzione può contenere al massimo 2.000 caratteri. Riducila prima di salvare."); return; }
    setBusy(true); setMsg("");
    const num = v => { const x = parseInt(v,10); return Number.isFinite(x) ? x : 0; };
    const newVals = {
      views:           num(vals.views),
      netFollowers:    num(vals.netFollowers),
      interactions:    num(vals.interactions),
      accountsReached: num(vals.accountsReached)
    };
    const correction = {
      correctedAt: new Date().toISOString(),
      correctedBy: "staff",
      previousValues: {
        views:           parseInt(app.views)||0,
        netFollowers:    parseInt(app.netFollowers!=null ? app.netFollowers : app.newFollowers)||0,
        interactions:    parseInt(app.interactions)||0,
        accountsReached: parseInt(app.accountsReached!=null ? app.accountsReached : app.views)||0
      },
      newValues: newVals,
      note: note.trim()
    };
    // Ricalcola metriche con i nuovi valori
    const tempDoc = { ...app, ...newVals };
    const s = computeSocial(tempDoc, scoring);
    try{
      await onPatch(app.id, {
        ...newVals,
        insightsCorrection: correction,
        socialScore: s.socialScore,
        perfLevel:   s.perfLevel,
        erRate:      +s.er.toFixed(2),
        reachRate:   +s.reach.toFixed(2),
        growthRate:  +s.growth.toFixed(2)
      });
      setMsg("Dati aggiornati. Score ricalcolato: "+s.socialScore+"/100");
      setEditing(false);
    }catch(e){ setMsg("Errore nel salvataggio."); }
    finally{ setBusy(false); }
  };

  return (
    <div style={{marginTop:12,border:"1px solid var(--brd)",background:"var(--bg-2)",padding:16}}>
      <div className="h-sm" style={{marginBottom:6}}>Correzione dati Insights</div>
      <p className="body-sm" style={{fontSize:12,marginBottom:14,color:"var(--t3)"}}>
        Confronta sempre i valori con gli screenshot originali prima di correggerli.
        Dopo il salvataggio, metriche e Social Performance Score verranno ricalcolati automaticamente.
      </p>

      {app.ocrInsights && app.ocrInsights.conflicts && app.ocrInsights.conflicts.length>0 && (
        <div className="status-box" style={{borderColor:"rgba(230,126,34,.45)",marginBottom:12}}>
          <div className="dot" style={{background:"var(--warn)",marginTop:6}}/>
          <div className="body-sm" style={{fontSize:12}}>
            La lettura automatica ha rilevato incongruenze tra i due screenshot su: {app.ocrInsights.conflicts.map(c=>c.key).join(", ")}
          </div>
        </div>
      )}

      <div className="g2-gap">
        {[
          ["views","Visualizzazioni",""],
          ["netFollowers","Follower netti","Può essere negativo"],
          ["interactions","Interazioni",""],
          ["accountsReached","Account raggiunti",""]
        ].map(([k,l,hint])=>(
          <Field key={k} label={l} hint={hint||undefined}>
            <input type="number" inputMode={k==="netFollowers"?"text":"numeric"}
              value={vals[k]} onChange={e=>setVals(p=>({...p,[k]:e.target.value}))}/>
          </Field>
        ))}
      </div>

      <Field label="Nota sulla correzione (facoltativa)" hint="Massimo 2.000 caratteri.">
        <input value={note} maxLength={MANAGEMENT_LIMITS.insightsNote} onChange={e=>setNote(e.target.value)} placeholder="Es. Valore corretto dal secondo screenshot"/>
      </Field>

      <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
          {busy ? "Salvataggio…" : "Salva e ricalcola"}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={()=>setEditing(false)}>Annulla</button>
        {msg && <span className="label-xs" role="status" style={{color:msg.startsWith("Dati aggiornati.")?"var(--ok)":"var(--bad)"}}>{msg}</span>}
      </div>
    </div>
  );
}

function CandidateDetail({app, role, scoring, onBack, onPatch, onDelete}){
  const s  = computeSocial(app, scoring);
  const st = statusMeta(app.status);
  const [notes,setNotes]   = useState(app.notes||"");
  const [code,setCode]     = useState(app.creatorCode||"");
  const [evalv,setEvalv]   = useState(app.evaluation||{});
  const [busy,setBusy]     = useState("");
  const [msg,setMsg]       = useState("");
  const [msgError,setMsgError] = useState(false);

  const flash = (t,error=false) => { setMsg(t); setMsgError(error); setTimeout(()=>setMsg(""),2200); };

  const saveStatus = async v => { setBusy("status"); try{ await onPatch(app.id,{status:v}); flash("Stato aggiornato"); } finally{ setBusy(""); } };
  const saveNotes  = async () => { if(notes.length>MANAGEMENT_LIMITS.notes){ flash("Le note interne possono contenere al massimo 10.000 caratteri. Riducile prima di salvare.",true); return; } setBusy("notes");  try{ await onPatch(app.id,{notes}); flash("Note salvate"); } finally{ setBusy(""); } };
  const saveCode   = async () => { const normalized=code.trim().toUpperCase(); if(code.length>MANAGEMENT_LIMITS.creatorCode || normalized.length>MANAGEMENT_LIMITS.creatorCode){ flash("Il codice creator può contenere al massimo 120 caratteri, anche dopo la conversione in maiuscolo.",true); return; } setBusy("code");   try{ await onPatch(app.id,{creatorCode:normalized}); flash("Codice salvato"); } finally{ setBusy(""); } };
  const saveEval   = async () => {
    setBusy("eval");
    try{ await onPatch(app.id,{ evaluation:{ ...evalv, updatedAt:new Date().toISOString() } }); flash("Valutazione salvata"); }
    finally{ setBusy(""); }
  };

  const rated = EVAL_CRITERIA.map(c=>evalv[c.k]).filter(v=>typeof v==="number" && v>0);
  const evalAvg = rated.length ? (rated.reduce((a,b)=>a+b,0)/rated.length) : null;

  const links = [app.contentUrl1,app.contentUrl2,app.contentUrl3].filter(Boolean);

  return (
    <div style={{flex:1,overflow:"auto"}}>
      <div className="wrap-panel" style={{padding:"18px 16px 80px",maxWidth:940}}>
        <button className="btn btn-ghost btn-sm" onClick={onBack} style={{marginBottom:18}}>← Elenco candidature</button>

        {/* HEADER */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:14,flexWrap:"wrap",marginBottom:20}}>
          <div style={{minWidth:0,flex:"1 1 260px"}}>
            <h1 className="h-md" style={{marginBottom:6}}>{app.fullName||"—"}</h1>
            <div className="body-sm" style={{marginBottom:10}}>
              {app.email} · {app.city}{app.country?", "+app.country:""}{(()=>{ const c=categoriesOf(app); return c.length ? " · "+c.map(catLabel).join(", ") : ""; })()}
            </div>
            <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
              <Badge color={st.c} filled>{st.l}</Badge>
              <Badge color={s.perfColor}>{s.perfLabel}</Badge>
              <Badge color="#5A5A5A">Fascia {s.bandLabel}</Badge>
            </div>
          </div>
          <div style={{textAlign:"center"}}>
            <ScoreRing value={s.socialScore} color={s.perfColor} size={76} label="SPS"/>
            <div className="label-xs" style={{marginTop:6,maxWidth:110,lineHeight:1.3}}>Social Performance Score</div>
          </div>
        </div>

        {/* METRICHE */}
        <Section title={<span>Performance numerica</span>}>
          <div className="g3-keep" style={{marginBottom:10}}>
            <MetricCard label="Engagement Rate" value={s.er.toFixed(2)+"%"}  grade={s.erGrade}     score={s.erScore}/>
            <MetricCard label="Reach Rate"      value={s.reach.toFixed(1)+"%"} grade={s.reachGrade}  score={s.reachScore}/>
            <MetricCard label="Growth Rate"     value={s.growth.toFixed(2)+"%"} grade={s.growthGrade} score={s.growthScore}/>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"flex-start",padding:"11px 13px",border:"1px solid var(--brd)",background:"var(--bg-2)"}}>
            <Tip text={METRIC_LEGEND}/>
            <span className="body-sm" style={{fontSize:12}}>{METRIC_LEGEND}</span>
          </div>
        </Section>

        {/* PROFILO */}
        <Section title="Profilo">
          <div className="g3-keep">
            <KV k="Età" v={app.age}/>
            <KV k="Città" v={app.city}/>
            <KV k="Paese" v={app.country}/>
          </div>
          <div className="g2" style={{marginTop:2}}>
            <KV k="Email" v={app.email}/>
            <KV k="Maggiorenne" v={app.isAdult ? "Dichiarato" : "Non dichiarato"}/>
          </div>
          <div style={{marginTop:10}}>
            <div className="label-xs" style={{marginBottom:8}}>Categorie</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {categoriesOf(app).length
                ? categoriesOf(app).map(c=><Badge key={c} color="#7A6AD5">{catLabel(c)}</Badge>)
                : <span className="body-sm">—</span>}
              {app.otherProfileCategory && <Badge color="#C0A060">Altro: {app.otherProfileCategory}</Badge>}
            </div>
          </div>
        </Section>

        {/* SOCIAL */}
        <Section title="Social e dati">
          <div className="g3-keep">
            <KV k="Instagram" v={(()=>{const ig=socialLink(app,"instagram");return ig.handle
              ? <a href={ig.url} target="_blank" rel="noopener noreferrer">@{ig.handle}</a>
              : "—";})()}/>
            <KV k="Follower Instagram" v={fmtInt(app.followers)}/>
            <KV k="TikTok" v={(()=>{const tt=socialLink(app,"tiktok");return tt.handle
              ? <a href={tt.url} target="_blank" rel="noopener noreferrer">@{tt.handle}</a>
              : "—";})()}/>
          </div>
          <div className="g3-keep" style={{marginTop:2}}>
            <KV k="Follower TikTok" v={app.tiktokFollowers?fmtInt(app.tiktokFollowers):"—"}/>
            <KV k="Collaborazioni" v={enumLabel(app.hasBrandCollabs)}/>
            <KV k="Data candidatura" v={fmtDate(app.date)}/>
          </div>

          <div className="label-xs" style={{margin:"14px 0 8px"}}>Dati degli ultimi 30 giorni</div>
          <div className="g2">
            <KV k="Visualizzazioni" v={fmtInt(s.views)}/>
            <KV k="Account raggiunti" v={fmtInt(s.reached)}/>
            <KV k="Interazioni" v={fmtInt(s.interactions)}/>
            <KV k="Follower netti" v={(s.net>0?"+":"")+fmtInt(s.net)} color={s.net<0?"var(--bad)":undefined}/>
          </div>

          {/* Correzione manuale dei dati Insights */}
          <InsightsEditor app={app} scoring={scoring} onPatch={onPatch}/>

          {links.length>0 && (
            <div style={{marginTop:12}}>
              <div className="label-xs" style={{marginBottom:8}}>Contenuti rappresentativi</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {links.map((u,i)=>(
                  <a key={i} href={u} target="_blank" rel="noopener noreferrer"
                    style={{fontFamily:"var(--fb)",fontSize:13,color:"var(--info)",wordBreak:"break-all",padding:"9px 12px",border:"1px solid var(--brd)",background:"var(--bg-2)"}}>
                    ↗ {u}
                  </a>
                ))}
              </div>
            </div>
          )}

          {app.screenshotData && (
            <div style={{marginTop:12,border:"1px solid var(--brd)",background:"var(--bg-2)",padding:12}}>
              <div className="label-xs" style={{marginBottom:10}}>Screenshot Insights</div>
              <img src={app.screenshotData} alt="Screenshot Insights del candidato" style={{width:"100%",maxHeight:400,objectFit:"contain"}}/>
            </div>
          )}
        </Section>

        {/* POSIZIONAMENTO */}
        <Section title="Posizionamento">
          <QA q="Tre parole che ti descrivono come creator" a={app.threeWords}/>
          <QA q="Che tipo di contenuti pubblichi principalmente?" a={app.contentType}/>
          <QA q="Cosa vuoi trasmettere al tuo pubblico?" a={app.whatToTransmit}/>
          <QA q="Per quale motivo le persone scelgono di seguirti e continuano a farlo?" a={app.whyFollow}/>
          <QA q="Con quali brand e in che forma?" a={app.brandCollabDetails}/>
        </Section>

        {/* COMPATIBILITÀ */}
        <Section title="Compatibilità con EVORΛ">
          <QA q="Perché ritieni che possa esistere una collaborazione credibile tra il tuo percorso ed EVORΛ?" a={app.motivation}/>
          <QA q="Cosa apprezzi di EVORΛ?" a={app.brandLike}/>
          <QA q="Come integreresti EVORΛ nei tuoi contenuti senza renderli una pubblicità forzata?" a={app.contentIntegration}/>
          <QA q="Come racconteresti EVORΛ al tuo pubblico senza realizzare una pubblicità diretta?" a={app.howWouldTell}/>
          <QA q="Quale valore potresti portare a EVORΛ oltre alla semplice pubblicazione di contenuti?" a={app.valueBeyondContent}/>
          <QA q="Quale immagine dovrebbe trasmettere una persona che rappresenta EVORΛ?" a={app.athleteImage}/>
        </Section>

        {/* MENTALITÀ */}
        <Section title="Mentalità">
          <QA q="EVORΛ ti propone un contenuto molto coerente con il brand, ma probabilmente meno performante di una promozione diretta. Come lo gestiresti?" a={app.scenarioBrandContent}/>
          <QA q="Saresti disponibile a iniziare con un periodo in cui entrambe le parti valutano la qualità della collaborazione, senza una garanzia di risultati economici immediati?" a={enumLabel(app.buildWithoutEarnings)}/>
          <QA q="Come reagisci quando un contenuto non raggiunge i risultati attesi?" a={app.badContentReaction}/>
          <QA q="Quali elementi analizzeresti prima di decidere cosa cambiare?" a={app.analysisElements}/>
          <QA q="Che cosa significa per te rappresentare un brand?" a={app.brandMeaning}/>
        </Section>

        {/* DISPONIBILITÀ */}
        <Section title="Disponibilità">
          <div className="g3-keep">
            <KV k="Contenuti al mese" v={enumLabel(app.contentPerMonth)}/>
            <KV k="Costanza" v={enumLabel(app.hasRoutine)}/>
            <KV k="Linee guida" v={enumLabel(app.followsGuidelines)}/>
          </div>
          <div className="g2" style={{marginTop:2}}>
            <KV k="Eventi" v={enumLabel(app.availEvents)}/>
            <KV k="Shooting" v={enumLabel(app.availShooting)}/>
          </div>
          <div className="g2" style={{marginTop:2}}>
            <KV k="Contenuti per canali EVORΛ" v={enumLabel(app.availUgc)}/>
            <KV k="File originali" v={enumLabel(app.availRawFiles)}/>
          </div>
          <div style={{marginTop:8}}>
            <QA q="Hai già acquistato prodotti EVORΛ?" a={app.boughtProducts}/>
            <QA q="C'è qualcosa che miglioreresti del brand?" a={app.improvements}/>
            <QA q="Vuoi aggiungere qualcosa?" a={app.extra}/>
          </div>
        </Section>

        {/* VALUTAZIONE INTERNA */}
        <Section title="Valutazione interna">
          <div className="panel" style={{padding:16}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:6,flexWrap:"wrap"}}>
              <span className="body-sm" style={{fontSize:12,maxWidth:520}}>
                Valutazione manuale del team. Non è collegata al Social Performance Score e non è visibile al candidato.
              </span>
              {evalAvg!==null && (
                <div style={{textAlign:"right"}}>
                  <div style={{fontFamily:"var(--fh)",fontWeight:800,fontSize:24,color:"var(--t1)",lineHeight:1}}>{evalAvg.toFixed(1)}</div>
                  <div className="label-xs">Media / 5</div>
                </div>
              )}
            </div>
            {EVAL_CRITERIA.map(c=>(
              <div className="rate-row" key={c.k}>
                <span style={{fontFamily:"var(--fh)",fontWeight:600,fontSize:13,color:"var(--t2)"}}>{c.l}</span>
                <div className="rate-btns">
                  {[1,2,3,4,5].map(n=>(
                    <button key={n} className={"rate-b"+(evalv[c.k]===n?" rate-on":"")}
                      aria-label={c.l+" "+n+" su 5"}
                      onClick={()=>setEvalv(p=>({...p,[c.k]: p[c.k]===n ? 0 : n}))}>{n}</button>
                  ))}
                </div>
              </div>
            ))}
            <div style={{display:"flex",gap:10,alignItems:"center",marginTop:14,flexWrap:"wrap"}}>
              <button className="btn btn-primary btn-sm" onClick={saveEval} disabled={busy==="eval"}>
                {busy==="eval" ? "Salvataggio…" : "Salva valutazione"}
              </button>
              {app.evaluation && app.evaluation.updatedAt && (
                <span className="label-xs">Aggiornata il {fmtDateTime(app.evaluation.updatedAt)}</span>
              )}
            </div>
          </div>
        </Section>

        {/* GESTIONE INTERNA */}
        <Section title="Gestione interna">
          <div className="panel" style={{padding:16}}>
            <div className="label-xs" style={{marginBottom:10}}>Stato candidatura</div>
            <div className="chips" style={{marginBottom:20}}>
              {STATUSES.map(x=>(
                <button key={x.v} className={"chip"+(normStatus(app.status)===x.v?" chip-on":"")}
                  style={ normStatus(app.status)===x.v ? {background:x.c,borderColor:x.c} : null }
                  disabled={busy==="status"}
                  onClick={()=>saveStatus(x.v)}>{x.l}</button>
              ))}
            </div>

            <div className="g2-gap">
              <Field label="Codice creator" hint="Massimo 120 caratteri; il codice viene salvato in maiuscolo.">
                <div style={{display:"flex",gap:6}}>
                  <input value={code} maxLength={MANAGEMENT_LIMITS.creatorCode} onChange={e=>setCode(e.target.value)} placeholder="ES. MARIO10"/>
                  <button className="btn btn-ghost btn-sm" style={{flexShrink:0}} onClick={saveCode} disabled={busy==="code"}>Salva</button>
                </div>
              </Field>
              <div>
                <div className="label-xs" style={{marginBottom:8}}>Tracciamento</div>
                <div className="body-sm" style={{fontSize:12,lineHeight:1.9}}>
                  Candidatura: {fmtDateTime(app.date)}<br/>
                  Ultima modifica: {app.updatedAt ? fmtDateTime(app.updatedAt) : "—"}<br/>
                  Schema dati: v{app.schemaVersion||1}
                </div>
              </div>
            </div>

            <Field label="Note interne" hint="Visibili solo al team. Non sovrascrivono le risposte del candidato. Massimo 10.000 caratteri.">
              <textarea rows={5} value={notes} maxLength={MANAGEMENT_LIMITS.notes} onChange={e=>setNotes(e.target.value)} placeholder="Osservazioni, contatti effettuati, decisioni…"/>
            </Field>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <button className="btn btn-primary btn-sm" onClick={saveNotes} disabled={busy==="notes"}>
                {busy==="notes" ? "Salvataggio…" : "Salva note"}
              </button>
              {role==="admin" && (
                <button className="btn btn-danger btn-sm"
                  onClick={()=>{ if(window.confirm("Eliminare definitivamente questa candidatura?")) onDelete(app.id); }}>
                  Elimina candidatura
                </button>
              )}
              {msg && <span className="label-xs" role={msgError?"alert":"status"} style={{color:msgError?"var(--bad)":"var(--ok)",alignSelf:"center"}}>{msg}</span>}
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

/* ============================================================================
   13. PANNELLO SCORING (solo admin)
   ========================================================================== */
const BENCH_LEVELS = [
  {k:"avg",       l:"Medio da",      c:"#E67E22", desc:b=>"Sotto "+b.avg+"% → Scarso"},
  {k:"good",      l:"Buono da",      c:"#27AE60", desc:b=>"Da "+b.avg+"% a "+b.good+"% → Medio"},
  {k:"excellent", l:"Eccellente da", c:"#3A7BD5", desc:b=>"Da "+b.good+"% a "+b.excellent+"% → Buono · oltre → Eccellente"}
];

function ScoringPanel({scoring, onSaved, onAuthRequired}){
  const [cfg,setCfg]   = useState(()=>JSON.parse(JSON.stringify(scoring)));
  const [tab,setTab]   = useState("er");
  const [busy,setBusy] = useState(false);
  const [msg,setMsg]   = useState("");

  const metrics = [
    {k:"er",     l:"Engagement Rate", f:"interazioni / visualizzazioni × 100", step:"0.1"},
    {k:"reach",  l:"Reach Rate",      f:"visualizzazioni / follower × 100",    step:"1"},
    {k:"growth", l:"Growth Rate",     f:"nuovi follower / follower × 100",     step:"0.1"}
  ];
  const cur = metrics.find(m=>m.k===tab);
  const wTot = (+cfg.weights.er||0)+(+cfg.weights.reach||0)+(+cfg.weights.growth||0);

  const setBand = (i,key,val)=>{
    const b=JSON.parse(JSON.stringify(cfg.bands));
    b[i][tab][key]= val===""?0:parseFloat(val);
    setCfg(p=>({...p,bands:b}));
  };
  const setLevel = (i,val)=>{
    const l=JSON.parse(JSON.stringify(cfg.levels));
    l[i].min = val===""?0:parseInt(val);
    setCfg(p=>({...p,levels:l}));
  };

  const save = async ()=>{
    if(busy) return;
    setBusy(true); setMsg("");
    try{
      const clean = { ...cfg, version: SCORING_VERSION, bands: cfg.bands.map(b=>({ ...b, max: b.max===Infinity ? null : b.max })) };
      await FB.saveScoring(clean);
      onSaved(normalizeScoring(clean));
      setMsg("Configurazione salvata"); setTimeout(()=>setMsg(""),2200);
    }catch(e){
      const known=e instanceof CollectiveAdminScoring.ScoringSaveError;
      setMsg(known ? e.message : "Errore nel salvataggio. Riprova più tardi.");
      if(known && e.code==="LOGIN_REQUIRED") await onAuthRequired(e.message);
    }
    finally{ setBusy(false); }
  };

  return (
    <div style={{flex:1,overflow:"auto"}}>
      <div className="wrap-panel" style={{padding:"22px 16px 80px",maxWidth:900}}>
        <h2 className="h-md" style={{marginBottom:6}}>Configurazione Social Performance Score</h2>
        <p className="body-sm" style={{marginBottom:24,maxWidth:640}}>
          Il punteggio valuta esclusivamente i dati numerici del profilo Instagram.
          Non analizza le risposte e non esprime giudizi sul candidato.
          I benchmark sono indicativi e modificabili in qualsiasi momento.
        </p>

        {/* PESI */}
        <div className="panel" style={{padding:18,marginBottom:14}}>
          <div className="h-sm" style={{marginBottom:4}}>Pesi delle metriche</div>
          <div className="body-sm" style={{marginBottom:16}}>
            Somma attuale: <strong style={{color: wTot===100 ? "var(--ok)" : "var(--warn)"}}>{wTot}</strong>
            {wTot!==100 && " — i valori vengono comunque normalizzati automaticamente."}
          </div>
          <div className="g3-keep">
            {[["er","Engagement Rate"],["reach","Reach Rate"],["growth","Growth Rate"]].map(([k,l])=>(
              <Field key={k} label={l}>
                <input type="number" min="0" max="100" value={cfg.weights[k]}
                  onChange={e=>setCfg(p=>({...p,weights:{...p.weights,[k]: e.target.value===""?0:parseFloat(e.target.value)}}))}/>
              </Field>
            ))}
          </div>
        </div>

        {/* LIVELLI */}
        <div className="panel" style={{padding:18,marginBottom:14}}>
          <div className="h-sm" style={{marginBottom:4}}>Soglie di performance</div>
          <div className="body-sm" style={{marginBottom:16}}>
            Punteggio minimo per ciascun livello. Serve solo a dare priorità di lettura, non è una classificazione del candidato.
          </div>
          <div className="g2-gap">
            {cfg.levels.map((lv,i)=>(
              <Field key={lv.v} label={lv.l}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span className="dot" style={{background:lv.c,width:10,height:10}}/>
                  <input type="number" min="0" max="100" value={lv.min} disabled={i===cfg.levels.length-1}
                    onChange={e=>setLevel(i,e.target.value)}/>
                </div>
              </Field>
            ))}
          </div>
        </div>

        {/* BENCHMARK */}
        <div className="panel" style={{padding:18}}>
          <div className="h-sm" style={{marginBottom:4}}>Benchmark per fascia follower</div>
          <div className="body-sm" style={{marginBottom:16}}>{cur.l} = {cur.f}</div>

          <div style={{display:"flex",gap:4,marginBottom:18,flexWrap:"wrap"}}>
            {metrics.map(m=>(
              <button key={m.k} className={"chip"+(tab===m.k?" chip-on":"")} style={{flex:"1 1 140px"}}
                onClick={()=>setTab(m.k)}>{m.l}</button>
            ))}
          </div>

          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:18}}>
            {[["Scarso","#C0392B"],["Medio","#E67E22"],["Buono","#27AE60"],["Eccellente","#3A7BD5"]].map(([l,c])=>(
              <span key={l} className="badge" style={{color:c,borderColor:c+"66",background:c+"1A"}}>
                <span className="dot" style={{background:c}}/>{l}
              </span>
            ))}
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {cfg.bands.map((band,i)=>(
              <div key={i} style={{border:"1px solid var(--brd)",background:"var(--bg-2)",padding:14}}>
                <div className="h-sm" style={{marginBottom:12}}>Fascia {band.label}</div>
                <div className="g3-keep">
                  {BENCH_LEVELS.map(lv=>(
                    <div key={lv.k} style={{background:lv.c+"14",border:"1px solid "+lv.c+"55",padding:12}}>
                      <div style={{fontFamily:"var(--fh)",fontWeight:700,fontSize:10,letterSpacing:".16em",textTransform:"uppercase",color:lv.c,marginBottom:8}}>{lv.l}</div>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <input type="number" step={cur.step} min="0" value={band[tab][lv.k]}
                          onChange={e=>setBand(i,lv.k,e.target.value)}
                          style={{borderColor:lv.c+"66",padding:"9px 10px"}}/>
                        <span style={{fontFamily:"var(--fh)",fontWeight:700,color:lv.c}}>%</span>
                      </div>
                      <div style={{fontFamily:"var(--fb)",fontSize:11,color:lv.c,opacity:.85,marginTop:7,lineHeight:1.5}}>
                        {lv.desc(band[tab])}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{display:"flex",gap:10,marginTop:20,flexWrap:"wrap",alignItems:"center"}}>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy?"Salvataggio…":"Salva configurazione"}</button>
          <button className="btn btn-ghost" onClick={()=>setCfg(JSON.parse(JSON.stringify(DEFAULT_SCORING)))}>Ripristina valori iniziali</button>
          {msg && <span className="label-xs" role="status" style={{color:msg==="Configurazione salvata"?"var(--ok)":"var(--bad)"}}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   14. IMPOSTAZIONI (solo admin)
   ========================================================================== */
function SettingsPanel(){
  const [tgTest,setTgTest] = useState("");
  const [busy,setBusy]     = useState(false);

  const testNotifica = async ()=>{
    setBusy(true); setTgTest("Invio in corso…");
    const r = await sendTelegram("✅ <b>"+BRAND.program+"</b> — canale di notifica attivo.");
    setTgTest(r.ok ? "Messaggio inviato. Controlla Telegram."
                   : "Non inviato: "+(r.description||"verifica i secret TG_TOKEN e TG_CHAT sul Worker."));
    setBusy(false);
  };

  const Item = ({name, where, note}) => (
    <div style={{display:"flex",gap:12,padding:"14px 0",borderBottom:"1px solid var(--brd)"}}>
      <span className="dot" style={{background:"var(--ok)",marginTop:7}}/>
      <div style={{minWidth:0}}>
        <div style={{fontFamily:"var(--fh)",fontWeight:700,fontSize:13,color:"var(--t1)"}}>{name}</div>
        <div className="body-sm" style={{fontSize:13,marginTop:2}}>{where}</div>
        {note && <div className="body-sm" style={{fontSize:12,color:"var(--t4)",marginTop:4}}>{note}</div>}
      </div>
    </div>
  );

  return (
    <div style={{flex:1,overflow:"auto"}}>
      <div className="wrap-panel" style={{padding:"22px 16px 80px",maxWidth:720}}>
        <h2 className="h-md" style={{marginBottom:8}}>Impostazioni</h2>
        <p className="body-sm" style={{marginBottom:24,maxWidth:620}}>
          Chiavi, token e codici di accesso non risiedono più nel sito: sono conservati come secret
          del Cloudflare Worker. Il browser non può leggerli, nemmeno aprendo il codice sorgente.
        </p>

        <div className="panel" style={{padding:18,marginBottom:14}}>
          <div className="h-sm" style={{marginBottom:6}}>Configurazioni server-side</div>
          <p className="body-sm" style={{marginBottom:8}}>
            Si modificano dalla dashboard Cloudflare: Workers &amp; Pages → il tuo Worker →
            Settings → Variables and Secrets.
          </p>
          <Item name="ANTHROPIC_KEY"  where="Chiave usata per la lettura automatica degli screenshot."/>
          <Item name="TG_TOKEN · TG_CHAT" where="Bot e destinazione delle notifiche di nuova candidatura."/>
          <Item name="ADMIN_CODE"     where="Codice di accesso con permessi completi."/>
          <Item name="MANAGER_CODE"   where="Codice di accesso con permessi limitati."
                note="Dopo la modifica di un codice il Worker si aggiorna da solo: nessun intervento sul sito."/>
          <Item name="FIREBASE_SERVICE_ACCOUNT" where="Credenziale con cui il Worker firma il ruolo di chi accede."
                note="Da sostituire solo se rigeneri la chiave dalla console Firebase."/>
        </div>

        <div className="panel" style={{padding:18,marginBottom:14}}>
          <div className="h-sm" style={{marginBottom:6}}>Verifica notifiche</div>
          <p className="body-sm" style={{marginBottom:14}}>
            Invia un messaggio di prova sul canale Telegram configurato.
          </p>
          <button className="btn btn-ghost btn-sm" onClick={testNotifica} disabled={busy}>
            Invia messaggio di prova
          </button>
          {tgTest && <div className="label-xs" style={{marginTop:12,color:"var(--t2)"}}>{tgTest}</div>}
        </div>

        <div className="panel" style={{padding:18}}>
          <div className="h-sm" style={{marginBottom:6}}>Permessi in vigore</div>
          <p className="body-sm" style={{marginBottom:14}}>
            I limiti sono applicati dalle regole del database, non solo dall'interfaccia.
            Un Manager che tentasse un'operazione riservata riceverebbe un rifiuto dal server.
          </p>
          <div className="g2-gap">
            <div>
              <div className="label-xs" style={{marginBottom:8,color:"#B22222"}}>Admin</div>
              <div className="body-sm" style={{fontSize:13,lineHeight:1.9}}>
                Candidature · Stati · Note · Valutazione<br/>
                Codici creator · Export<br/>
                Eliminazione candidature<br/>
                Benchmark e pesi · Impostazioni
              </div>
            </div>
            <div>
              <div className="label-xs" style={{marginBottom:8,color:"#C0A060"}}>Manager</div>
              <div className="body-sm" style={{fontSize:13,lineHeight:1.9}}>
                Candidature · Stati · Note · Valutazione<br/>
                Codici creator · Export<br/>
                <span style={{color:"var(--t4)"}}>Nessuna eliminazione</span><br/>
                <span style={{color:"var(--t4)"}}>Nessun accesso a scoring e impostazioni</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   15. AREA RISERVATA
   ========================================================================== */
function AdminPanel({onBack, onTestForm}){
  const [role,setRole]       = useState(null);
  const [ready,setReady]     = useState(false);   // sessione già verificata?
  const [code,setCode]       = useState("");
  const [err,setErr]         = useState("");
  const [checking,setChk]    = useState(false);
  const [tab,setTab]         = useState("apps");
  const [scoring,setScoring] = useState(DEFAULT_SCORING);

  // Ripristina una sessione ancora valida senza richiedere di nuovo il codice.
  useEffect(()=>{
    let alive = true;
    const stop = auth.onAuthStateChanged(async ()=>{
      const r = await AUTH.currentRole();
      if(!alive) return;
      setRole(r); setReady(true);
    });
    return ()=>{ alive=false; stop(); };
  },[]);

  // Scadenza controllata anche a scheda aperta.
  useEffect(()=>{
    if(!role) return;
    const t = setInterval(async ()=>{
      const r = await AUTH.currentRole();
      if(!r){ setRole(null); setErr("Sessione scaduta. Inserisci di nuovo il codice."); }
    }, 300000);
    return ()=>clearInterval(t);
  },[role]);

  useEffect(()=>{
    if(!role) return;
    FB.getScoring().then(c=>setScoring(normalizeScoring(c))).catch(()=>setScoring(DEFAULT_SCORING));
  },[role]);

  const login = async ()=>{
    const v = code.trim();
    if(!v){ setErr("Inserisci il codice di accesso."); return; }
    setChk(true); setErr("");
    try{
      const r = await AUTH.login(v);
      setRole(r); setCode("");
    }catch(e){
      setErr(e.message || "Accesso non riuscito.");
    }finally{ setChk(false); }
  };

  const logout = async ()=>{ await AUTH.logout(); setRole(null); setTab("apps"); };
  const requireLogin = async message=>{ await AUTH.logout(); setRole(null); setTab("apps"); setErr(message); };

  if(!ready) return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div className="spinner" style={{width:26,height:26}}/>
    </div>
  );

  if(!role) return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:"32px 20px"}}>
      <div style={{width:"100%",maxWidth:400,animation:"fadeUp .5s ease both"}}>
        <div style={{display:"flex",justifyContent:"center",marginBottom:30}}><Logo height={32}/></div>
        <h1 className="h-md" style={{marginBottom:8,textAlign:"center"}}>Accesso riservato</h1>
        <p className="body-sm" style={{marginBottom:26,textAlign:"center"}}>
          Inserisci il codice fornito dal team {BRAND.program}.
        </p>
        <Field label="Codice di accesso" error={err} htmlFor="access-code">
          <input id="access-code" type="password" value={code} autoFocus autoComplete="off"
            aria-invalid={err?"true":"false"} style={{fontSize:16,padding:"16px 15px",letterSpacing:".08em"}}
            onChange={e=>{setCode(e.target.value);setErr("");}}
            onKeyDown={e=>e.key==="Enter"&&!checking&&login()}
            placeholder="••••••••"/>
        </Field>
        <button className="btn btn-primary" style={{width:"100%"}} onClick={login} disabled={checking}>
          {checking?"Verifica in corso…":"Accedi"}
        </button>
        <button className="btn btn-ghost" style={{width:"100%",marginTop:8}} onClick={onBack}>Torna alla home</button>
      </div>
    </div>
  );

  const isAdmin = role==="admin";

  return (
    <div className="admin-shell">
      <div className="admin-bar">
        <div className="wrap-panel admin-bar-in">
          <div style={{display:"flex",alignItems:"center",gap:12,minWidth:0}}>
            <Logo height={20}/>
            <Badge color={isAdmin?"#B22222":"#C0A060"}>{isAdmin?"Admin":"Manager"}</Badge>
          </div>
          <div style={{display:"flex",gap:8}}>
            {isAdmin && <button className="btn btn-ghost btn-sm" onClick={onTestForm}>Form di prova</button>}
            <button className="btn btn-ghost btn-sm" onClick={logout}>Esci</button>
          </div>
        </div>
      </div>

      <div className="tabs">
        <div className="wrap-panel" style={{display:"flex",padding:0}}>
          <button className={"tab"+(tab==="apps"?" tab-on":"")} onClick={()=>setTab("apps")}>Candidature</button>
          {isAdmin && <button className={"tab"+(tab==="scoring"?" tab-on":"")} onClick={()=>setTab("scoring")}>Scoring</button>}
          {isAdmin && <button className={"tab"+(tab==="settings"?" tab-on":"")} onClick={()=>setTab("settings")}>Impostazioni</button>}
        </div>
      </div>

      {tab==="apps"     && <ApplicationsPanel role={role} scoring={scoring}/>}
      {tab==="scoring"  && isAdmin && <ScoringPanel scoring={scoring} onSaved={setScoring} onAuthRequired={requireLogin}/>}
      {tab==="settings" && isAdmin && <SettingsPanel/>}
    </div>
  );
}


/* ---------- fine di app/admin.jsx ---------- */
CollectiveModules.add("app/admin.jsx");
