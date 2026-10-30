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
  },
  async getScoreLevels(){
    const doc = await db.collection("settings").doc("scoreLevels").get();
    return doc.exists ? CollectiveScoreLevels.validateConfig(doc.data()) : null;
  },
  // Lettura autorevole delle curve Instagram: nessuna scrittura e nessun fallback su errore.
  async getBenchmarks(){
    const doc = await db.collection("settings").doc("instagramBenchmarks").get({source:"server"});
    return doc.exists ? CollectiveScoreLevels.benchmarks.fromDocument(doc.data()) : CollectiveScoreLevels.benchmarks.defaults();
  },
  async saveScoreLevels(config){
    await CollectiveAdminScoring.saveScoreLevels({endpoint:WORKER_BASE+"/admin/score-levels",auth,config});
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
   5. PUNTEGGIO QUANTITATIVO — scoring v2 (Modello A), configurazione versione 3
   Valuta ESCLUSIVAMENTE i dati numerici Instagram degli ultimi 30 giorni.
   Nessuna analisi delle risposte, nessuna keyword, nessuna decisione automatica.
   Formule identiche a server/collective/scoring.mjs (test di parità e di testo).
   ========================================================================== */
const SCORING_VERSION = 3;   // incrementare quando cambiano formule o riferimenti predefiniti

const DEFAULT_SCORING = {
  version: SCORING_VERSION,
  // 65% coinvolgimento (interazioni / visualizzazioni), 35% visibilità (volume delle visualizzazioni).
  weights: { engagement:65, visibility:35 },
  // Riferimenti iniziali sperimentali: il valore di riferimento vale 50/100.
  references: { engagementRate:2, views:30000 },
  // Basi di osservazione estremamente ridotte: solo segnalate, il punteggio non viene corretto.
  lowBase: { views:1000, interactions:10 }
};

// Configurazione assente o del modello precedente (versione 1/2): valori predefiniti, senza conversione
// delle vecchie soglie. Il documento su Firestore resta invariato finché l'admin non salva di nuovo.
const normalizeScoring = (cfg) => {
  const out = JSON.parse(JSON.stringify(DEFAULT_SCORING));
  if(!cfg || cfg.version !== SCORING_VERSION) return out;
  const ok = (v, min) => typeof v === "number" && Number.isFinite(v) && v >= min;
  ["engagement","visibility"].forEach(k=>{ if(cfg.weights && ok(cfg.weights[k],0)) out.weights[k] = cfg.weights[k]; });
  if(out.weights.engagement + out.weights.visibility <= 0) out.weights = { ...DEFAULT_SCORING.weights };
  ["engagementRate","views"].forEach(k=>{ if(cfg.references && ok(cfg.references[k],0) && cfg.references[k] > 0) out.references[k] = cfg.references[k]; });
  ["views","interactions"].forEach(k=>{ if(cfg.lowBase && ok(cfg.lowBase[k],0)) out.lowBase[k] = cfg.lowBase[k]; });
  return out;
};

/* scoring-core:start — testo identico in app/admin.jsx (verificato dai test) */
// Normalizzazione logaritmica approvata: H(x;s) = 100 · ln(1+x/s) / [ln(1+x/s) + ln 2].
// Continua e crescente, senza soglie né fasce: 0 → 0, riferimento s → 50, verso 100 senza raggiungerlo.
const saturate = (value, reference) => {
  if (!(value > 0)) return 0;
  const l = Math.log1p(value / reference);
  return 100 * l / (l + Math.LN2);
};

// Valori osservati: interi non negativi (numero o stringa di sole cifre nelle candidature storiche).
// Un valore mancante o non valido resta null: non diventa mai zero.
const count = v => {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
};
const signedCount = v => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && /^[+-]?\d+$/.test(v.trim())) return Number(v.trim());
  return null;
};
const round2 = v => v === null ? null : Math.round(v * 100) / 100;

const computeWithConfig = (data, cfg) => {
  const followers    = count(data.followers);
  const views        = count(data.views);
  const interactions = count(data.interactions);
  const reached      = count(data.accountsReached);
  const net          = signedCount(data.netFollowers);

  // Indicatore B: secondario, mai nel punteggio, solo con account raggiunti indicati e maggiori di zero.
  const reachEngagementRate = interactions !== null && reached !== null && reached > 0 ? interactions / reached * 100 : null;
  const missing = [];
  if (views === null) missing.push("views");
  if (interactions === null) missing.push("interactions");
  const lowBaseReasons = [];
  if (views !== null && views < cfg.lowBase.views) lowBaseReasons.push("views");
  if (interactions !== null && interactions < cfg.lowBase.interactions) lowBaseReasons.push("interactions");

  const observed = { followers, views, interactions, netFollowers:net, accountsReached:reached };
  // unavailableReason: "missing" (dato mancante o non valido) oppure "noViews" (zero visualizzazioni osservate).
  if (missing.length) return {
    scoringVersion:SCORING_VERSION, available:false, unavailableReason:"missing", missing, socialScore:null,
    engagementRate:null, engagementScore:null, visibilityScore:null, reachEngagementRate,
    lowBase:lowBaseReasons.length > 0, lowBaseReasons, ...observed
  };
  // Zero visualizzazioni è un dato reale, distinto da un dato mancante: il coinvolgimento non è calcolabile
  // e il punteggio complessivo non è disponibile (mai mostrato come zero).
  if (views === 0) return {
    scoringVersion:SCORING_VERSION, available:false, unavailableReason:"noViews", missing, socialScore:null,
    engagementRate:null, engagementScore:null, visibilityScore:saturate(0, cfg.references.views), reachEngagementRate,
    lowBase:lowBaseReasons.length > 0, lowBaseReasons, ...observed
  };

  const engagementRate  = interactions / views * 100;
  const engagementScore = saturate(engagementRate, cfg.references.engagementRate);
  const visibilityScore = saturate(views, cfg.references.views);
  const w  = cfg.weights;
  const tw = w.engagement + w.visibility;
  const socialScore = Math.round((engagementScore * w.engagement + visibilityScore * w.visibility) / tw);

  return {
    scoringVersion:SCORING_VERSION, available:true, unavailableReason:null, missing, socialScore,
    engagementRate, engagementScore, visibilityScore, reachEngagementRate,
    lowBase:lowBaseReasons.length > 0, lowBaseReasons, ...observed
  };
};

/** Campi salvati sulla candidatura: stessi arrotondamenti nel Worker e nell'Admin. */
const scoreDocumentFields = s => ({
  scoringVersion: s.scoringVersion,
  socialScore: s.socialScore,
  engagementRate: round2(s.engagementRate),
  engagementScore: s.engagementScore === null ? null : Math.round(s.engagementScore),
  visibilityScore: s.visibilityScore === null ? null : Math.round(s.visibilityScore),
  reachEngagementRate: round2(s.reachEngagementRate),
  lowBase: s.lowBase
});
/* scoring-core:end */

/**
 * Calcola il punteggio quantitativo principale e l'indicatore B.
 * Ricalcolato a ogni lettura con la configurazione corrente, anche per le candidature storiche.
 */
const computeScore = (data, cfgRaw) => computeWithConfig(data, cfgRaw || DEFAULT_SCORING);

/* ============================================================================
   10. EXPORT CSV (compatibile Excel IT)
   ========================================================================== */
// Valori mancanti mostrati come "—", mai come zero.
const fmtMaybe = n => n===null || n===undefined ? "—" : fmtInt(n);
const fmtPct   = v => v===null || v===undefined ? "—" : v.toLocaleString("it-IT",{minimumFractionDigits:2,maximumFractionDigits:2})+"%";
const csvNum   = (v, digits) => v===null || v===undefined ? "" : (digits===undefined ? String(v) : v.toFixed(digits));
// Colore neutro: il punteggio non ha livelli né soglie di classificazione.
const SCORE_COLOR = "var(--info)";
const LOW_BASE_TEXT = "Base di osservazione molto ridotta: il punteggio è calcolato senza correzioni, ma è poco stabile.";

const exportCSV = (rows, cfg) => {
  const head = [
    "Data","Ultima modifica","Stato","Nome","Età","Email","Città","Paese","Categorie","Altra categoria",
    "Instagram","Follower IG","TikTok","Follower TikTok",
    "Visualizzazioni","Account raggiunti","Interazioni","Follower netti",
    "Punteggio quantitativo","Versione scoring","Coinvolgimento % (interazioni/visualizzazioni)","Punteggio coinvolgimento","Punteggio visibilità",
    "Base ridotta","Indicatore B % (interazioni/account raggiunti)",
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
    const s = computeScore(a, cfg);
    const ev = a.evaluation || {};
    const vals = EVAL_CRITERIA.map(c=>ev[c.k]).filter(v=>typeof v==="number" && v>0);
    const avg = vals.length ? (vals.reduce((x,y)=>x+y,0)/vals.length).toFixed(2) : "";
    return [
      fmtDate(a.date), a.updatedAt?fmtDateTime(a.updatedAt):"", adminStatusMeta(a.status).l,
      a.fullName, a.age, a.email, a.city, a.country||"", categoriesOf(a).map(catLabel).join(" | "), a.otherProfileCategory||"",
      a.instagram, csvNum(s.followers), a.tiktok||"", a.tiktokFollowers||"",
      csvNum(s.views), csvNum(s.accountsReached), csvNum(s.interactions), csvNum(s.netFollowers),
      csvNum(s.socialScore), s.scoringVersion, csvNum(s.engagementRate,2), csvNum(s.engagementScore,0), csvNum(s.visibilityScore,0),
      s.lowBase?"Sì":"No", csvNum(s.reachEngagementRate,2),
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
const BASE_FILTERS = [
  {v:"low",l:"Solo base ridotta"},{v:"normal",l:"Escludi base ridotta"}
];
const DATE_FILTERS = [
  {v:"all",l:"Sempre"},{v:"7",l:"Ultimi 7 giorni"},{v:"30",l:"Ultimi 30 giorni"},{v:"90",l:"Ultimi 90 giorni"}
];
const PER_PAGE = 10;

// Quattro stati selezionabili: gli altri restano leggibili nelle candidature storiche.
const PRIMARY_STATUS_KEYS = new Set(["new","review","approved","rejected"]);
const PRIMARY_STATUSES = STATUSES.filter(status=>PRIMARY_STATUS_KEYS.has(status.v));
const adminStatusKey = value => String(value??"").trim().toLowerCase() || "new";
const adminStatusMeta = value => {
  const key=adminStatusKey(value);
  return STATUSES.find(status=>status.v===key) || {
    v:key,l:"Stato non riconosciuto: "+String(value).trim(),c:"#8E8F96"
  };
};

// Metriche osservate, indipendenti dallo Scoring V2 (65/35).
// I campi assenti rimangono null; le percentuali non diventano sottopunteggi.
const benchmarkRatesOf = score => {
  const followers=score.followers, reached=score.accountsReached, net=score.netFollowers;
  const startingFollowers=followers!==null&&net!==null ? followers-net : null;
  return {
    engagement:score.reachEngagementRate,
    reach:reached!==null&&followers!==null&&followers>0 ? reached/followers*100 : null,
    growth:startingFollowers!==null&&startingFollowers>0 ? net/startingFollowers*100 : null
  };
};
const benchmarkGrade = (rate,metric,followers,config) => {
  if(rate===null||!Number.isFinite(rate)||!config||followers===null||followers<=0)return null;
  const limits=CollectiveScoreLevels.benchmarks.thresholds(config,metric,followers);
  if(!limits||limits.some(n=>!Number.isFinite(n)))return null;
  const index=rate<limits[0]?0:rate<limits[1]?1:rate<limits[2]?2:3;
  return [
    {id:"scarso",label:"Scarso"},
    {id:"medio",label:"Medio"},
    {id:"buono",label:"Buono"},
    {id:"eccellente",label:"Eccellente"}
  ][index];
};

function ApplicationsPanel({role, scoring, scoreLevels}){
  const [apps,setApps]       = useState([]);
  const [sel,setSel]         = useState(null);
  const [loading,setLoading] = useState(true);
  const [loadErr,setLoadErr] = useState("");
  const [q,setQ]             = useState("");
  const [fStatus,setFStatus] = useState("all");
  const [fCat,setFCat]       = useState("all");
  const [fBand,setFBand]     = useState("all");
  const [fBase,setFBase]     = useState("all");
  const [fDate,setFDate]     = useState("all");
  const [fPlace,setFPlace]   = useState("");
  const [fCollab,setFCollab] = useState("all");
  const [fNotes,setFNotes]   = useState("all");
  const [sort,setSort]       = useState("date");
  const [page,setPage]       = useState(1);
  const [openFilters,setOpenFilters] = useState(false);
  const [benchmarkState,setBenchmarkState] = useState({status:"loading",config:null});
  const [benchmarkRetry,setBenchmarkRetry] = useState(0);

  useEffect(()=>{
    let active=true;
    setBenchmarkState({status:"loading",config:null});
    FB.getBenchmarks()
      .then(config=>{if(active)setBenchmarkState({status:"ready",config});})
      .catch(()=>{if(active)setBenchmarkState({status:"error",config:null});});
    return ()=>{active=false;};
  },[benchmarkRetry]);

  const load = useCallback(()=>{
    setLoading(true);
    FB.getApps()
      .then(a=>{ setApps(a); setLoadErr(""); })
      .catch(()=> setLoadErr("Impossibile caricare le candidature. Verifica la connessione."))
      .finally(()=> setLoading(false));
  },[]);
  useEffect(()=>{ load(); },[load]);

  // Scoring V2 ricalcolato a runtime; nessuna scrittura sugli stati storici.
  const enriched = useMemo(()=> apps.map(a=>({ ...a, _s:computeScore(a,scoring), _status:adminStatusKey(a.status) })), [apps,scoring]);

  const overdue = useMemo(()=> enriched.filter(a=> a._status==="new" && daysSince(a.date)>7), [enriched]);

  const filtered = useMemo(()=>{
    const needle = q.trim().toLowerCase();
    const place  = fPlace.trim().toLowerCase();
    return enriched.filter(a=>{
      if(fStatus!=="all" && a._status!==fStatus) return false;
      if(fCat!=="all" && (a.category||"")!==fCat) return false;
      if(fBase==="low" && !a._s.lowBase) return false;
      if(fBase==="normal" && a._s.lowBase) return false;
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
  },[enriched,q,fStatus,fCat,fBand,fBase,fDate,fPlace,fCollab,fNotes]);

  const sorted = useMemo(()=>{
    const arr=[...filtered];
    // Valori non disponibili sempre in fondo, in entrambe le direzioni: mai trattati come zero.
    const desc = k => (a,b)=>{
      const x=a._s[k], y=b._s[k];
      if(x===null && y===null) return 0; if(x===null) return 1; if(y===null) return -1;
      return y-x;
    };
    const by = {
      date:      (a,b)=> new Date(b.date||0)-new Date(a.date||0),
      followers:    desc("followers"),
      score:        desc("socialScore"),
      engagement:   desc("engagementRate"),
      reachB:       desc("reachEngagementRate"),
      views:        desc("views"),
      reached:      desc("accountsReached"),
      interactions: desc("interactions"),
      net:          desc("netFollowers"),
      name:      (a,b)=> String(a.fullName||"").localeCompare(String(b.fullName||""),"it")
    };
    return arr.sort(by[sort]||by.date);
  },[filtered,sort]);

  const pages = Math.max(1, Math.ceil(sorted.length/PER_PAGE));
  const cur   = Math.min(page,pages);
  const slice = sorted.slice((cur-1)*PER_PAGE, cur*PER_PAGE);
  useEffect(()=>{ setPage(1); },[q,fStatus,fCat,fBand,fBase,fDate,fPlace,fCollab,fNotes,sort]);

  const counts = useMemo(()=>{
    // Totali comprende anche shortlist, watchlist, more_info, archived e stati sconosciuti.
    const c={ total:enriched.length, new:0, review:0, approved:0, rejected:0 };
    enriched.forEach(a=>{ if(c[a._status]!==undefined) c[a._status]++; });
    return c;
  },[enriched]);

  const resetFilters = ()=>{ setQ("");setFStatus("all");setFCat("all");setFBand("all");setFBase("all");setFDate("all");setFPlace("");setFCollab("all");setFNotes("all"); };
  // Lo stato si seleziona tramite i contatori, non compare nel numero dei filtri avanzati.
  const activeFilters = [fCat,fBand,fBase,fDate,fCollab,fNotes].filter(v=>v!=="all").length + (fPlace?1:0);

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
    <CandidateDetail app={sel} role={role} scoring={scoring} scoreLevels={scoreLevels}
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
              ["approved","Approvate",counts.approved,"#27AE60"],
              ["rejected","Rifiutate",counts.rejected,"#8A2A2A"]
            ].map(([v,l,n,c])=>(
              <button key={v} className={"stat"+(fStatus===v?" stat-on":"")}
                style={{flex:"1 1 100px",minWidth:96}}
                aria-pressed={fStatus===v}
                title={v==="all"?"Comprende anche le candidature con stati storici":undefined}
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
              <option value="score">Punteggio ↓</option>
              <option value="followers">Follower ↓</option>
              <option value="engagement">Coinvolgimento ↓</option>
              <option value="reachB">Indicatore B ↓</option>
              <option value="views">Visualizzazioni ↓</option>
              <option value="reached">Account raggiunti ↓</option>
              <option value="interactions">Interazioni ↓</option>
              <option value="net">Follower netti ↓</option>
              <option value="name">Nome A–Z</option>
            </select>
            <button className="btn btn-ghost btn-sm" onClick={()=>setOpenFilters(o=>!o)}>
              Filtri{activeFilters?" ("+activeFilters+")":""}
            </button>
            <details className="admin-actions-menu">
              <summary className="btn btn-ghost btn-sm">Altro</summary>
              <div className="admin-actions-dropdown">
                <button type="button" className="btn btn-ghost btn-sm" onClick={()=>exportCSV(sorted,scoring)}>Esporta CSV</button>
              </div>
            </details>
          </div>

          {openFilters && (
            <div style={{border:"1px solid var(--brd)",background:"var(--bg-2)",padding:14}}>
              <div className="g3-gap">
                <Field label="Categoria"><select value={fCat} onChange={e=>setFCat(e.target.value)}>
                  <option value="all">Tutte</option>
                  {CATEGORIES.map(c=><option key={c.v} value={c.v}>{c.l}</option>)}
                </select></Field>
                <Field label="Fascia follower"><select value={fBand} onChange={e=>setFBand(e.target.value)}>
                  <option value="all">Tutte</option>
                  {FOLLOWER_BANDS.map(b=><option key={b.v} value={b.v}>{b.l}</option>)}
                </select></Field>
                <Field label="Base di osservazione"><select value={fBase} onChange={e=>setFBase(e.target.value)}>
                  <option value="all">Tutte</option>
                  {BASE_FILTERS.map(p=><option key={p.v} value={p.v}>{p.l}</option>)}
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
            <span className="body-sm" style={{fontSize:12}}>Il punteggio misura solo i dati numerici e non decide l'esito.</span>
          </div>
        </div>
      </div>

      {/* LISTA: soli dati effettivamente osservati, classificazioni benchmark indipendenti. */}
      <div className="wrap-panel candidate-list" style={{padding:"0 16px"}}>
        {benchmarkState.status==="error" && (
          <div className="candidate-benchmark-error" role="alert">
            Classificazioni ENG, RE e GR non disponibili: impossibile leggere i benchmark.
            I valori osservati restano visibili senza colori.
            <button className="nav-link" type="button" onClick={()=>setBenchmarkRetry(n=>n+1)}>Riprova</button>
          </div>
        )}
        {slice.length===0 && (
          <div style={{padding:"60px 20px",textAlign:"center"}}>
            <div className="h-sm" style={{marginBottom:6}}>Nessuna candidatura</div>
            <div className="body-sm">Modifica i filtri o azzerali per vedere tutti i profili.</div>
          </div>
        )}

        {slice.length>0 && (
          <div className="candidate-list-head" aria-hidden="true">
            <span>Candidato</span><span>Stato</span><span>Follower</span>
            <span>ENG</span><span>RE</span><span>GR</span><span>Score V2</span><span>Data</span>
          </div>
        )}
        {slice.map(a=>{
          const s=a._s, st=adminStatusMeta(a.status), late=a._status==="new"&&daysSince(a.date)>7;
          const ig=socialLink(a,"instagram"), rates=benchmarkRatesOf(s);
          const grades={
            engagement:benchmarkGrade(rates.engagement,"engagement",s.followers,benchmarkState.config),
            reach:benchmarkGrade(rates.reach,"reach",s.followers,benchmarkState.config),
            growth:benchmarkGrade(rates.growth,"growth",s.followers,benchmarkState.config)
          };
          const socialGrade=CollectiveScoreLevels.classify(s.socialScore,scoreLevels?.social);
          return (
            <button key={a.id} type="button" className="row candidate-row"
              style={{borderLeftColor:s.lowBase?"var(--warn)":"var(--brd)"}}
              onClick={()=>setSel(a)}>
              <div className="candidate-cell candidate-identity">
                <span className="candidate-name">{a.fullName||"—"}</span>
                <span className="candidate-username">{ig.handle?"@"+ig.handle:"—"}</span>
              </div>
              <div className="candidate-cell candidate-status-cell">
                <span className="candidate-status-badge" style={{color:st.c,borderColor:st.c}}>{st.l}</span>
              </div>
              <div className="candidate-cell candidate-followers">
                <span className="candidate-cell-label">Follower</span>
                <span className="candidate-value" data-metric="followers">
                  {s.followers===null?"—":fmtShort(s.followers)}
                </span>
              </div>
              {[
                ["engagement","ENG"],["reach","RE"],["growth","GR"]
              ].map(([key,label])=>{
                const value=rates[key],grade=grades[key];
                const description=value===null?"Dato non disponibile"
                  :grade?.label || (benchmarkState.status==="loading"?"Benchmark in caricamento":"Classificazione non disponibile");
                return <div className="candidate-cell candidate-metric" key={key}>
                  <span className="candidate-cell-label">{label}</span>
                  <span className="candidate-value" data-metric={key} data-level={grade?.id||undefined}
                    title={description} aria-label={label+": "+(value===null?"non disponibile":fmtPct(value))+". "+description}>
                    {value===null?"—":fmtPct(value)}
                  </span>
                </div>;
              })}
              <div className="candidate-cell candidate-score">
                <span className="candidate-cell-label">Score V2</span>
                <span className="candidate-value" data-metric="socialScore"
                  style={{color:socialGrade?.color||"var(--t1)"}}
                  title={(socialGrade?.label||"Punteggio quantitativo V2")+(s.lowBase?" · Base di osservazione ridotta":"")}>
                  {s.socialScore===null?"—":s.socialScore+"/100"}
                </span>
              </div>
              <div className="candidate-cell candidate-date">
                <span className="candidate-cell-label">Data</span>
                <time dateTime={a.date||undefined} className={late?"candidate-date-overdue":""}>{fmtDate(a.date)}</time>
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

// Valori raccolti nel modulo e correggibili dallo staff. Gli account raggiunti sono facoltativi.
const INSIGHT_FIELDS = [
  {k:"followers",       l:"Follower totali",   hint:"",                 required:true,  signed:false},
  {k:"views",           l:"Visualizzazioni",   hint:"Ultimi 30 giorni", required:true,  signed:false},
  {k:"interactions",    l:"Interazioni",       hint:"Ultimi 30 giorni", required:true,  signed:false},
  {k:"netFollowers",    l:"Follower netti",    hint:"Ultimi 30 giorni · può essere negativo o zero", required:true, signed:true},
  {k:"accountsReached", l:"Account raggiunti", hint:"Facoltativo · «Account che hanno visualizzato» · lascia vuoto se non disponibile", required:false, signed:false}
];
const INSIGHT_LABELS = Object.fromEntries(INSIGHT_FIELDS.map(f=>[f.k,f.l]));
const MAX_INSIGHTS_HISTORY = 50;
// Intero salvato, oppure null se manca o non è valido: mai sostituito con un altro campo.
const storedInt = v => typeof v==="number" && Number.isSafeInteger(v) ? v
  : typeof v==="string" && /^[+-]?\d+$/.test(v.trim()) ? Number(v.trim()) : null;
const insightValues = app => Object.fromEntries(INSIGHT_FIELDS.map(f=>[f.k, storedInt(app[f.k])]));
// Storico delle correzioni: le candidature corrette prima dello storico conservano solo l'ultima correzione.
const insightsHistoryOf = app => Array.isArray(app.insightsHistory) ? app.insightsHistory
  : (app.insightsCorrection ? [app.insightsCorrection] : []);
const changedKeys = c => INSIGHT_FIELDS.map(f=>f.k).filter(k =>
  c && c.newValues && c.previousValues && Object.hasOwn(c.newValues,k) && c.newValues[k] !== c.previousValues[k]);

/** Provenienza del valore attualmente salvato: correzione dello staff, lettura automatica o candidato. */
const valueOrigin = (app, key) => {
  const current = storedInt(app[key]);
  const last = [...insightsHistoryOf(app)].reverse().find(c => changedKeys(c).includes(key));
  if(last && last.newValues[key] === current) return "Corretto dallo staff · "+fmtDateTime(last.correctedAt);
  const read = key==="followers"
    ? (app.ocrProfile && app.ocrProfile.result && app.ocrProfile.result.followers ? app.ocrProfile.result.followers.value : null)
    : (app.ocrInsights && app.ocrInsights.merged ? app.ocrInsights.merged[key] : null);
  if(current===null) return "Non indicato";
  if(read===null || read===undefined) return "Inserito dal candidato";
  if(Number(read)===current) return "Lettura automatica dello screenshot";
  return "Modificato dal candidato · lettura automatica: "+fmtInt(read);
};

/** Convalida dei valori inseriti dallo staff: un campo vuoto non diventa mai zero. */
const parseInsightInputs = vals => {
  const values = {}, errors = {};
  INSIGHT_FIELDS.forEach(f=>{
    const raw = String(vals[f.k]===undefined||vals[f.k]===null ? "" : vals[f.k]).trim();
    if(raw===""){ if(f.required) errors[f.k]="Dato obbligatorio"; else values[f.k]=null; return; }
    if(!(f.signed ? /^[+-]?\d+$/ : /^\d+$/).test(raw)){ errors[f.k]= f.signed ? "Inserisci un numero intero" : "Inserisci un numero intero non negativo"; return; }
    const n = Number(raw);
    if(!Number.isSafeInteger(n) || Math.abs(n) > 1e12){ errors[f.k]="Valore fuori intervallo"; return; }
    values[f.k] = n;
  });
  return { values, errors };
};

function InsightsEditor({app, scoring, onPatch}){
  const [editing,setEditing] = useState(false);
  const initial = () => Object.fromEntries(Object.entries(insightValues(app)).map(([k,v])=>[k, v===null ? "" : String(v)]));
  const [vals,setVals]         = useState(initial);
  const [fieldErr,setFieldErr] = useState({});
  const [note,setNote]     = useState("");
  const [busy,setBusy]     = useState(false);
  const [msg,setMsg]       = useState("");
  const history = insightsHistoryOf(app);

  const historyList = history.length>0 && (
    <div style={{marginTop:10}}>
      <div className="label-xs" style={{marginBottom:6}}>Storico correzioni ({history.length})</div>
      {[...history].reverse().map((c,i)=>(
        <div key={i} className="body-sm" style={{fontSize:12,padding:"6px 0",borderTop:"1px solid var(--brd)",color:"var(--t3)"}}>
          {fmtDateTime(c.correctedAt)} · {c.correctedBy||"staff"}:{" "}
          {changedKeys(c).length
            ? changedKeys(c).map(k=>INSIGHT_LABELS[k]+" "+fmtMaybe(c.previousValues[k])+" → "+fmtMaybe(c.newValues[k])).join(" · ")
            : "nessun valore cambiato"}
          {c.note ? <> · <em>{c.note}</em></> : null}
        </div>
      ))}
    </div>
  );

  if(!editing) return (
    <div style={{marginTop:10}}>
      <button className="btn btn-ghost btn-sm" onClick={()=>{ setVals(initial()); setFieldErr({}); setMsg(""); setEditing(true); }}>Correggi dati Insights</button>
      {msg && <span className="label-xs" role="status" style={{marginLeft:10,color:"var(--ok)"}}>{msg}</span>}
      {historyList}
    </div>
  );

  const save = async () => {
    if(note.length>MANAGEMENT_LIMITS.insightsNote){ setMsg("La nota sulla correzione può contenere al massimo 2.000 caratteri. Riducila prima di salvare."); return; }
    const { values, errors } = parseInsightInputs(vals);
    setFieldErr(errors);
    if(Object.keys(errors).length){ setMsg("Controlla i valori evidenziati."); return; }
    const previousValues = insightValues(app);
    // Come prima: una correzione senza valori cambiati si registra solo se ha una nota (es. "verificato sullo screenshot").
    if(INSIGHT_FIELDS.every(f=>previousValues[f.k]===values[f.k]) && !note.trim()){ setMsg("Nessun valore modificato."); return; }
    if(history.length >= MAX_INSIGHTS_HISTORY){ setMsg("Storico delle correzioni completo (50 correzioni)."); return; }
    setBusy(true); setMsg("");
    const correction = { correctedAt:new Date().toISOString(), correctedBy:"staff", previousValues, newValues:values, note:note.trim() };
    // Ricalcolo con il modello corrente; lo stato della candidatura non cambia.
    const s = computeScore({ ...app, ...values }, scoring);
    try{
      await onPatch(app.id, {
        ...values,
        insightsCorrection: correction,
        insightsHistory: [...history, correction],
        ...scoreDocumentFields(s)
      });
      setMsg("Dati aggiornati. Punteggio ricalcolato: "+(s.available ? s.socialScore+"/100" : "non calcolabile"));
      setNote(""); setEditing(false);
    }catch(e){ setMsg("Errore nel salvataggio."); }
    finally{ setBusy(false); }
  };

  return (
    <div style={{marginTop:12,border:"1px solid var(--brd)",background:"var(--bg-2)",padding:16}}>
      <div className="h-sm" style={{marginBottom:6}}>Correzione dati Insights</div>
      <p className="body-sm" style={{fontSize:12,marginBottom:14,color:"var(--t3)"}}>
        Confronta sempre i valori con gli screenshot originali prima di correggerli.
        Dopo il salvataggio il punteggio quantitativo viene ricalcolato; lo stato della candidatura non cambia.
        I valori precedenti restano nello storico delle correzioni.
      </p>

      {app.ocrInsights && app.ocrInsights.conflicts && app.ocrInsights.conflicts.length>0 && (
        <div className="status-box" style={{borderColor:"rgba(230,126,34,.45)",marginBottom:12}}>
          <div className="dot" style={{background:"var(--warn)",marginTop:6}}/>
          <div className="body-sm" style={{fontSize:12}}>
            La lettura automatica ha rilevato incongruenze tra i due screenshot su: {app.ocrInsights.conflicts.map(c=>INSIGHT_LABELS[c.key]||c.key).join(", ")}
          </div>
        </div>
      )}
      {app.newFollowers!==undefined && app.netFollowers===undefined && (
        <p className="body-sm" style={{fontSize:12,marginBottom:12,color:"var(--t3)"}}>
          Candidatura del modulo precedente: «nuovi follower» = {fmtMaybe(storedInt(app.newFollowers))}. Non equivale ai follower netti: inseriscili dallo screenshot.
        </p>
      )}

      <div className="g2-gap">
        {INSIGHT_FIELDS.map(f=>(
          <Field key={f.k} label={f.l} hint={f.hint||undefined} required={f.required} error={fieldErr[f.k]}>
            <input type="text" inputMode={f.signed?"text":"numeric"} aria-label={f.l} aria-invalid={fieldErr[f.k]?"true":"false"}
              value={vals[f.k]} onChange={e=>{ const v=e.target.value; setVals(p=>({...p,[f.k]:v})); setFieldErr(p=>({...p,[f.k]:undefined})); }}/>
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
      {historyList}
    </div>
  );
}

/** Bands and classification consume exactly the same validated levels. Raw rates are never classified. */
function ScoreBands({value,levels,label}){
  const classification=CollectiveScoreLevels.classify(value,levels);
  const valid=typeof value==="number"&&Number.isFinite(value)&&value>=0&&value<=100;
  if(!levels)return <div className="body-sm" role="status">Classificazioni non disponibili.</div>;
  return <div style={{margin:"12px 0",minWidth:0}}>
    <div className="label-xs" style={{marginBottom:8,overflowWrap:"anywhere"}}>{label}: {classification ? value.toFixed(2)+"/100 · "+classification.label : "Non disponibile"}</div>
    <div role="img" aria-label={`${label}: ${classification ? value.toFixed(2)+" su 100, "+classification.label : "punteggio non disponibile"}`}
      style={{position:"relative",paddingTop:10,paddingBottom:6}}>
      <div style={{display:"flex",height:16,border:"1px solid var(--brd)",overflow:"hidden"}}>
        {levels.map(l=><div key={l.id} title={`${l.label}: ${l.min}–${l.max}${l.max===100?" (incluso)":" (escluso)"}`}
          data-score-level={l.id} style={{width:(l.max-l.min)+"%",background:l.color}}/>)}
      </div>
      {valid&&<span data-score-marker={label} aria-hidden="true" style={{position:"absolute",left:`clamp(1px, ${value}%, calc(100% - 1px))`,top:3,
        width:2,height:30,background:"var(--t1)",transform:"translateX(-50%)",boxShadow:"0 0 0 1px var(--bg)"}}/>}
    </div>
    <div className="label-xs" style={{display:"flex",justifyContent:"space-between"}}><span>0</span><span>100</span></div>
    <div style={{display:"flex",flexWrap:"wrap",gap:"5px 14px",marginTop:5}}>
      {levels.map(l=><span key={l.id} className="body-sm" style={{fontSize:11,minWidth:0,maxWidth:"100%",overflowWrap:"anywhere"}}><span aria-hidden="true" style={{display:"inline-block",width:8,height:8,background:l.color,marginRight:5}}/>
        {l.label} [{l.min}, {l.max}{l.max===100?"]":")"}</span>)}
    </div>
  </div>;
}

function ScorePart({label, value, sub, score, levels}){
  return (
    <div style={{border:"1px solid var(--brd)",background:"var(--bg-2)",padding:15,minWidth:0}}>
      <div style={{fontFamily:"var(--fh)",fontWeight:600,fontSize:9,letterSpacing:".14em",textTransform:"uppercase",color:"var(--t3)",marginBottom:5}}>{label}</div>
      <div style={{fontFamily:"var(--fh)",fontWeight:800,fontSize:22,color:"var(--t1)",lineHeight:1}}>{value}</div>
      <div className="body-sm" style={{fontSize:11,marginTop:6,lineHeight:1.5}}>{sub}</div>
      {score!==undefined&&<ScoreBands value={score} levels={levels} label={label.split(" · ")[0]}/>}
    </div>
  );
}

function CandidateDetail({app, role, scoring, scoreLevels, onBack, onPatch, onDelete}){
  const s  = computeScore(app, scoring);
  const cfg = scoring || DEFAULT_SCORING;
  const wTot = cfg.weights.engagement + cfg.weights.visibility;
  const share = k => Math.round(cfg.weights[k] / wTot * 100);
  const st = adminStatusMeta(app.status);
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
              {s.lowBase && <Badge color="#E67E22">Base ridotta</Badge>}
            </div>
          </div>
          <div style={{textAlign:"center"}}>
            <ScoreRing value={s.socialScore} color={CollectiveScoreLevels.classify(s.socialScore,scoreLevels?.social)?.color||SCORE_COLOR} size={76} label="SCORE"/>
            <div className="label-xs" style={{marginTop:6,maxWidth:110,lineHeight:1.3}}>Punteggio quantitativo</div>
          </div>
        </div>

        {/* PUNTEGGIO QUANTITATIVO */}
        <Section title={<span>Punteggio quantitativo · scoring v2 (configurazione {s.scoringVersion})</span>}>
          <ScoreBands value={s.socialScore} levels={scoreLevels?.social} label="Social Score"/>
          {!s.available && (
            <div className="status-box" role="status" style={{borderColor:"rgba(230,126,34,.45)",marginBottom:10}}>
              <div className="dot" style={{background:"var(--warn)",marginTop:6}}/>
              <div className="body-sm" style={{fontSize:12}}>
                {s.unavailableReason==="noViews"
                  ? "Punteggio non disponibile: con zero visualizzazioni il coinvolgimento non è calcolabile. Lo zero resta salvato come dato osservato."
                  : <>Punteggio non calcolabile: mancano valori validi per {s.missing.map(k=>INSIGHT_LABELS[k]).join(" e ")}. Correggi i dati Insights.</>}
              </div>
            </div>
          )}
          <div className="g3-keep" style={{marginBottom:10}}>
            <ScorePart label={"Coinvolgimento · "+share("engagement")+"%"} value={fmtPct(s.engagementRate)}
              score={s.engagementScore} levels={scoreLevels?.metrics}
              sub={<>Interazioni / visualizzazioni{s.engagementScore!==null && <> · {Math.round(s.engagementScore)}/100</>}</>}/>
            <ScorePart label={"Visibilità · "+share("visibility")+"%"} value={fmtMaybe(s.views)}
              score={s.visibilityScore} levels={scoreLevels?.metrics}
              sub={<>Visualizzazioni in 30 giorni{s.visibilityScore!==null && <> · {Math.round(s.visibilityScore)}/100</>}</>}/>
            <ScorePart label="Indicatore B" value={fmtPct(s.reachEngagementRate)}
              sub={s.reachEngagementRate===null ? "Interazioni / account raggiunti · non disponibile" : "Interazioni / account raggiunti · non incide sul punteggio"}/>
          </div>
          {s.lowBase && (
            <div className="status-box" role="status" style={{borderColor:"rgba(230,126,34,.45)",marginBottom:10}}>
              <div className="dot" style={{background:"var(--warn)",marginTop:6}}/>
              <div className="body-sm" style={{fontSize:12}}>
                {LOW_BASE_TEXT} {s.lowBaseReasons.map(k=>k==="views"
                  ? "Visualizzazioni sotto "+fmtInt(cfg.lowBase.views)+"."
                  : "Interazioni sotto "+fmtInt(cfg.lowBase.interactions)+".").join(" ")}
              </div>
            </div>
          )}
          {typeof app.socialScore==="number" && app.scoringVersion!==SCORING_VERSION && (
            <p className="body-sm" style={{fontSize:12,marginBottom:10,color:"var(--t3)"}}>
              Punteggio registrato all'invio con il modello precedente: {app.socialScore}/100. Non è confrontabile con quello attuale e non viene usato.
            </p>
          )}
          {typeof app.socialScore==="number" && app.scoringVersion===SCORING_VERSION && s.available && app.socialScore!==s.socialScore && (
            <p className="body-sm" style={{fontSize:12,marginBottom:10,color:"var(--t3)"}}>
              Punteggio registrato all'ultimo salvataggio: {app.socialScore}/100 (calcolato con una configurazione diversa da quella attuale).
            </p>
          )}
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
            <KV k="Follower Instagram" v={<>{fmtMaybe(s.followers)}<div className="label-xs" style={{marginTop:4,color:"var(--t4)"}}>{valueOrigin(app,"followers")}</div></>}/>
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
            {[["views",fmtMaybe(s.views)],["interactions",fmtMaybe(s.interactions)],
              ["netFollowers",s.netFollowers===null?"—":(s.netFollowers>0?"+":"")+fmtInt(s.netFollowers)],
              ["accountsReached",fmtMaybe(s.accountsReached)]].map(([k,v])=>(
              <KV key={k} k={INSIGHT_LABELS[k]} v={<>{v}<div className="label-xs" style={{marginTop:4,color:"var(--t4)"}}>{valueOrigin(app,k)}</div></>}/>
            ))}
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
                Valutazione manuale del team. Non è collegata al punteggio quantitativo e non è visibile al candidato.
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
            {!PRIMARY_STATUS_KEYS.has(adminStatusKey(app.status)) && (
              <p className="body-sm" role="status" style={{marginBottom:12}}>
                Stato storico attuale: <strong>{st.l}</strong>. Rimane invariato finché non selezioni uno dei quattro stati.
              </p>
            )}
            <div className="chips" role="group" aria-label="Seleziona stato candidatura" style={{marginBottom:20}}>
              {PRIMARY_STATUSES.map(x=>(
                <button key={x.v} className={"chip"+(adminStatusKey(app.status)===x.v?" chip-on":"")}
                  aria-pressed={adminStatusKey(app.status)===x.v}
                  style={adminStatusKey(app.status)===x.v ? {background:x.c,borderColor:x.c} : null}
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
// Campi della configurazione (versione 3). Un campo vuoto o non valido blocca il salvataggio: nessuno zero implicito.
const scoreLevelsMessage=error=>({
  LEVEL_COUNT:"Il numero di livelli deve rispettare il limite configurato per il gruppo.",MAX_LEVELS:"Il limite deve essere un numero intero da 1 a 100.",ID:"Gli identificativi dei livelli devono essere univoci.",
  LABEL:"Inserisci un nome da 1 a 80 caratteri, senza caratteri di controllo.",COLOR:"Scegli un colore nel formato #RRGGBB.",
  BOUNDARY:"Gli estremi devono essere numeri interi da 0 a 100.",EMPTY_INTERVAL:"Ogni intervallo deve avere un estremo finale maggiore di quello iniziale.",
  COVERAGE:"Gli intervalli devono iniziare da 0 e terminare a 100.",GAP:"Ci sono valori scoperti: la fine di una fascia deve coincidere con l'inizio della successiva.",
  OVERLAP:"Gli intervalli si sovrappongono: la fine di una fascia deve coincidere con l'inizio della successiva."
}[error.code]||"Configurazione dei livelli non valida.");

function ScoreLevelsPanel({state,onSaved,onRetry,onAuthRequired}){
  const [draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  useEffect(()=>{setDraft(state.config?JSON.parse(JSON.stringify(state.config)):null);},[state.config]);
  let validated=null,validationError="";
  if(draft)try{validated=CollectiveScoreLevels.validateConfig(draft);}catch(e){validationError=scoreLevelsMessage(e);}
  const edit=(group,id,key,value)=>setDraft(p=>({...p,[group]:p[group].map(l=>l.id===id?{...l,[key]:value}:l)}));
  const add=group=>setDraft(p=>{
    const rows=[...p[group]],largest=rows.reduce((a,b)=>(b.max-b.min>a.max-a.min?b:a));
    if(rows.length>=p.maxLevels[group]||largest.max-largest.min<2)return p;
    const middle=Math.floor((largest.min+largest.max)/2);
    return{...p,[group]:rows.flatMap(l=>l.id!==largest.id?[l]:[{...l,max:middle},{...l,id:crypto.randomUUID(),label:"Nuovo livello",min:middle}])};
  });
  const remove=(group,index)=>setDraft(p=>{
    if(p[group].length===1)return p;
    const rows=p[group].map(l=>({...l})),old=rows[index];
    if(index>0)rows[index-1].max=old.max;else rows[1].min=old.min;
    rows.splice(index,1);return{...p,[group]:rows};
  });
  const save=async()=>{
    if(busy||!validated)return;
    setBusy(true);setMessage("");
    try{await FB.saveScoreLevels(validated);onSaved(validated);setMessage("Livelli salvati. Punteggi numerici invariati.");}
    catch(e){setMessage(e instanceof CollectiveAdminScoring.ScoringSaveError?e.message:"Salvataggio non confermato. Riprova più tardi.");
      if(e.code==="LOGIN_REQUIRED")await onAuthRequired(e.message);}
    finally{setBusy(false);}
  };
  return <div style={{flex:1,overflow:"auto"}}><div className="wrap-panel" style={{padding:"22px 16px 80px",maxWidth:1000}}>
    <h2 className="h-md">Livelli e colori</h2>
    <p className="body-sm" style={{margin:"12px 0"}}>Queste fasce classificano punteggi già calcolati: non modificano formule, pesi o candidature.
      Gli estremi iniziali sono inclusi, quelli finali esclusi; 100 è incluso nell'ultima fascia. Il limite è configurabile per gruppo, fino a 100 livelli.</p>
    {state.status==="default"&&<p role="status" className="body-sm">Configurazione assente: sono attivi i livelli storici predefiniti. Verranno creati soltanto con Salva livelli.</p>}
    {state.status==="loading"&&<p role="status">Caricamento livelli…</p>}
    {state.status==="error"&&<div role="alert">Impossibile leggere una configurazione valida. Nessun valore predefinito è stato applicato al posto di una lettura fallita.
      <button className="btn btn-ghost" onClick={onRetry}>Riprova lettura livelli</button></div>}
    {draft&&<fieldset disabled={busy} style={{border:0,padding:0,minWidth:0}}>
      {[["social","Social Score"],["metrics","Singole metriche"]].map(([group,title])=><section className="panel" key={group} style={{padding:16,margin:"18px 0"}}>
        <h3 className="h-sm">{title}</h3>
        <label className="body-sm">Limite livelli del gruppo
          <input aria-label={`${title}: limite livelli`} type="number" min="1" max={CollectiveScoreLevels.HARD_MAX_LEVELS} step="1" value={draft.maxLevels[group]}
            onChange={e=>{const value=e.target.value===""?"":Number(e.target.value);setDraft(p=>({...p,maxLevels:{...p.maxLevels,[group]:value}}));}}/>
        </label>
        <div style={{overflowX:"auto",marginTop:12}}><table style={{width:"100%",minWidth:560}}>
          <thead><tr><th>Nome</th><th>Colore</th><th>Da incluso</th><th>A escluso*</th><th>Azioni</th></tr></thead>
          <tbody>{draft[group].map((l,index)=><tr key={l.id}>
            <td><input aria-label={`${title}: nome ${index+1}`} value={l.label} maxLength={80} onChange={e=>edit(group,l.id,"label",e.target.value)}/></td>
            <td><input aria-label={`${title}: colore ${index+1}`} type="color" value={l.color} onChange={e=>edit(group,l.id,"color",e.target.value)}/></td>
            {["min","max"].map(k=><td key={k}><input aria-label={`${title}: ${k==="min"?"da":"a"} ${index+1}`} type="number" min="0" max="100" step="1" value={l[k]}
              onChange={e=>edit(group,l.id,k,e.target.value===""?"":Number(e.target.value))}/></td>)}
            <td><button className="btn btn-ghost btn-sm" disabled={draft[group].length===1} onClick={()=>remove(group,index)} aria-label={`${title}: elimina ${index+1}`}>Elimina</button></td>
          </tr>)}</tbody>
        </table></div>
        <button className="btn btn-ghost btn-sm" onClick={()=>add(group)} disabled={!validated||draft[group].length>=draft.maxLevels[group]||!draft[group].some(l=>l.max-l.min>=2)}>Aggiungi livello {title}</button>
        <ScoreBands value={50} levels={validated?.[group]} label={`Anteprima ${title}`}/>
      </section>)}
      <p className="body-sm">* 100 incluso. Aggiungi divide la fascia più ampia; Elimina la unisce alla vicina. Le modifiche restano locali fino al salvataggio.</p>
      {validationError&&<p role="alert" style={{color:"var(--bad)"}}>{validationError}</p>}
      <button className="btn btn-primary" disabled={!validated} onClick={save}>{busy?"Salvataggio livelli…":"Salva livelli"}</button>
      <button className="btn btn-ghost" onClick={()=>{setDraft(CollectiveScoreLevels.defaults());setMessage("");}}>Ripristina livelli predefiniti</button>
    </fieldset>}
    {message&&<p role="status">{message}</p>}
  </div></div>;
}


function BenchmarkPanel({onAuthRequired}){
  const B=CollectiveScoreLevels.benchmarks;
  const [draft,setDraft]=useState(null),[metric,setMetric]=useState('engagement'),[band,setBand]=useState(2),[level,setLevel]=useState(0),[linked,setLinked]=useState(true);
  const [message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
  const [axisMax,setAxisMax]=useState(()=>{
    const fallback={...B.axisDefaults};try{const saved=JSON.parse(localStorage.getItem('evora-benchmark-axis-v2'));for(const key of B.metrics)if(typeof saved?.[key]==='number'&&Number.isFinite(saved[key])&&saved[key]>=0.01&&saved[key]<=1000000)fallback[key]=saved[key];}catch{}return fallback;
  });
  const clipId=React.useId().replace(/:/g,'');
  useEffect(()=>{try{localStorage.setItem('evora-benchmark-axis-v2',JSON.stringify(axisMax));}catch{}},[axisMax]);
  async function readSaved(){const doc=await db.collection('settings').doc('instagramBenchmarks').get({source:'server'});return doc.exists?B.fromDocument(doc.data()):null;}
  useEffect(()=>{let alive=true;setDraft(null);setError('');
    readSaved().then(config=>{if(alive){setDraft(config?B.upgrade(config):B.defaults());setMessage(!config?'Configurazione assente: valori predefiniti, non ancora salvati.':config.interpolation===B.CURRENT_INTERPOLATION?'Benchmark caricati dal server.':'Valori salvati conservati. Nuova interpolazione applicata soltanto alla bozza: premi Salva per adottarla.');}})
    .catch(()=>{if(alive)setError('Impossibile leggere i benchmark. Nessun valore è stato sostituito.');});return()=>{alive=false;};},[reload]);
  const names=['Medio','Buono','Eccellente'],colors=['#ff535f','#3392ff','#32d881'];
  function change(value){try{setDraft(B.edit(draft,metric,band,level,value,linked));setError('');setMessage('Bozza modificata, non ancora salvata.');}catch{setError('Modifica bloccata: servono valori tra 0 e 100.000%, con Medio < Buono < Eccellente.');}}
  async function save(){
    if(busy)return;setBusy(true);setError('');setMessage('Salvataggio e verifica sul server…');
    try{
      const config=B.validateConfig(draft),user=auth.currentUser;
      await CollectiveAdminScoring.saveBenchmarks({endpoint:WORKER_BASE+'/admin/benchmarks',auth,config});
      const stored=await readSaved();
      if(auth.currentUser!==user)throw new CollectiveAdminScoring.ScoringSaveError('LOGIN_REQUIRED','Sessione cambiata. Accedi nuovamente.');
      if(!stored||!B.same(stored,config))throw Error('Verifica non riuscita: i valori riletti dal server non coincidono. La bozza è conservata; nessuna nuova scrittura automatica.');
      setDraft(stored);setMessage('Benchmark salvati e verificati sul server. Punteggi numerici invariati.');
    }catch(e){setMessage('');if(e.code==='LOGIN_REQUIRED')onAuthRequired();else setError(e.message||'Verifica del salvataggio non riuscita. Bozza conservata.');}finally{setBusy(false);}
  }
  if(!draft)return <section className="wrap-panel" style={{padding:24}}>{error?<><p role="alert">{error}</p><button className="btn btn-ghost" onClick={()=>setReload(n=>n+1)}>Riprova lettura benchmark</button></>:<p>Caricamento benchmark…</p>}</section>;
  const rows=draft[metric],top=axisMax[metric],outside=Math.max(...rows.flat())>top;
  const x=f=>60+820*B.axisPosition(f),y=v=>300-260*v/top;
  const points=Array.from({length:321},(_,i)=>{const f=1000*Math.pow(500,i/320);return{x:x(f),values:B.thresholds(draft,metric,f)};});
  const path=j=>points.map((p,i)=>(i?'L':'M')+p.x+','+y(p.values[j])).join(' ');
  const area=(lo,hi)=>path(hi)+' '+[...points].reverse().map(p=>'L'+p.x+','+y(p.values[lo])).join(' ')+' Z';
  const selected=rows[band][level];
  const setScale=value=>{if(Number.isFinite(value)&&value>=0.01&&value<=1000000)setAxisMax(old=>({...old,[metric]:value}));};
  return <section className="benchmark-page">
    <style>{`.benchmark-page{width:100%;min-width:0;padding:26px;max-width:1500px;margin:auto;background:radial-gradient(ellipse at 95% 0,rgba(150,22,32,.14),transparent 55%)}.benchmark-head,.benchmark-actions{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center}.benchmark-page .btn{border-radius:8px;letter-spacing:0;text-transform:none;font-family:var(--fb);font-size:14px}.benchmark-page .btn-primary{background:linear-gradient(135deg,#e73945,#a71926);box-shadow:0 4px 18px #b31b2a33}.benchmark-page input,.benchmark-page select{border-radius:8px}.benchmark-page input[type=range]{accent-color:#ee414f}.benchmark-tabs{display:flex;flex-wrap:wrap;gap:8px;margin:22px 0}.benchmark-layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:16px}.benchmark-card{background:linear-gradient(130deg,#131719,#0d1012);border:1px solid #30383e;border-radius:14px;padding:20px;min-width:0}.benchmark-card input,.benchmark-card select{width:100%}.benchmark-table{width:100%;border-collapse:collapse}.benchmark-table th,.benchmark-table td{padding:13px;text-align:left;border-bottom:1px solid #30383e}.benchmark-chart{width:100%;min-width:420px}.benchmark-control{display:grid;gap:14px}.benchmark-table-wrap{overflow:auto;margin-top:16px}@media(max-width:900px){.benchmark-layout{grid-template-columns:1fr}.benchmark-page{padding:16px}.benchmark-chart{min-width:560px}}`}</style>
    <header className="benchmark-head"><div><h2 className="h-md">Configurazione Scoring</h2><p className="body-sm">Definisci i riferimenti osservati per fascia follower. Nessun effetto sullo scoring attuale.</p></div><div className="benchmark-actions"><button className="btn btn-ghost" disabled={busy} onClick={()=>{setDraft(B.defaults());setError('');setMessage('Valori predefiniti ripristinati nella bozza. Premi Salva per confermare.');}}>Ripristina valori predefiniti</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy?'Salvataggio…':'Salva benchmark'}</button></div></header>
    <nav className="benchmark-tabs" aria-label="Metrica benchmark">{[['engagement','Engagement'],['reach','Reach'],['growth','Growth']].map(([key,label])=><button key={key} className={'btn '+(metric===key?'btn-primary':'btn-ghost')} aria-pressed={metric===key} disabled={busy} onClick={()=>{setMetric(key);setError('');}}>{label}</button>)}</nav>
    <p className="body-sm">{metric==='engagement'?'Engagement: soglie sperimentali non validate. Interazioni / account raggiunti.':metric==='reach'?'Reach: riferimenti storici provvisori. Account raggiunti / follower.':'Growth: riferimenti storici provvisori. Follower netti / follower iniziali.'} Valori in percentuale; le regolazioni sono in punti percentuali.</p>
    <div className="benchmark-layout"><div className="benchmark-card"><h3 className="h-sm">{metric==='engagement'?'Engagement':metric==='reach'?'Reach':'Growth'} per fascia follower</h3><div style={{display:'flex',gap:20,margin:'16px 0'}}>{names.map((n,j)=><span key={n} style={{color:colors[j]}}>● {n}</span>)}</div><div style={{overflowX:'auto'}}><svg className="benchmark-chart" viewBox="0 0 920 360" role="img" aria-label={`Curve benchmark ${metric}; interpolazione cubica ordinata`} data-axis-max={top}>
      {[0,1,2,3,4].map(i=><g key={i}><line x1="60" x2="880" y1={y(top*i/4)} y2={y(top*i/4)} stroke="#2b3339"/><text x="53" y={y(top*i/4)+4} fill="#b9c1ca" fontSize="12" textAnchor="end">{(top*i/4).toLocaleString('it-IT',{maximumSignificantDigits:21})}%</text></g>)}
      <defs><clipPath id={clipId}><rect x="60" y="40" width="820" height="260"/></clipPath></defs>
      <g clipPath={`url(#${clipId})`}><path d={area(0,1)} fill="#3392ff" opacity=".09"/><path d={area(1,2)} fill="#32d881" opacity=".09"/>
      {names.map((n,j)=><path key={n} d={path(j)} fill="none" stroke={colors[j]} strokeWidth="2.5"/>)}</g>
      {draft.followers.map((f,i)=><g key={f}><line x1={x(f)} x2={x(f)} y1="30" y2="300" stroke={i===band?'#a53c46':'#20282c'}/><text x={x(f)} y="330" textAnchor="middle" fill={i===band?'#fff':'#aab3be'} fontSize="13">{f/1000}K</text>{names.map((n,j)=><circle key={n} cx={x(f)} cy={y(rows[i][j])} clipPath={`url(#${clipId})`} r={i===band&&(linked||j===level)?8:5} fill={colors[j]} stroke="white" strokeWidth="1.5" role="button" tabIndex="0" aria-label={`${f} follower ${n}`} onClick={()=>{if(!busy){setBand(i);setLevel(j);}}} onKeyDown={e=>{if(!busy&&(e.key==='Enter'||e.key===' ')){e.preventDefault();setBand(i);setLevel(j);}}}/>)}</g>)}
    </svg></div><p className="body-sm">Soglie interpolate sui logaritmi dei follower. Asse X non uniforme, ridistribuito per leggibilità. Estremi costanti sotto 1.000 e sopra 500.000 follower.</p></div>
    <aside className="benchmark-card benchmark-control"><label>Fascia follower selezionata<select aria-label="Fascia benchmark" value={band} disabled={busy} onChange={e=>setBand(Number(e.target.value))}>{draft.followers.map((f,i)=><option key={f} value={i}>{f.toLocaleString('it-IT')} follower{ i===4?' (riferimento oltre 100.000)':''}</option>)}</select></label>
      {names.map((n,j)=><div key={n} style={{display:'flex',justifyContent:'space-between',color:colors[j]}}><span>{n}</span><strong>{rows[band][j].toLocaleString('it-IT',{maximumSignificantDigits:21})}%</strong></div>)}
      <label><input type="checkbox" style={{width:'auto',marginRight:8}} checked={linked} disabled={busy} onChange={e=>setLinked(e.target.checked)}/>Muovi insieme i 3 livelli</label><p className="body-sm">{linked?'Sposta solo questa fascia, mantenendo le distanze tra i tre valori.':'Modifica soltanto la soglia selezionata.'}</p>
      <label>Soglia<select aria-label="Soglia benchmark" value={level} disabled={busy} onChange={e=>setLevel(Number(e.target.value))}>{names.map((n,j)=><option key={n} value={j}>{n}</option>)}</select></label>
      <label>Valore percentuale<input aria-label="Valore benchmark" type="number" step="any" min="0" max="100000" value={selected} disabled={busy} onChange={e=>{if(e.target.value!=='')change(e.target.valueAsNumber);}}/></label>
      <input aria-label="Regolazione benchmark" type="range" min="0" max={Math.min(100000,Math.max(top,selected*1.5))} step="0.01" value={selected} disabled={busy} onChange={e=>change(Number(e.target.value))}/>
      <label>Massimo asse Y (%)<input aria-label="Massimo asse Y" type="number" min="0.01" max="1000000" step="any" value={top} onChange={e=>{if(e.target.value!=='')setScale(e.target.valueAsNumber);}}/></label>
      <button className="btn btn-ghost" onClick={()=>setScale(B.fitY(rows))}>Adatta scala ai valori</button>
      <p className="body-sm">Scala Y fissa: {top.toLocaleString('it-IT')}%. Si conserva in questo browser se l’archiviazione locale è disponibile; non modifica i benchmark.</p>

    </aside></div>
    {outside&&<p role="status" style={{color:'var(--warn)'}}>Valori fuori scala: massimo {Math.max(...rows.flat()).toLocaleString('it-IT')}%. I dati sono conservati; aumenta il massimo Y oppure usa «Adatta scala ai valori».</p>}
    {error&&<p role="alert" style={{color:'var(--bad)'}}>{error}</p>}{message&&<p role="status">{message}</p>}
    <div className="benchmark-card benchmark-table-wrap"><table className="benchmark-table"><caption>Riepilogo benchmark — {metric}</caption><thead><tr><th>Follower (riferimento)</th>{names.map(n=><th key={n}>{n}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}><th>{draft.followers[i].toLocaleString('it-IT')}</th>{row.map((v,j)=><td key={j} style={{color:colors[j]}}>{v.toLocaleString('it-IT',{maximumSignificantDigits:21})}%</td>)}</tr>)}</tbody></table></div>
  </section>;
}

const SCORING_FIELDS = [
  {g:"weights",    k:"engagement",     l:"Coinvolgimento",            hint:"Interazioni / visualizzazioni", step:"1",   int:false},
  {g:"weights",    k:"visibility",     l:"Visibilità",                hint:"Volume delle visualizzazioni",  step:"1",   int:false},
  {g:"references", k:"engagementRate", l:"Coinvolgimento di riferimento (%)", hint:"Vale 50/100",       step:"0.1", int:false},
  {g:"references", k:"views",          l:"Visualizzazioni di riferimento",    hint:"Valgono 50/100",    step:"1000",int:false},
  {g:"lowBase",    k:"views",          l:"Visualizzazioni minime",    hint:"Sotto questa soglia la base è segnalata come ridotta", step:"100", int:true},
  {g:"lowBase",    k:"interactions",   l:"Interazioni minime",        hint:"Sotto questa soglia la base è segnalata come ridotta", step:"1",   int:true}
];
const toScoringDraft = cfg => Object.fromEntries(SCORING_FIELDS.map(f=>[f.g+"."+f.k, String(cfg[f.g][f.k])]));
/** Configurazione completa dal modulo, oppure gli errori per campo. Il Worker la convalida di nuovo. */
const scoringFromDraft = draft => {
  const cfg = { version:SCORING_VERSION, weights:{}, references:{}, lowBase:{} }, errors = {};
  SCORING_FIELDS.forEach(f=>{
    const key = f.g+"."+f.k, raw = String(draft[key]||"").trim().replace(",",".");
    const n = raw==="" ? NaN : Number(raw);
    if(!Number.isFinite(n) || n<0 || (f.int && !Number.isInteger(n))) { errors[key] = f.int ? "Numero intero non negativo" : "Numero non negativo"; return; }
    cfg[f.g][f.k] = n;
  });
  if(!errors["weights.engagement"] && !errors["weights.visibility"]){
    if(cfg.weights.engagement>100) errors["weights.engagement"]="Massimo 100";
    if(cfg.weights.visibility>100) errors["weights.visibility"]="Massimo 100";
    if(cfg.weights.engagement+cfg.weights.visibility<=0) errors["weights.engagement"]="La somma dei pesi deve essere maggiore di zero";
  }
  if(!errors["references.engagementRate"] && (cfg.references.engagementRate<=0 || cfg.references.engagementRate>100)) errors["references.engagementRate"]="Tra 0 (escluso) e 100";
  if(!errors["references.views"] && cfg.references.views<1) errors["references.views"]="Almeno 1";
  return { cfg, errors };
};

function ScoringPanel({scoring, onSaved, onAuthRequired}){
  const [draft,setDraft]   = useState(()=>toScoringDraft(scoring));
  const [errors,setErrors] = useState({});
  const [busy,setBusy] = useState(false);
  const [msg,setMsg]   = useState("");

  const w = scoringFromDraft(draft).cfg.weights;
  const wTot = (w.engagement||0)+(w.visibility||0);

  const save = async ()=>{
    if(busy) return;
    const { cfg, errors:e } = scoringFromDraft(draft);
    setErrors(e);
    if(Object.keys(e).length){ setMsg("Controlla i valori evidenziati."); return; }
    setBusy(true); setMsg("");
    try{
      await FB.saveScoring(cfg);
      onSaved(normalizeScoring(cfg));
      setMsg("Configurazione salvata"); setTimeout(()=>setMsg(""),2200);
    }catch(err){
      const known=err instanceof CollectiveAdminScoring.ScoringSaveError;
      setMsg(known ? err.message : "Errore nel salvataggio. Riprova più tardi.");
      if(known && err.code==="LOGIN_REQUIRED") await onAuthRequired(err.message);
    }
    finally{ setBusy(false); }
  };

  const fields = g => SCORING_FIELDS.filter(f=>f.g===g).map(f=>{
    const key = f.g+"."+f.k;
    return (
      <Field key={key} label={f.l} hint={f.hint} error={errors[key]}>
        <input type="number" min="0" step={f.step} value={draft[key]} aria-label={f.l} aria-invalid={errors[key]?"true":"false"}
          onChange={e=>{ const v=e.target.value; setDraft(p=>({...p,[key]:v})); setErrors(p=>({...p,[key]:undefined})); }}/>
      </Field>
    );
  });

  return (
    <div style={{flex:1,overflow:"auto"}}>
      <div className="wrap-panel" style={{padding:"22px 16px 80px",maxWidth:900}}>
        <h2 className="h-md" style={{marginBottom:6}}>Configurazione del punteggio quantitativo</h2>
        <p className="body-sm" style={{marginBottom:24,maxWidth:640}}>
          Scoring v2 (configurazione {SCORING_VERSION}). Il punteggio valuta esclusivamente i dati numerici Instagram degli ultimi 30 giorni:
          non analizza le risposte, non approva e non rifiuta candidature. Ogni componente è normalizzata in modo continuo:
          il valore di riferimento vale 50/100, senza fasce follower né soglie. I riferimenti iniziali sono sperimentali.
          Le modifiche ricalcolano anche i punteggi mostrati per le candidature già ricevute.
        </p>

        <div className="panel" style={{padding:18,marginBottom:14}}>
          <div className="h-sm" style={{marginBottom:4}}>Pesi</div>
          <div className="body-sm" style={{marginBottom:16}}>
            Somma attuale: <strong style={{color: wTot===100 ? "var(--ok)" : "var(--warn)"}}>{Number.isFinite(wTot)?wTot:"—"}</strong>
            {wTot!==100 && " — i valori vengono comunque normalizzati automaticamente."}
          </div>
          <div className="g2-gap">{fields("weights")}</div>
        </div>

        <div className="panel" style={{padding:18,marginBottom:14}}>
          <div className="h-sm" style={{marginBottom:4}}>Riferimenti</div>
          <div className="body-sm" style={{marginBottom:16}}>Punteggio di ciascuna componente = 100 × ln(1 + valore/riferimento) / [ln(1 + valore/riferimento) + ln 2].</div>
          <div className="g2-gap">{fields("references")}</div>
        </div>

        <div className="panel" style={{padding:18}}>
          <div className="h-sm" style={{marginBottom:4}}>Base di osservazione ridotta</div>
          <div className="body-sm" style={{marginBottom:16}}>Solo una segnalazione per lo staff: il punteggio non viene corretto.</div>
          <div className="g2-gap">{fields("lowBase")}</div>
        </div>

        <div style={{display:"flex",gap:10,marginTop:20,flexWrap:"wrap",alignItems:"center"}}>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy?"Salvataggio…":"Salva configurazione"}</button>
          <button className="btn btn-ghost" onClick={()=>{ setDraft(toScoringDraft(DEFAULT_SCORING)); setErrors({}); }}>Ripristina valori iniziali</button>
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
                Pesi e riferimenti dello scoring · Impostazioni
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
// An old cached HTML page may fetch the current app/admin.jsx at an old ?v= URL.
// Load missing dependencies before mounting panels; no redirects and no production fallback.
const SCORE_LEVEL_BOOT_ASSETS = ["public/score-levels.js?v=ef68737513bd2b1d","public/admin-scoring-client.js?v=5284c02816765c0f"];
const scoreLevelAssetsReady=()=>typeof CollectiveScoreLevels!=="undefined"&&typeof CollectiveAdminScoring!=="undefined"&&typeof CollectiveAdminScoring.saveScoreLevels==="function"&&typeof CollectiveAdminScoring.saveBenchmarks==="function"&&typeof CollectiveScoreLevels.benchmarks?.axisPosition==="function";
let scoreLevelAssetsPromise;
function loadScoreLevelAssets(){
  if(scoreLevelAssetsReady())return Promise.resolve();
  if(!scoreLevelAssetsPromise)scoreLevelAssetsPromise=Promise.all(SCORE_LEVEL_BOOT_ASSETS.map(path=>new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src=(/\/admin\/(index\.html)?$/.test(location.pathname)?"../":"./")+path;
    script.onload=resolve;script.onerror=()=>reject(new Error("Score level assets unavailable"));document.head.appendChild(script);
  }))).then(()=>{if(!scoreLevelAssetsReady())throw new Error("Score level assets invalid");});
  return scoreLevelAssetsPromise;
}
function AdminPanel({onBack, onTestForm}){
  const [assetsStatus,setAssetsStatus]=useState(()=>scoreLevelAssetsReady()?"ready":"loading");
  useEffect(()=>{let alive=true;loadScoreLevelAssets().then(()=>{if(alive)setAssetsStatus("ready");}).catch(()=>{if(alive)setAssetsStatus("error");});return()=>{alive=false;};},[]);
  const [role,setRole]       = useState(null);
  const [ready,setReady]     = useState(false);   // sessione già verificata?
  const [code,setCode]       = useState("");
  const [err,setErr]         = useState("");
  const [checking,setChk]    = useState(false);
  const [tab,setTab]         = useState("apps");
  const [scoring,setScoring] = useState(DEFAULT_SCORING);
  const [levelsState,setLevelsState]=useState({status:"loading",config:null});
  const [levelsReload,setLevelsReload]=useState(0);

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

  useEffect(()=>{
    let alive=true;
    setLevelsState({status:"loading",config:null});
    if(!role||assetsStatus!=="ready")return()=>{alive=false;};
    FB.getScoreLevels().then(config=>{if(alive)setLevelsState({status:config?"ready":"default",config:config||CollectiveScoreLevels.defaults()});})
      .catch(()=>{if(alive)setLevelsState({status:"error",config:null});});
    return()=>{alive=false;};
  },[role,levelsReload,assetsStatus]);

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

  if(assetsStatus==="error")return <div role="alert" className="wrap-panel">Impossibile caricare i moduli dei livelli. Ricarica la pagina o riprova più tardi.</div>;
  if(!ready||assetsStatus!=="ready") return (
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
          {isAdmin && <button className={"tab"+(tab==="scoring"?" tab-on":"")} onClick={()=>setTab("scoring")}>Configurazione Scoring</button>}
          {isAdmin && <button className={"tab"+(tab==="levels"?" tab-on":"")} onClick={()=>setTab("scoring")}>Livelli e colori</button>}
          {isAdmin && <button className={"tab"+(tab==="settings"?" tab-on":"")} onClick={()=>setTab("settings")}>Impostazioni</button>}
        </div>
      </div>

      {levelsState.status==="error"&&<p role="alert">Classificazioni non disponibili: errore nella lettura dei livelli. I punteggi numerici restano disponibili.</p>}
      {tab==="apps"     && <ApplicationsPanel role={role} scoring={scoring} scoreLevels={levelsState.config}/>}
      {tab==="scoring" && isAdmin && <><BenchmarkPanel onAuthRequired={requireLogin}/><details className="wrap-panel"><summary>Formule attuali e parametri numerici (invariati)</summary><ScoringPanel scoring={scoring} onSaved={setScoring} onAuthRequired={requireLogin}/></details><details className="wrap-panel"><summary>Livelli numerici e colori</summary><ScoreLevelsPanel state={levelsState} onSaved={config=>setLevelsState({status:"ready",config})} onRetry={()=>setLevelsReload(n=>n+1)} onAuthRequired={requireLogin}/></details></>}
      {tab==="levels"&&isAdmin&&<ScoreLevelsPanel state={levelsState} onSaved={config=>setLevelsState({status:"ready",config})}
        onRetry={()=>setLevelsReload(n=>n+1)} onAuthRequired={requireLogin}/>}
      {tab==="settings" && isAdmin && <SettingsPanel/>}
    </div>
  );
}


/* ---------- fine di app/admin.jsx ---------- */
CollectiveModules.add("app/admin.jsx");
