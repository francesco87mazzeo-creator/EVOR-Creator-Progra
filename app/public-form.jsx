/* app/public-form.jsx — landing, verifica Instagram, modulo di candidatura e OCR (usato anche dalla simulazione staff)
   Codice spostato senza modifiche da index.html (main @ eec5d29). */

/* ============================================================================
   3. OCR — lettura automatica Insights.
   Formato richiesta identico all'originale: NON modificare senza aggiornare
   il Cloudflare Worker.
   ========================================================================== */
const extractInsights = async (base64Image) => {
  const parts = base64Image.split(",");
  const base64Data = parts[1];
  const mediaType = parts[0].split(":")[1].split(";")[0];

  let res;
  try{
    res = await fetch(OCR_PROXY, {
      method:"POST",
      // La chiave Anthropic resta nei secret del Worker: il browser non la vede mai.
      headers:{
        "Content-Type":"application/json",
        "anthropic-version":"2023-06-01"
      },
      body: JSON.stringify({
        model: OCR_MODEL,
        max_tokens: 200,
        messages:[{
          role:"user",
          content:[
            { type:"image", source:{ type:"base64", media_type:mediaType, data:base64Data } },
            { type:"text", text:"Analizza questo screenshot Instagram e classificalo. Rispondi SOLO con questo JSON, senza altro testo:\n{\"screen_type\":\"insights_ok\",\"views\":{\"value\":null,\"visibility\":\"not_visible\"},\"netFollowers\":{\"value\":null,\"visibility\":\"not_visible\"},\"interactions\":{\"value\":null,\"visibility\":\"not_visible\"},\"accountsReached\":{\"value\":null,\"visibility\":\"not_visible\"}}\n\nscreen_type deve essere uno dei tre valori:\n- \"insights_ok\" se la schermata mostra i marker della pagina Insight corretta: titolo \"Insight\" con tabs \"Generale/Contenuti/Pubblico\", oppure \"Tutti i contenuti\", oppure box con \"Follower netti\" e \"Interazioni\", oppure \"Account raggiunti\" o \"Account che hanno visualizzato\" o \"Visualizzazioni per tipo di contenuto\". Basta uno o più di questi marker in combinazione coerente.\n- \"dashboard_wrong\" se la schermata mostra il titolo \"Dashboard per professionisti\" insieme a marker come \"Nuovi follower\", \"Contenuti che hai condiviso\", \"I tuoi strumenti\", \"Best practice\", \"Riepilogo mensile\". Questa è la Dashboard iniziale, NON gli Insight dettagliati.\n- \"uncertain\" solo se non ci sono marker sufficienti per decidere (es. schermata generica, ritaglio troppo piccolo).\n\nBasati esclusivamente sul testo che leggi, non sul colore di sfondo (l'app può essere in light o dark mode).\n\nPer i quattro valori numerici — Visualizzazioni, Follower netti, Interazioni, Account raggiunti — value = numero esatto come appare (con separatori e segno +/-), null se non visibile.\n\nIMPORTANTE — \"Account raggiunti\" e \"Account che hanno visualizzato\" sono la STESSA metrica in versioni diverse di Instagram: qualunque delle due etichette trovi, il valore va comunque messo nel campo accountsReached.\n\nIMPORTANTE — la visibility si valuta sul NUMERO, non sul contenitore grafico che lo racchiude: non serve che l'intero box/casella sia visibile, conta solo che il valore numerico sia leggibile per intero. Il fatto che il bordo colorato, lo sfondo o l'angolo arrotondato della card che contiene il numero escano dall'inquadratura NON è di per sé motivo di incertezza: se le cifre del numero sono tutte leggibili, il dato è comunque complete.\n\nCRITERIO DECISIVO, DA APPLICARE COME UN CALCOLO E NON A SENTIMENTO: l'etichetta sopra il numero (troncata, es. \"Interazi\" invece di \"Interazioni\", oppure assente) NON influenza MAI la lettura del numero. Per decidere, confronta due larghezze:\n(a) la larghezza di una singola cifra del numero;\n(b) la larghezza dello spazio vuoto tra l'ultima cifra e il punto di taglio (bordo del riquadro o bordo reale della foto).\nSe (b) è grande quanto o più di (a), allora un'altra cifra non sarebbe potuta stare lì senza lasciarsi vedere almeno in parte: il numero è finito, quindi \"complete\". Questo vale anche se il riquadro grigio prosegue fino al bordo della foto e l'etichetta sopra è tagliata.\nSe invece (b) è più piccolo di (a), oppure l'ultima cifra tocca direttamente il taglio senza spazio, allora \"partial\".\nAltri casi di \"partial\": una cifra visibilmente mozzata a metà (se ne vede solo una fetta verticale), una virgola delle migliaia seguita dal nulla, una cifra coperta da un altro elemento grafico.\nNon deliberare a lungo: fai il confronto tra (a) e (b) e rispondi.\n\nvisibility = \"not_visible\" se il dato non è presente, non viene letto, o l'area relativa alla metrica non è visibile, oppure se screen_type è dashboard_wrong." }
          ]
        }]
      })
    });
  }catch(e){ throw new Error("Connessione non riuscita"); }

  if(!res.ok){
    let msg="Servizio non disponibile";
    try{ const e=await res.json(); msg=(e.error&&e.error.message)||msg; }catch(e){}
    throw new Error(msg);
  }
  const data = await res.json();
  const raw = data.content[0].text.trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if(!match) throw new Error("Immagine non leggibile: controlla che i quattro dati siano visibili.");
  let parsed;
  try{ parsed = JSON.parse(match[0]); }
  catch(e){ throw new Error("Immagine non leggibile: controlla che i quattro dati siano visibili."); }
  const field = raw_val => {
    if(raw_val===null || raw_val===undefined) return { value:null, visibility:"not_visible" };
    // Il modello potrebbe restituire un oggetto {value, visibility} o un semplice numero/stringa.
    if(typeof raw_val === "object" && raw_val !== null){
      const s = String(raw_val.value===undefined?"":raw_val.value).trim().toLowerCase();
      const vis = String(raw_val.visibility||"complete").toLowerCase();
      if(!s || s==="null" || s==="n/a") return { value:null, visibility:"not_visible" };
      return { value:toNum(raw_val.value), visibility: vis==="partial"?"partial" : vis==="not_visible"?"not_visible":"complete" };
    }
    const s = String(raw_val).trim().toLowerCase();
    if(s==="" || s==="null" || s==="n/a" || s==="-") return { value:null, visibility:"not_visible" };
    return { value:toNum(raw_val), visibility:"complete" };
  };
  const st = String(parsed.screen_type||"").toLowerCase();
  const screenType = (st==="insights_ok" || st==="dashboard_wrong" || st==="uncertain") ? st : "uncertain";
  return {
    screenType:      screenType,
    views:           field(parsed.views),
    netFollowers:    field(parsed.netFollowers),
    interactions:    field(parsed.interactions),
    accountsReached: field(parsed.accountsReached)
  };
};

/* ============================================================================
   3bis. OCR — riconoscimento e lettura della schermata profilo Instagram.
   Usato nello step di precheck, prima del form. Stesso endpoint del Worker,
   stesso schema di richiesta di extractInsights: il Worker non va toccato.
   ========================================================================== */
const extractProfile = async (base64Image) => {
  const parts = base64Image.split(",");
  const base64Data = parts[1];
  const mediaType = parts[0].split(":")[1].split(";")[0];

  let res;
  try{
    res = await fetch(OCR_PROXY, {
      method:"POST",
      headers:{ "Content-Type":"application/json", "anthropic-version":"2023-06-01" },
      body: JSON.stringify({
        model: OCR_MODEL,
        max_tokens: 220,
        messages:[{
          role:"user",
          content:[
            { type:"image", source:{ type:"base64", media_type:mediaType, data:base64Data } },
            { type:"text", text:"Analizza questo screenshot e classificalo. Rispondi SOLO con questo JSON, senza altro testo:\n{\"screen_type\":\"profile_ok\",\"displayName\":{\"value\":null,\"visibility\":\"not_visible\",\"truncated\":false},\"username\":{\"value\":null,\"visibility\":\"not_visible\",\"truncated\":false},\"followers\":{\"value\":null,\"visibility\":\"not_visible\"}}\n\nscreen_type deve essere uno dei tre valori:\n- \"profile_ok\" se la schermata è la pagina principale di un profilo Instagram: mostra in alto lo username, e più sotto i conteggi di post/follower/seguiti, ed eventualmente nome, bio, pulsanti Modifica profilo/Segui.\n- \"wrong_screen\" se la schermata è chiaramente qualcos'altro (una chat, un feed, una pagina Insight, impostazioni, un altro social, una schermata di ricerca).\n- \"uncertain\" se non è possibile decidere con sufficiente sicurezza.\n\nATTENZIONE SULLO USERNAME: nella barra in alto, vicino ai conteggi, Instagram spesso mostra lo username TRONCATO con \'...\' quando è lungo (es. \'francesco___...\'). Non esiste sempre un\'altra posizione nello schermo dove leggerlo per intero: quel testo in alto è spesso l\'UNICA fonte disponibile. Leggilo comunque, riportando anche i puntini finali se presenti: non inventare né completare le lettere mancanti.\n\nusername (senza la @, in alto vicino ai conteggi): value = il testo esatto come appare, inclusi eventuali puntini di troncamento finali \'...\' se Instagram tronca lo username; null se non visibile. followers (il numero dei follower, NON i post né i seguiti): value = testo/numero esatto come appare, null se non visibile. Per entrambi, visibility = \"complete\" se il dato è interamente leggibile senza puntini di troncamento, \"partial\" se è tagliato, troncato con \'...\', o ambiguo, \"not_visible\" se non compare o se screen_type non è profile_ok. truncated (solo per username) = true SOLO se il testo mostrato termina con puntini di troncamento \'...\' aggiunti dall\'interfaccia, false altrimenti.\n\ndisplayName (il nome visualizzato sopra la bio, es. 'Mario Rossi'): value = il testo esatto come appare, incluso un eventuale '...' finale se il nome è troncato graficamente da Instagram; null se non presente o non leggibile. visibility = \"complete\" se il nome è leggibile per intero e non termina con puntini di troncamento, \"partial\" se termina con '...' o è chiaramente tagliato, \"not_visible\" se assente o illeggibile. truncated = true SOLO se il nome mostrato termina con puntini di troncamento ('...') aggiunti dall'interfaccia di Instagram, false altrimenti.\n\nBasati solo sul testo che leggi, non sui colori: l'app può essere in light o dark mode, su iPhone o Android.\n\nIMPORTANTE: la validità della schermata dipende SOLO da username e followers leggibili. Il nome visualizzato non è mai un requisito." }
          ]
        }]
      })
    });
  }catch(e){ throw new Error("Connessione non riuscita"); }

  if(!res.ok){
    let msg="Servizio non disponibile";
    try{ const e=await res.json(); msg=(e.error&&e.error.message)||msg; }catch(e){}
    throw new Error(msg);
  }
  const data = await res.json();
  const raw = data.content[0].text.trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if(!match) throw new Error("Immagine non leggibile.");
  let parsed;
  try{ parsed = JSON.parse(match[0]); }
  catch(e){ throw new Error("Immagine non leggibile."); }

  const field = (raw_val, isNumeric) => {
    if(raw_val===null || raw_val===undefined) return { value:null, visibility:"not_visible" };
    if(typeof raw_val === "object" && raw_val !== null){
      const s = String(raw_val.value===undefined?"":raw_val.value).trim();
      const vis = String(raw_val.visibility||"complete").toLowerCase();
      if(!s || s.toLowerCase()==="null" || s.toLowerCase()==="n/a") return { value:null, visibility:"not_visible" };
      return { value: isNumeric ? toNum(raw_val.value) : s, visibility: vis==="partial"?"partial" : vis==="not_visible"?"not_visible":"complete" };
    }
    const s = String(raw_val).trim();
    if(s==="" || s.toLowerCase()==="null" || s.toLowerCase()==="n/a" || s==="-") return { value:null, visibility:"not_visible" };
    return { value: isNumeric ? toNum(raw_val) : s, visibility:"complete" };
  };

  // Nome visualizzato: gestione dedicata per il troncamento con "...".
  // Il nome non deve MAI condizionare la validità dello screenshot: al massimo
  // risulta "truncated" o "not_visible", ma non fa fallire lo screen_type.
  // Usata sia per il nome visualizzato sia per lo username: in entrambi i casi Instagram può
  // troncare il testo con "..." quando è lungo, e in entrambi i casi vogliamo comunque prendere
  // la parte letta invece di scartarla, segnalando solo che va completata a mano più avanti.
  const truncatableTextField = (raw_val) => {
    const f = field(raw_val, false);
    if(!f.value) return { value:null, visibility:"not_visible", truncated:false };
    let truncated = false;
    if(typeof raw_val === "object" && raw_val !== null && raw_val.truncated === true) truncated = true;
    if(/\.\.\.\s*$/.test(String(f.value))) truncated = true;
    if(truncated){
      // Con i puntini: si prende comunque la parte letta (senza puntini), ma il dato
      // resta "partial" — verrà precompilato e segnalato da completare più avanti nel form.
      return { value: String(f.value).replace(/\.\.\.\s*$/,"").trim(), visibility:"partial", truncated:true };
    }
    // Senza puntini: il testo letto si considera valido e si inserisce così com'è.
    return { value:f.value, visibility:"complete", truncated:false };
  };

  const st = String(parsed.screen_type||"").toLowerCase();
  const screenType = (st==="profile_ok" || st==="wrong_screen" || st==="uncertain") ? st : "uncertain";
  return {
    screenType:  screenType,
    displayName: truncatableTextField(parsed.displayName),
    username:    truncatableTextField(parsed.username),
    followers:   field(parsed.followers, true)
  };
};

/**
 * Verifica un singolo valore numerico contro una foto di conferma caricata
 * dal candidato quando modifica un dato già letto dall'OCR principale.
 * Ritorna { outcome: "match" | "mismatch" | "unreadable", foundValue }.
 * Non va mai usata per il nome visualizzato: solo per dati numerici.
 */
const verifyFieldValue = async (base64Image, fieldLabel, expectedValue) => {
  const parts = base64Image.split(",");
  const base64Data = parts[1];
  const mediaType = parts[0].split(":")[1].split(";")[0];

  let res;
  try{
    res = await fetch(OCR_PROXY, {
      method:"POST",
      headers:{ "Content-Type":"application/json", "anthropic-version":"2023-06-01" },
      body: JSON.stringify({
        model: OCR_MODEL,
        max_tokens: 100,
        messages:[{
          role:"user",
          content:[
            { type:"image", source:{ type:"base64", media_type:mediaType, data:base64Data } },
            { type:"text", text:"In questo screenshot cerca il dato \""+fieldLabel+"\". Rispondi SOLO con questo JSON, senza altro testo:\n{\"readable\":true,\"value\":null}\nreadable = false se il dato non è leggibile, il box è tagliato o non è presente nell'immagine. Altrimenti true, e value = il numero esatto come appare (con eventuale separatore delle migliaia e segno +/-)." }
          ]
        }]
      })
    });
  }catch(e){ throw new Error("Connessione non riuscita"); }

  if(!res.ok) throw new Error("Servizio non disponibile");
  const data = await res.json();
  const raw = data.content[0].text.trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if(!match) return { outcome:"unreadable", foundValue:null };
  let parsed;
  try{ parsed = JSON.parse(match[0]); } catch(e){ return { outcome:"unreadable", foundValue:null }; }

  if(!parsed.readable || parsed.value===null || parsed.value===undefined || String(parsed.value).trim()===""){
    return { outcome:"unreadable", foundValue:null };
  }
  const found = toNum(parsed.value);
  if(found === null) return { outcome:"unreadable", foundValue:null };
  if(Number(found) === Number(expectedValue)) return { outcome:"match", foundValue:found };
  return { outcome:"mismatch", foundValue:found };
};

/* ============================================================================
   8. LANDING PUBBLICA
   ========================================================================== */
const SEEKING = [
  "Creator fitness",
  "Influencer del settore",
  "Coach e personal trainer",
  "Bodybuilder e atleti natural",
  "Professionisti di palestra",
  "Profili emergenti con forte potenziale"
];

const EVALUATING = [
  ["Qualità e costanza dei contenuti","Non conta il singolo post virale, conta lo standard mantenuto nel tempo."],
  ["Credibilità","Quanto il tuo pubblico si fida di ciò che racconti."],
  ["Rapporto con la community","Interazione reale, non solo numeri di superficie."],
  ["Dati del profilo","Copertura, interazioni e crescita rapportate alla tua dimensione."],
  ["Affinità con EVORΛ","Coerenza tra il tuo percorso e l'identità del brand."],
  ["Integrazione naturale","Capacità di raccontare un prodotto senza forzature."],
  ["Affidabilità","Rispetto di tempi, accordi e standard concordati."],
  ["Potenziale di crescita","Dove può arrivare il tuo progetto nei prossimi mesi."]
];

const OPPORTUNITIES = [
  "Condizioni dedicate","Commissioni sulle vendite","Prodotti selezionati","Accesso anticipato ai lanci",
  "Partecipazione a shooting","Presenza agli eventi","Creazione di contenuti","Collaborazioni speciali",
  "Crescita progressiva nel programma"
];

const PROCESS = [
  ["01","Invio della candidatura","Compili il form e alleghi i dati reali del tuo profilo."],
  ["02","Analisi del profilo","Verifichiamo dati, contenuti e coerenza con il brand."],
  ["03","Valutazione del team","Ogni candidatura viene letta e valutata manualmente."],
  ["04","Eventuale contatto","Se ci sono le condizioni, ti scriviamo via email."],
  ["05","Proposta di collaborazione","Definiamo insieme forma, obiettivi e durata."]
];

const NAV_SECTIONS = [
  {id:"progetto", l:"Il progetto"},
  {id:"profili",  l:"Chi cerchiamo"},
  {id:"criteri",  l:"Criteri"},
  {id:"processo", l:"Processo"}
];

function PublicNav(){
  const [open,setOpen] = useState(false);

  const goTo = (id) => {
    setOpen(false);
    const el = document.getElementById(id);
    if(el) el.scrollIntoView({behavior:"smooth", block:"start"});
  };

  return (
    <nav className="nav">
      {/* Desktop: logo centrato in alto, sezioni sotto */}
      <div className="hd">
        <div className="wrap">
          <div className="hd-logo"><Logo height={30}/></div>
          <div className="hd-nav">
            {NAV_SECTIONS.map(s=>(
              <button key={s.id} className="nav-link" onClick={()=>goTo(s.id)}>{s.l}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile: logo centrato + hamburger */}
      <div className="wrap">
        <div className="hm">
          <Logo height={24}/>
          <button className="hm-burger" aria-expanded={open} aria-controls="menu-mobile"
            aria-label={open?"Chiudi il menu":"Apri il menu"} onClick={()=>setOpen(o=>!o)}>
            <span/><span/><span/>
          </button>
        </div>
      </div>
      <div id="menu-mobile" className={"hm-panel"+(open?" open":"")}>
        {NAV_SECTIONS.map(s=>(
          <button key={s.id} className="hm-item" onClick={()=>goTo(s.id)}>{s.l}</button>
        ))}
      </div>
    </nav>
  );
}

function Landing({onApply}){
  return (
    <div>
      <PublicNav/>

      {/* ---------- HERO ---------- */}
      <header style={{borderBottom:"1px solid var(--brd)",background:"radial-gradient(ellipse at 50% -10%, rgba(178,34,34,.16) 0%, transparent 62%)"}}>
        <div className="wrap" style={{padding:"72px 20px 76px",textAlign:"center",animation:"fadeUp .7s ease both"}}>
          <div className="eyebrow" style={{marginBottom:18}}>{BRAND.program}</div>
          <h1 className="h-xl" style={{maxWidth:820,margin:"0 auto 22px"}}>
            Non cerchiamo semplicemente ambassadors.<br/>
            <span style={{color:"var(--red)"}}>Cerchiamo persone capaci di rappresentare EVORΛ.</span>
          </h1>
          <p className="body" style={{maxWidth:620,margin:"0 auto 34px"}}>
            EVORΛ Collective è il programma dedicato a creator, coach e personalità del mondo fitness
            che condividono la nostra visione e vogliono costruire una collaborazione credibile e continuativa con il brand.
          </p>
          <p className="body-sm" style={{marginBottom:18}}>Candidature riservate a persone maggiorenni (18+).</p>
          <button className="btn btn-primary" onClick={onApply} style={{padding:"18px 38px"}}>
            Presenta la tua candidatura
          </button>
        </div>
      </header>

      {/* ---------- IL PROGETTO ---------- */}
      <section className="section" id="progetto">
        <div className="wrap">
          <div style={{maxWidth:820,margin:"0 auto"}}>
            <div className="eyebrow">Il progetto</div>
            <h2 className="h-lg" style={{margin:"14px 0 16px"}}>Una collaborazione, non uno scambio di prodotti.</h2>
            <div className="rule" style={{marginBottom:20}}/>
            <p className="body" style={{marginBottom:14}}>
              EVORΛ Collective non nasce per distribuire codici sconto o campioni gratuiti.
              Nasce per costruire rapporti continuativi con persone che hanno qualcosa da portare
              al brand e che vogliono crescere insieme a esso.
            </p>
            <p className="body">
              Chi entra nel programma contribuisce con contenuti, credibilità e presenza reale nel settore.
              In cambio riceve un'opportunità costruita su misura, non una collaborazione usa e getta.
            </p>
          </div>
        </div>
      </section>

      <div className="divider"/>

      {/* ---------- CHI CERCHIAMO ---------- */}
      <section className="section" id="profili" style={{background:"var(--bg-2)"}}>
        <div className="wrap" style={{maxWidth:900}}>
          <div className="eyebrow">Chi stiamo cercando</div>
          <h2 className="h-lg" style={{margin:"14px 0 16px"}}>Profili diversi, stesso standard.</h2>
          <div className="rule" style={{marginBottom:24}}/>
          <div className="g3-gap" style={{marginBottom:22}}>
            {SEEKING.map(s=>(
              <div key={s} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",background:"var(--surf)",border:"1px solid var(--brd)"}}>
                <div style={{width:4,height:22,background:"var(--red)",flexShrink:0}}/>
                <span style={{fontFamily:"var(--fh)",fontWeight:600,fontSize:14,color:"var(--t1)"}}>{s}</span>
              </div>
            ))}
          </div>
          <p className="body-sm" style={{borderLeft:"2px solid var(--red)",paddingLeft:16}}>
            Il numero di follower è un dato che consideriamo, ma non è l'unico criterio.
            Valutiamo profili molto diversi tra loro, purché ci sia sostanza dietro i numeri.
          </p>
        </div>
      </section>

      <div className="divider"/>

      {/* ---------- COSA VALUTIAMO ---------- */}
      <section className="section" id="criteri">
        <div className="wrap" style={{maxWidth:900}}>
          <div className="eyebrow">Cosa valutiamo</div>
          <h2 className="h-lg" style={{margin:"14px 0 16px"}}>Otto elementi, analizzati manualmente.</h2>
          <div className="rule" style={{marginBottom:24}}/>
          <div style={{display:"flex",flexDirection:"column",gap:2}}>
            {EVALUATING.map(([t,d],i)=>(
              <div key={t} style={{display:"flex",gap:16,padding:"16px 18px",border:"1px solid var(--brd)",background:"var(--surf)"}}>
                <span style={{fontFamily:"var(--fh)",fontWeight:800,fontSize:13,color:"var(--red)",minWidth:24,paddingTop:1}}>
                  {String(i+1).padStart(2,"0")}
                </span>
                <div style={{minWidth:0}}>
                  <div className="h-sm" style={{marginBottom:4}}>{t}</div>
                  <div className="body-sm">{d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="divider"/>

      {/* ---------- OPPORTUNITÀ ---------- */}
      <section className="section" style={{background:"var(--bg-2)"}}>
        <div className="wrap" style={{maxWidth:900}}>
          <div className="eyebrow">Cosa può offrire EVORΛ</div>
          <h2 className="h-lg" style={{margin:"14px 0 16px"}}>Opportunità costruite sul profilo.</h2>
          <div className="rule" style={{marginBottom:24}}/>
          <div className="chips" style={{marginBottom:24}}>
            {OPPORTUNITIES.map(o=>(
              <span key={o} style={{fontFamily:"var(--fh)",fontWeight:600,fontSize:12,letterSpacing:".06em",padding:"11px 15px",background:"var(--surf)",border:"1px solid var(--brd)",color:"var(--t2)"}}>{o}</span>
            ))}
          </div>
          <div style={{padding:"18px 20px",border:"1px solid var(--brd-hi)",background:"var(--surf)"}}>
            <div className="label-xs" style={{marginBottom:8}}>Nota importante</div>
            <p className="body-sm" style={{color:"var(--t2)"}}>
              Le opportunità vengono definite in base al profilo, al progetto e al percorso costruito con EVORΛ.
              L'invio della candidatura non garantisce l'accesso al programma, prodotti gratuiti o compensi.
            </p>
          </div>
        </div>
      </section>

      <div className="divider"/>

      {/* ---------- PROCESSO ---------- */}
      <section className="section" id="processo">
        <div className="wrap" style={{maxWidth:900}}>
          <div className="eyebrow">Processo di selezione</div>
          <h2 className="h-lg" style={{margin:"14px 0 24px"}}>Cinque passaggi.</h2>
          <div style={{display:"flex",flexDirection:"column",gap:2}}>
            {PROCESS.map(([n,t,d])=>(
              <div key={n} style={{display:"flex",gap:18,padding:"18px",border:"1px solid var(--brd)",background:"var(--surf)"}}>
                <span style={{fontFamily:"var(--fh)",fontWeight:800,fontSize:22,color:"var(--brd-hi)",lineHeight:1,minWidth:34}}>{n}</span>
                <div style={{minWidth:0}}>
                  <div className="h-sm" style={{marginBottom:4}}>{t}</div>
                  <div className="body-sm">{d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- CTA FINALE ---------- */}
      <section className="section" style={{textAlign:"center",borderTop:"1px solid var(--brd)",background:"radial-gradient(ellipse at 50% 120%, rgba(178,34,34,.18) 0%, transparent 60%)"}}>
        <div className="wrap">
          <h2 className="h-lg" style={{maxWidth:640,margin:"0 auto 16px"}}>
            Se pensi di avere le caratteristiche giuste, raccontacele.
          </h2>
          <p className="body" style={{maxWidth:520,margin:"0 auto 30px"}}>
            La candidatura richiede circa dieci minuti. Prenditi il tempo necessario:
            ogni risposta viene letta da una persona reale.
          </p>
          <button className="btn btn-primary" onClick={onApply} style={{padding:"18px 40px"}}>
            Presenta la tua candidatura
          </button>
        </div>
      </section>

      {/* ---------- FOOTER ---------- */}
      <footer style={{borderTop:"1px solid var(--brd)",padding:"34px 0"}}>
        <div className="wrap" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:14,textAlign:"center"}}>
          <Logo height={22}/>
          <div className="label-xs" style={{color:"var(--t4)"}}>{BRAND.program} · Partner Program</div>
          <a href={BRAND.siteUrl} target="_blank" rel="noopener noreferrer" className="nav-link">evorafitness.it</a>
        </div>
      </footer>
    </div>
  );
}

/* ============================================================================
   9. FORM DI CANDIDATURA
   ========================================================================== */
const STEPS = [
  "Profilo",
  "Social e Insights",
  "Posizionamento",
  "Compatibilità",
  "Mentalità",
  "Disponibilità",
  "Riepilogo"
];

const FORM_STEP_FIELDS=[
          ["fullName","age","email","city","country","isAdult","profileCategories","otherProfileCategory"],
          ["instagram","followers","tiktok","tiktokFollowers","screenshotData","screenshotData2","profileScreenshotData","views","netFollowers","interactions","accountsReached","ocrInsights","ocrProfile","contentUrl1","contentUrl2","contentUrl3"],
          ["threeWords","contentType","whatToTransmit","whyFollow","hasBrandCollabs","brandCollabDetails"],
          ["motivation","brandLike","contentIntegration","athleteImage","valueBeyondContent","howWouldTell"],
          ["scenarioBrandContent","buildWithoutEarnings","badContentReaction","analysisElements","brandMeaning"],
          ["contentPerMonth","hasRoutine","followsGuidelines","availEvents","availShooting","availUgc","availRawFiles","boughtProducts","improvements","extra"],
          ["privacyConsent"]
 ];

const LIMITS = { short:120, medium:600, long:900 };

const MANAGEMENT_LIMITS = Object.freeze({notes:10000, insightsNote:2000, creatorCode:120});

const EMPTY_FORM = {
  // Step 1 — profilo
  fullName:"", age:"", email:"", city:"", country:"Italia", isAdult:false, profileCategories:[], otherProfileCategory:"",
  // Step 2 — social
  instagram:"", followers:"", tiktok:"", tiktokFollowers:"",
  screenshotData:null, screenshotName:"",
  screenshotData2:null, screenshotName2:"",
  views:"", netFollowers:"", interactions:"", accountsReached:"",
  ocrInsights:null,
  contentUrl1:"", contentUrl2:"", contentUrl3:"",
  // Step 3 — posizionamento
  threeWords:"", contentType:"", whatToTransmit:"", whyFollow:"",
  hasBrandCollabs:"", brandCollabDetails:"",
  // Step 4 — compatibilità
  motivation:"", brandLike:"", contentIntegration:"", athleteImage:"",
  valueBeyondContent:"", howWouldTell:"",
  // Step 5 — mentalità
  scenarioBrandContent:"", buildWithoutEarnings:"", badContentReaction:"", analysisElements:"", brandMeaning:"",
  // Step 6 — disponibilità
  contentPerMonth:"", hasRoutine:"", followsGuidelines:"",
  availEvents:"", availShooting:"", availUgc:"", availRawFiles:"",
  boughtProducts:"", improvements:"", extra:"",
  // Step 7 — consensi
  privacyConsent:false
};

const YESNO = [{v:"yes",l:"Sì"},{v:"no",l:"No"},{v:"maybe",l:"Da valutare"}];

function CharField({id, value, onChange, max, rows=4, placeholder, error, invalid}){
  return (
    <div>
      <textarea id={id} rows={rows} value={value} maxLength={max} placeholder={placeholder}
        aria-invalid={invalid?"true":"false"}
        onChange={e=>onChange(e.target.value)}/>
      <div className="counter">{value.length} / {max}</div>
    </div>
  );
}

/** Notifica al team. Volutamente separata dall'invio: non deve mai bloccarlo. */
/* ============================================================================
   STEP INIZIALE — VERIFICA SCREENSHOT INSTAGRAM (prima del form vero e proprio)
   ========================================================================== */

/** Converte lo stato di visibilità OCR in un giudizio di completezza booleano. */
const fieldIsComplete = f => !!(f && f.value !== null && f.value !== undefined && f.visibility === "complete");

function InstagramPreCheck({ onComplete, onBack }){
  const [profile,setProfile] = useState({ data:null, name:"", state:"idle", result:null });
  const [ins1,setIns1]       = useState({ data:null, name:"", state:"idle", result:null });
  const [ins2,setIns2]       = useState({ data:null, name:"", state:"idle", result:null });
  const [wrongScreen,setWrongScreen] = useState(null); // "profile" | "ins1" | "ins2" | null
  const [showInfoModal,setShowInfoModal] = useState(false);
  const [lightbox,setLightbox] = useState(null); // src stringa | null

  // ESC globale + scroll bloccato quando un overlay è aperto (popup o lightbox)
  useEffect(()=>{
    const anyOpen = wrongScreen || showInfoModal || lightbox;
    if(!anyOpen) return;
    const onKey = e => { if(e.key==="Escape"){ setWrongScreen(null); setShowInfoModal(false); setLightbox(null); } };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [wrongScreen, showInfoModal, lightbox]);

  /* ---------- PROFILO ---------- */
  const processProfile = async (file) => {
    if(!file) return;
    if(!ALLOWED_IMAGE.includes(file.type)){ setProfile(p=>({...p,state:"failed",result:null})); return; }
    if(file.size > MAX_UPLOAD_BYTES){ setProfile(p=>({...p,state:"failed",result:null})); return; }
    setProfile(p=>({...p,state:"reading"}));
    let img;
    try{
      const raw = await readFileAsDataURL(file);
      img = await compressImage(raw);
      setProfile(p=>({...p,data:img,name:file.name}));
    }catch(err){
      console.error("Preparazione immagine profilo non riuscita:", err);
      setProfile(p=>({...p,state:"failed",result:null})); return;
    }
    setProfile(p=>({...p,state:"analyzing"}));
    try{
      const r = await extractProfile(img);
      if(r.screenType === "wrong_screen"){
        setProfile(p=>({...p,state:"failed",result:r}));
        setWrongScreen("profile");
        return;
      }
      setProfile(p=>({...p,state:"done",result:r}));
    }catch(err){
      console.warn("Lettura profilo non riuscita:", err);
      setProfile(p=>({...p,state:"failed",result:null}));
    }
  };
  const removeProfile = () => setProfile({ data:null, name:"", state:"idle", result:null });

  /* ---------- INSIGHT (uno o due screenshot) ---------- */
  const processInsight = async (file, slot) => {
    if(!file) return;
    const setSlot = slot===1 ? setIns1 : setIns2;
    if(!ALLOWED_IMAGE.includes(file.type)){ setSlot(s=>({...s,state:"failed",result:null})); return; }
    if(file.size > MAX_UPLOAD_BYTES){ setSlot(s=>({...s,state:"failed",result:null})); return; }
    setSlot(s=>({...s,state:"reading"}));
    let img;
    try{
      const raw = await readFileAsDataURL(file);
      img = await compressImage(raw);
      setSlot(s=>({...s,data:img,name:file.name}));
    }catch(err){
      console.error("Preparazione immagine Insight non riuscita:", err);
      setSlot(s=>({...s,state:"failed",result:null})); return;
    }
    setSlot(s=>({...s,state:"analyzing"}));
    try{
      const r = await extractInsights(img);
      if(r.screenType === "dashboard_wrong"){
        setSlot(s=>({...s,state:"failed",result:r}));
        setWrongScreen(slot===1?"ins1":"ins2");
        return;
      }
      setSlot(s=>({...s,state:"done",result:r}));
    }catch(err){
      console.warn("Lettura Insight non riuscita:", err);
      setSlot(s=>({...s,state:"failed",result:null}));
    }
  };
  const removeInsight = (slot) => {
    if(slot===1) setIns1({ data:null, name:"", state:"idle", result:null });
    else         setIns2({ data:null, name:"", state:"idle", result:null });
  };

  /* ---------- STATO DERIVATO ---------- */
  const { merged: insightsMerged, conflicts: insightsConflicts } = mergeInsights(ins1.result, ins2.result);
  const insightsAttempted = !!(ins1.result && ins1.result.screenType !== "dashboard_wrong");
  // Un dato serve davvero solo se NON è stato letto affatto. Se un valore è stato letto ma
  // l'OCR lo ha marcato "partial" (dubbio sul possibile troncamento), non blocchiamo il
  // candidato: lo lasciamo proseguire e glielo facciamo confermare esplicitamente più avanti,
  // nella sezione "Controlla i dati rilevati", dove può correggerlo e allegare una foto di verifica.
  // Chiedere un secondo screenshot per un dato che si legge benissimo era la causa dei blocchi.
  const hasValue = f => !!(f && f.value !== null && f.value !== undefined);
  const insightsReadable = insightsAttempted
    && hasValue(insightsMerged.views) && hasValue(insightsMerged.netFollowers)
    && hasValue(insightsMerged.interactions) && hasValue(insightsMerged.accountsReached);
  const insightsComplete = insightsAttempted
    && fieldIsComplete(insightsMerged.views) && fieldIsComplete(insightsMerged.netFollowers)
    && fieldIsComplete(insightsMerged.interactions) && fieldIsComplete(insightsMerged.accountsReached);
  // Il secondo screenshot si chiede SOLO se manca davvero un valore, non per un semplice dubbio.
  const insightsNeedSecond = insightsAttempted && !insightsReadable;
  // Dati letti ma con qualche riserva: si prosegue, segnalando di ricontrollarli dopo.
  const insightsToDoubleCheck = insightsReadable && !insightsComplete;
  // Elenco leggibile dei soli dati non ancora completi, per dire con precisione cosa manca
  // invece di un generico "alcuni dati" — utile sia al candidato sia per capire dove interviene l'OCR.
  const insightFieldLabels = { views:"Visualizzazioni", netFollowers:"Follower netti", interactions:"Interazioni", accountsReached:"Account raggiunti" };
  const missingInsightFields = insightsAttempted
    ? Object.keys(insightFieldLabels).filter(k => !hasValue(insightsMerged[k])).map(k => insightFieldLabels[k])
    : [];
  const doubtfulInsightFields = insightsAttempted
    ? Object.keys(insightFieldLabels).filter(k => hasValue(insightsMerged[k]) && !fieldIsComplete(insightsMerged[k])).map(k => insightFieldLabels[k])
    : [];

  // Il nome visualizzato non è mai un requisito. Lo username può risultare troncato da
  // Instagram stesso ("francesco___...") senza che esista un'altra fonte nello schermo per
  // completarlo: in questo caso lo prendiamo comunque (senza i puntini) e lo segnaliamo da
  // completare più avanti nel form, invece di bloccare la verifica del profilo.
  const usernameField = (profile.result && profile.result.username) || { value:null, visibility:"not_visible", truncated:false };
  const usernameReadable = !!usernameField.value;
  const usernameNeedsCompletion = !!(usernameField.truncated && usernameField.value);
  const profileComplete = !!(profile.result && profile.result.screenType === "profile_ok"
    && usernameReadable && fieldIsComplete(profile.result.followers));
  const profileDataIncomplete = !!(profile.result && profile.result.screenType === "profile_ok" && !profileComplete);
  const profileUncertain = !!(profile.result && profile.result.screenType === "uncertain");

  const canContinue = profileComplete && insightsReadable;

  const handleContinue = () => {
    if(!canContinue) return;
    const ig = parseSocial(usernameField.value, "instagram");
    const name = profile.result.displayName || { value:null, visibility:"not_visible", truncated:false };
    // Nome completo e leggibile → precompilato normalmente.
    // Nome troncato con "..." → precompilato comunque con la sola parte letta (senza i puntini),
    // ma segnalato come incompleto: nello step successivo il campo va evidenziato ed è il
    // candidato a doverlo completare per intero.
    // Nome ambiguo/illeggibile → campo vuoto, nessun precompilamento.
    const fullNameGuess = name.value ? name.value : "";
    const fullNameNeedsCompletion = !!(name.truncated && name.value);
    onComplete({
      instagram: ig.handle ? "@"+ig.handle : "",
      instagramHandle: ig.handle,
      instagramUrl: ig.url,
      usernameNeedsCompletion,
      followers: String(profile.result.followers.value),
      fullNameGuess,
      fullNameNeedsCompletion,
      views:           String(insightsMerged.views.value),
      netFollowers:    String(insightsMerged.netFollowers.value),
      interactions:    String(insightsMerged.interactions.value),
      accountsReached: String(insightsMerged.accountsReached.value),
      screenshotData:  ins1.data,
      screenshotName:  ins1.name,
      screenshotData2: ins2.data || null,
      screenshotName2: ins2.name || "",
      profileScreenshotData: profile.data,
      ocrInsights: {
        screenshot1: ins1.result, screenshot2: ins2.result,
        merged: {
          views: insightsMerged.views.value, netFollowers: insightsMerged.netFollowers.value,
          interactions: insightsMerged.interactions.value, accountsReached: insightsMerged.accountsReached.value
        },
        conflicts: insightsConflicts, readAt: new Date().toISOString()
      },
      ocrProfile: { result: profile.result, readAt: new Date().toISOString() }
    });
  };

  const wrongExampleSrc = wrongScreen === "profile" ? BRAND.profileExampleSrc : BRAND.insightsExampleSrc;
  const wrongCopy = wrongScreen === "profile"
    ? { title:"Schermata non corretta", text:"Carica la schermata principale del tuo profilo Instagram, quella in cui sono visibili username e numero di follower." }
    : { title:"Schermata non corretta", text:"Hai caricato una schermata diversa da quella richiesta." };

  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column"}}>
      <nav className="nav">
        <div className="wrap nav-in">
          <Logo height={24}/>
          <button className="btn btn-ghost btn-sm" onClick={onBack}>Esci</button>
        </div>
      </nav>

      <div className="precheck-wrap" style={{flex:1}}>
        <div className="eyebrow" style={{marginBottom:10}}>{BRAND.program}</div>
        <h1 className="h-md" style={{marginBottom:12}}>Prepara i tuoi dati Instagram</h1>
        <p className="body-sm" style={{marginBottom:12}}>La candidatura è riservata a chi ha compiuto 18 anni.</p>
        <p className="body-sm" style={{marginBottom:26,color:"var(--t3)"}}>
          Prima di iniziare, carica gli screenshot richiesti. Useremo questi dati per compilare
          automaticamente la sezione Instagram della candidatura.
        </p>

        {/* ── BLOCCO 1 · PROFILO ── */}
        <div className={"precheck-block"+(profileComplete?" verified":"")}>
          <div className="field-label" style={{marginBottom:6}}>Profilo Instagram</div>
          <p className="body-sm" style={{marginBottom:12}}>Carica uno screenshot della pagina principale del tuo profilo.</p>

          <div style={{display:"flex",gap:12,alignItems:"flex-start",marginBottom:14}}>
            <button type="button" className="thumb-btn example"
              onClick={()=>setLightbox(BRAND.profileExampleSrc)} aria-label="Ingrandisci esempio profilo">
              <img src={BRAND.profileExampleSrc} alt="Esempio schermata profilo Instagram"/>
            </button>
            <div className="body-sm" style={{fontSize:12,color:"var(--t3)",paddingTop:4}}>
              Devono essere visibili username e follower.
            </div>
          </div>

          <label className={"upload-compact"+(profile.data?" done":"")}>
            {profile.data
              ? <div className="u-thumb"><img src={profile.data} alt="Screenshot profilo caricato"/></div>
              : <div className="u-plus" aria-hidden="true">+</div>}
            <div className="u-info">
              <div className="u-title">Screenshot profilo</div>
              <div className="u-sub">
                {profile.state==="reading" ? "Preparazione in corso…"
                  : profile.state==="analyzing" ? "Lettura automatica in corso…"
                  : profile.data ? "Caricato · tocca per sostituire"
                  : "+ Carica screenshot"}
              </div>
            </div>
            {profileComplete && <span className="u-check" aria-hidden="true">✓</span>}
            <input type="file" accept="image/*" className="sr-only" aria-label="Carica screenshot profilo"
              onChange={e=>{ processProfile(e.target.files[0]); e.target.value=""; }}/>
          </label>
          {profile.data && (
            <div className="upload-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={removeProfile}>Rimuovi</button></div>
          )}

          {profileComplete && <div className="verify-pill ok">✓ Screenshot verificato</div>}
          {(profileDataIncomplete || profileUncertain) && (
            <div className="status-box" style={{borderColor:"rgba(230,126,34,.45)",marginTop:10}}>
              <div className="dot" style={{background:"var(--warn)",marginTop:6}}/>
              <div className="body-sm">
                Non riusciamo a leggere correttamente tutti i dati del profilo. Assicurati che username
                e follower siano completamente visibili.
              </div>
            </div>
          )}
        </div>

        {/* ── BLOCCO 2 · INSIGHT ── */}
        <div className={"precheck-block"+(insightsComplete?" verified":"")}>
          <div className="field-label" style={{marginBottom:6}}>Insight degli ultimi 30 giorni</div>
          <p className="body-sm" style={{marginBottom:12}}>
            Carica la schermata degli Insight e assicurati che siano completamente visibili tutti i dati
            evidenziati in rosso nell'immagine di esempio.
          </p>

          <button type="button" className="thumb-btn example" style={{marginBottom:12}}
            onClick={()=>setLightbox(BRAND.insightsExampleSrc)} aria-label="Ingrandisci esempio Insight">
            <img src={BRAND.insightsExampleSrc} alt="Esempio schermata Insight con dati evidenziati in rosso"/>
          </button>

          <div className="body-sm" style={{fontSize:12,color:"var(--t3)",marginBottom:6}}>Devono essere visibili:</div>
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
            {["Visualizzazioni","Follower netti","Interazioni","Account raggiunti"].map(x=>(
              <div key={x} style={{display:"flex",alignItems:"center",gap:9}}>
                <span className="dot" style={{background:"var(--red)"}}/>
                <span className="body-sm" style={{fontSize:13,color:"var(--t2)"}}>{x}</span>
              </div>
            ))}
          </div>
          <p className="body-sm" style={{fontSize:12,color:"var(--t4)",marginBottom:12}}>
            Se alcuni dati non entrano nella stessa schermata, te lo segnaleremo e potrai aggiungere un secondo screenshot.
          </p>

          <button type="button" className="info-trigger" onClick={()=>setShowInfoModal(true)}
            aria-label="Come trovare questa schermata" style={{marginBottom:14}}>
            <span className="info-btn" aria-hidden="true">i</span>
            <span className="info-trigger-label">Come trovare questa schermata</span>
          </button>

          {/* Slot 1 — obbligatorio */}
          <label className={"upload-compact"+(ins1.data?" done":"")}>
            {ins1.data
              ? <div className="u-thumb"><img src={ins1.data} alt="Anteprima primo screenshot Insight"/></div>
              : <div className="u-plus" aria-hidden="true">+</div>}
            <div className="u-info">
              <div className="u-title">Screenshot Insight</div>
              <div className="u-sub">
                {ins1.state==="reading" ? "Preparazione in corso…"
                  : ins1.state==="analyzing" ? "Lettura automatica in corso…"
                  : ins1.data ? "Caricato · tocca per sostituire"
                  : "+ Carica screenshot"}
              </div>
            </div>
            {insightsReadable && <span className="u-check" aria-hidden="true">✓</span>}
            <input type="file" accept="image/*" className="sr-only" aria-label="Carica primo screenshot Insight"
              onChange={e=>{ processInsight(e.target.files[0],1); e.target.value=""; }}/>
          </label>
          {ins1.data && (
            <div className="upload-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={()=>removeInsight(1)}>Rimuovi</button></div>
          )}

          {insightsNeedSecond && (
            <div className="status-box" style={{borderColor:"rgba(230,126,34,.45)",marginTop:12}}>
              <div className="dot" style={{background:"var(--warn)",marginTop:6}}/>
              <div className="body-sm">
                Lo screenshot è corretto, ma alcuni dati non sono completamente visibili
                {missingInsightFields.length>0 && (
                  <> — <strong style={{color:"var(--t1)"}}>{missingInsightFields.join(", ")}</strong></>
                )}
                . Scorri leggermente la schermata degli Insight e carica un secondo screenshot in cui
                {missingInsightFields.length>0 ? " sia visibile per intero" : " siano visibili"}
                {missingInsightFields.length===1 ? " questo dato." : " questi dati."}
              </div>
            </div>
          )}

          {/* Slot 2 — obbligatorio se manca un dato, facoltativo se un dato è solo dubbio */}
          {(insightsNeedSecond || insightsToDoubleCheck) && (
            <div style={{marginTop:12}}>
              <label className={"upload-compact"+(ins2.data?" done":"")}>
                {ins2.data
                  ? <div className="u-thumb"><img src={ins2.data} alt="Anteprima secondo screenshot Insight"/></div>
                  : <div className="u-plus" aria-hidden="true">+</div>}
                <div className="u-info">
                  <div className="u-title">Secondo screenshot Insight</div>
                  <div className="u-sub">
                    {ins2.state==="reading" ? "Preparazione in corso…"
                      : ins2.state==="analyzing" ? "Lettura automatica in corso…"
                      : ins2.data ? "Caricato · tocca per sostituire"
                      : "+ Carica secondo screenshot"}
                  </div>
                </div>
                <input type="file" accept="image/*" className="sr-only" aria-label="Carica secondo screenshot Insight"
                  onChange={e=>{ processInsight(e.target.files[0],2); e.target.value=""; }}/>
              </label>
              {ins2.data && (
                <div className="upload-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={()=>removeInsight(2)}>Rimuovi</button></div>
              )}
              {ins2.data && ins2.state==="done" && !insightsComplete && (
                <div className="status-box" style={{borderColor:"rgba(230,126,34,.45)",marginTop:10}}>
                  <div className="dot" style={{background:"var(--warn)",marginTop:6}}/>
                  <div className="body-sm">
                    Non riusciamo ancora a verificare
                    {missingInsightFields.length>0
                      ? <> <strong style={{color:"var(--t1)"}}>{missingInsightFields.join(", ")}</strong></>
                      : " tutti i dati richiesti"}
                    . Assicurati che {missingInsightFields.length===1 ? "sia" : "siano"} completamente visibili.
                  </div>
                </div>
              )}
            </div>
          )}

          {insightsComplete && <div className="verify-pill ok">✓ Insight verificati</div>}
          {insightsToDoubleCheck && (
            <>
              <div className="verify-pill warn">✓ Dati letti · da ricontrollare</div>
              <div className="status-box" style={{borderColor:"rgba(230,126,34,.45)",marginTop:10}}>
                <div className="dot" style={{background:"var(--warn)",marginTop:6}}/>
                <div className="body-sm">
                  Abbiamo letto tutti i dati, ma su
                  {doubtfulInsightFields.length>0
                    ? <> <strong style={{color:"var(--t1)"}}>{doubtfulInsightFields.join(", ")}</strong></>
                    : " qualche valore"} non siamo del tutto sicuri che il numero fosse per intero nello screenshot.
                  Puoi proseguire: al passo successivo ti chiederemo di controllare i valori e potrai correggerli.
                  Se preferisci, puoi anche caricare un secondo screenshot più largo.
                </div>
              </div>
            </>
          )}
        </div>

        <button type="button" className="btn btn-primary" disabled={!canContinue} onClick={handleContinue}
          style={{width:"100%",padding:"16px",opacity:canContinue?1:.45,cursor:canContinue?"pointer":"not-allowed"}}>
          Continua con la candidatura
        </button>
      </div>

      {/* Popup: schermata sbagliata (profilo o Insight) */}
      {wrongScreen && (
        <div className="modal-overlay" onClick={()=>setWrongScreen(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="wrong-title">
            <button type="button" className="modal-close" onClick={()=>setWrongScreen(null)} aria-label="Chiudi">×</button>
            <div id="wrong-title" className="h-sm" style={{color:"var(--warn)",marginBottom:8,fontSize:16}}>{wrongCopy.title}</div>
            <p className="body-sm" style={{marginBottom:14}}>{wrongCopy.text}</p>
            {wrongScreen !== "profile" && (
              <p className="body-sm" style={{marginBottom:10,fontSize:13,color:"var(--t2)"}}>
                Apri Instagram e segui questo percorso:<br/>
                <strong style={{color:"var(--t1)"}}>Profilo → Dashboard per professionisti → Visualizzazioni</strong><br/>
                Imposta il periodo su 30 giorni. Assicurati che siano completamente visibili tutti i dati
                evidenziati in rosso nell'immagine di esempio.
              </p>
            )}
            <div style={{margin:"14px auto",maxWidth:220,border:"1px solid var(--brd)",background:"var(--bg-2)",padding:8}}>
              <img src={wrongExampleSrc} alt="Esempio della schermata corretta" style={{display:"block",width:"100%",height:"auto"}}/>
            </div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <button type="button" className="btn btn-primary btn-sm" onClick={()=>{
                const which = wrongScreen; setWrongScreen(null);
                if(which==="profile") removeProfile(); else removeInsight(which==="ins1"?1:2);
              }}>Sostituisci screenshot</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={()=>setWrongScreen(null)}>Ho capito</button>
            </div>
          </div>
        </div>
      )}

      {/* Popup: come trovare la schermata Insight */}
      {showInfoModal && (
        <div className="modal-overlay" onClick={()=>setShowInfoModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="howto-title">
            <button type="button" className="modal-close" onClick={()=>setShowInfoModal(false)} aria-label="Chiudi">×</button>
            <div id="howto-title" className="h-sm" style={{marginBottom:10,fontSize:16}}>Dove trovi questa schermata?</div>
            <p className="body-sm" style={{marginBottom:8}}>Apri Instagram e segui questo percorso:</p>
            <p style={{fontFamily:"var(--fh)",fontWeight:700,fontSize:14,color:"var(--t1)",lineHeight:1.5,marginBottom:12}}>
              Profilo → Dashboard per professionisti → Visualizzazioni
            </p>
            <p className="body-sm" style={{marginBottom:12}}>Imposta il periodo su 30 giorni.</p>
            <p className="body-sm" style={{marginBottom:12}}>
              Assicurati che siano completamente visibili tutti i dati evidenziati in rosso nell'immagine di esempio.
            </p>
            <div style={{margin:"0 auto 14px",maxWidth:240,border:"1px solid var(--brd)",background:"var(--bg-2)",padding:8}}>
              <img src={BRAND.insightsExampleSrc} alt="Esempio schermata Insight con dati evidenziati in rosso" style={{display:"block",width:"100%",height:"auto"}}/>
            </div>
            <div className="body-sm" style={{fontSize:12,color:"var(--t3)",marginBottom:6}}>Devono essere visibili:</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {["Visualizzazioni","Follower netti","Interazioni","Account raggiunti"].map(x=>(
                <div key={x} style={{display:"flex",alignItems:"center",gap:9}}>
                  <span className="dot" style={{background:"var(--red)"}}/>
                  <span className="body-sm" style={{fontSize:13}}>{x}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox: ingrandimento immagini di esempio */}
      {lightbox && (
        <div className="lightbox-overlay" onClick={()=>setLightbox(null)}>
          <button type="button" className="lightbox-close" onClick={()=>setLightbox(null)} aria-label="Chiudi">×</button>
          <img src={lightbox} alt="Immagine ingrandita" onClick={e=>e.stopPropagation()}/>
        </div>
      )}
    </div>
  );
}

function ApplicationForm({onBack, testMode=false, precheckData=null}){
  const [step,setStep]           = useState(0);
  // Se l'utente arriva dallo step di verifica screenshot, i dati Instagram sono già pronti:
  // niente upload da rifare, solo conferma dei quattro valori.
  const [prefilled] = useState(() => !!precheckData);
  // Se lo screenshot profilo mostrava un nome troncato ("Francesco Maz..."), il campo Nome
  // e cognome viene precompilato con la sola parte letta (senza i puntini), ma segnalato in
  // rosso: il candidato deve completarlo di persona. Il flag sparisce appena tocca il campo.
  const [nameNeedsCompletion,setNameNeedsCompletion] = useState(() => !!(precheckData && precheckData.fullNameNeedsCompletion));
  // Stesso meccanismo per lo username Instagram: Instagram stesso può troncarlo con "..."
  // senza che nello screenshot esista un'altra fonte da cui completarlo.
  const [usernameNeedsCompletion,setUsernameNeedsCompletion] = useState(() => !!(precheckData && precheckData.usernameNeedsCompletion));
  const [form,setForm]           = useState(() => precheckData ? {
    ...EMPTY_FORM,
    ...precheckData,
    fullName: precheckData.fullNameGuess || EMPTY_FORM.fullName
  } : EMPTY_FORM);
  const [errors,setErrors]       = useState({});
  // Stato per due upload indipendenti (1 = obbligatorio, 2 = facoltativo)
  const [ocr1,setOcr1] = useState({ state:"idle", msg:"", drag:false, screenType:null });
  const [ocr2,setOcr2] = useState({ state:"idle", msg:"", drag:false, screenType:null });
  const [insightConflicts,setInsightConflicts] = useState([]);
  const [wrongScreenSlot,setWrongScreenSlot] = useState(null); // slot con schermata sbagliata da mostrare nel popup
  const [showInfoModal,setShowInfoModal] = useState(false);
  const [lightbox,setLightbox] = useState(null); // src screenshot da ingrandire
  // Traccia, per ciascun campo numerico, se l'utente lo ha modificato rispetto al valore OCR
  // e l'esito dell'eventuale foto di verifica caricata per confermarlo.
  const [fieldVerify,setFieldVerify] = useState({});

  const ocrOriginal = (key) => {
    const m = form.ocrInsights && form.ocrInsights.merged;
    return m && m[key]!==null && m[key]!==undefined ? m[key] : null;
  };
  const isFieldEdited = (key) => {
    const orig = ocrOriginal(key);
    return orig !== null && String(orig) !== String(form[key]).trim();
  };
  const fieldLabelIt = {views:"Visualizzazioni",netFollowers:"Follower netti",interactions:"Interazioni",accountsReached:"Account raggiunti"};

  const uploadVerifyPhoto = async (key, file) => {
    if(testMode){ setFieldVerify(p=>({...p,[key]:{status:"unreadable",msg:"Lettura automatica disattivata in modalità prova."}})); return; }
    if(!file) return;
    if(!ALLOWED_IMAGE.includes(file.type) || file.size > MAX_UPLOAD_BYTES){
      setFieldVerify(p=>({...p,[key]:{status:"unreadable",msg:"Formato non valido, riprova."}})); return;
    }
    setFieldVerify(p=>({...p,[key]:{status:"checking"}}));
    try{
      const raw = await readFileAsDataURL(file);
      const img = await compressImage(raw);
      const expected = toNum(form[key]);
      const res = await verifyFieldValue(img, fieldLabelIt[key], expected);
      if(res.outcome==="match"){
        setFieldVerify(p=>({...p,[key]:{status:"verified"}}));
      }else if(res.outcome==="mismatch"){
        setFieldVerify(p=>({...p,[key]:{status:"mismatch",found:res.foundValue}}));
      }else{
        setFieldVerify(p=>({...p,[key]:{status:"unreadable",msg:"Non riusciamo a leggere il dato in questa foto."}}));
      }
    }catch(err){
      setFieldVerify(p=>({...p,[key]:{status:"unreadable",msg:"Immagine non valida."}}));
    }
  };

  // Renderizza uno dei quattro campi Insight con l'eventuale richiesta di foto di verifica:
  // usato sia quando i dati arrivano dal precheck sia quando arrivano dagli upload nel form.
  const renderInsightField = (key, label, placeholder, hint) => {
    const edited = isFieldEdited(key);
    const fv = fieldVerify[key];
    return (
      <Field key={key} label={label} required error={err(key)} hint={hint||undefined} htmlFor={"f-"+key}>
        <input id={"f-"+key} type="number" inputMode={key==="netFollowers"?"text":"numeric"}
          value={form[key]} aria-invalid={inv(key)}
          onChange={e=>{ set(key,e.target.value); setFieldVerify(p=>{ const n={...p}; delete n[key]; return n; }); }}
          placeholder={placeholder}/>
        {edited && (!fv || fv.status==="checking") && (
          <div className="field-verify">
            <div className="fv-label">Da verificare</div>
            <div className="body-sm" style={{fontSize:12,marginBottom:8}}>
              Hai indicato un valore diverso da quello rilevato nello screenshot. Carica una foto in cui questo dato sia chiaramente visibile.
            </div>
            {fv && fv.status==="checking"
              ? <Spinner label="Verifica in corso…"/>
              : (
                <label className="file-btn" style={{display:"inline-block"}}>
                  + Carica foto di verifica
                  <input type="file" accept="image/*" className="sr-only"
                    onChange={e=>{ uploadVerifyPhoto(key, e.target.files[0]); e.target.value=""; }}/>
                </label>
              )}
          </div>
        )}
        {edited && fv && fv.status==="verified" && (
          <div className="verify-pill ok" style={{marginTop:8}}>✓ Dato verificato</div>
        )}
        {edited && fv && fv.status==="mismatch" && (
          <div className="field-verify" style={{borderColor:"rgba(230,126,34,.6)"}}>
            <div className="fv-label">Valore differente nella foto</div>
            <div className="body-sm" style={{fontSize:12,marginBottom:8}}>
              Nella foto caricata risulta {fv.found}. Controlla e correggi il valore, oppure carica un'altra foto.
            </div>
            <label className="file-btn" style={{display:"inline-block"}}>
              + Carica un'altra foto
              <input type="file" accept="image/*" className="sr-only"
                onChange={e=>{ uploadVerifyPhoto(key, e.target.files[0]); e.target.value=""; }}/>
            </label>
          </div>
        )}
        {edited && fv && fv.status==="unreadable" && (
          <div className="field-verify" style={{borderColor:"rgba(230,126,34,.6)"}}>
            <div className="fv-label">Foto non leggibile</div>
            <div className="body-sm" style={{fontSize:12,marginBottom:8}}>{fv.msg||"Riprova con un'altra foto."}</div>
            <label className="file-btn" style={{display:"inline-block"}}>
              + Carica foto di verifica
              <input type="file" accept="image/*" className="sr-only"
                onChange={e=>{ uploadVerifyPhoto(key, e.target.files[0]); e.target.value=""; }}/>
            </label>
          </div>
        )}
      </Field>
    );
  };

  // ESC globale + scroll bloccato quando il modal informativo è aperto.
  useEffect(()=>{
    if(!showInfoModal) return;
    const onKey = e => { if(e.key === "Escape") setShowInfoModal(false); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [showInfoModal]);

  // ESC globale + scroll bloccato quando il popup "schermata sbagliata" è aperto.
  useEffect(()=>{
    if(wrongScreenSlot === null) return;
    const onKey = e => { if(e.key === "Escape") setWrongScreenSlot(null); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [wrongScreenSlot]);

  // ESC globale + scroll bloccato quando il lightbox delle miniature è aperto.
  useEffect(()=>{
    if(!lightbox) return;
    const onKey = e => { if(e.key === "Escape") setLightbox(null); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [lightbox]);
  // Ultime letture per fondere quando arriva la seconda
  const parsedRef = useRef({ a:null, b:null });
  const [saving,setSaving]       = useState(false);
  const [done,setDone]           = useState(false);
  const [saveErr,setSaveErr]     = useState("");
  const submissionRef = useRef(null);
  const topRef = useRef(null);

  const set = useCallback((k,v)=>{
    setForm(p=>({...p,[k]:v}));
    setErrors(p=> p[k] ? {...p, [k]:undefined} : p);
  },[]);

  const scrollTop = () => {
    if(topRef.current) topRef.current.scrollIntoView({behavior:"smooth",block:"start"});
    else window.scrollTo({top:0,behavior:"smooth"});
  };

  /* ---------- UPLOAD + LETTURA AUTOMATICA ---------- */
  const applyMerged = (parsedA, parsedB) => {
    const { merged, conflicts } = mergeInsights(parsedA, parsedB);
    setForm(p=>{
      const next = {...p};
      ["views","netFollowers","interactions","accountsReached"].forEach(k=>{
        const m = merged[k];
        if(m && m.value !== null && m.value !== undefined) next[k] = String(m.value);
      });
      // Salva i dati OCR grezzi per tracciamento
      next.ocrInsights = {
        screenshot1: parsedA || null,
        screenshot2: parsedB || null,
        merged: Object.fromEntries(Object.entries(merged).map(([k,v])=>[k,v&&v.value!==undefined?v.value:null])),
        conflicts: conflicts.map(c=>({key:c.key, valueA:c.valueA, valueB:c.valueB})),
        readAt: new Date().toISOString()
      };
      return next;
    });
    setInsightConflicts(conflicts);
  };

  const processFile = async (file, slot) => {
    if(testMode){ (slot===1 ? setOcr1 : setOcr2)(s=>({...s,state:"failed",msg:"Lettura automatica disattivata in modalità prova."})); return; }
    if(!file) return;
    const setSlot = slot===1 ? setOcr1 : setOcr2;
    if(!ALLOWED_IMAGE.includes(file.type)){
      setSlot(s=>({...s,state:"failed",msg:"Formato non supportato. Usa JPG, PNG o WEBP."})); return;
    }
    if(file.size > MAX_UPLOAD_BYTES){
      setSlot(s=>({...s,state:"failed",msg:"Immagine troppo pesante (massimo 12 MB)."})); return;
    }
    setSlot(s=>({...s,state:"reading",msg:""}));
    let img;
    try{
      const raw = await readFileAsDataURL(file);
      img = await compressImage(raw);
      const dataKey = slot===1 ? "screenshotData"  : "screenshotData2";
      const nameKey = slot===1 ? "screenshotName"  : "screenshotName2";
      setForm(p=>({...p, [dataKey]:img, [nameKey]:file.name}));
      if(slot===1) setErrors(p=>({...p, screenshotData:undefined}));
    }catch(err){
      console.error("Preparazione immagine non riuscita:", err);
      setSlot(s=>({...s,state:"failed",msg:err.message || "Immagine non valida."})); return;
    }
    setSlot(s=>({...s,state:"analyzing"}));
    try{
      const d = await extractInsights(img);

      // Se il modello ha classificato lo screenshot come Dashboard (schermata sbagliata),
      // non fondere i dati letti e apri il popup con l'esempio della schermata corretta.
      if(d.screenType === "dashboard_wrong"){
        setSlot(s=>({...s,state:"failed",msg:"Schermata errata",screenType:"dashboard_wrong"}));
        setWrongScreenSlot(slot);
        return;
      }

      parsedRef.current[slot===1?"a":"b"] = d;
      applyMerged(parsedRef.current.a, parsedRef.current.b);
      setSlot(s=>({...s,state:"done",msg:"",screenType:d.screenType||"insights_ok"}));
    }catch(err){
      console.warn("Lettura automatica non riuscita:", err);
      setSlot(s=>({...s,state:"failed",msg:err.message || "Lettura non riuscita",screenType:null}));
    }
  };

  const removeScreenshot = (slot) => {
    if(slot===1){
      setForm(p=>({...p, screenshotData:null, screenshotName:""}));
      parsedRef.current.a = null;
      setOcr1({state:"idle",msg:"",drag:false,screenType:null});
    }else{
      setForm(p=>({...p, screenshotData2:null, screenshotName2:""}));
      parsedRef.current.b = null;
      setOcr2({state:"idle",msg:"",drag:false,screenType:null});
    }
    applyMerged(parsedRef.current.a, parsedRef.current.b);
    if(wrongScreenSlot === slot) setWrongScreenSlot(null);
  };

  /* ---------- VALIDAZIONE ---------- */
  const validate = (s) => {
    const e = {};
    const req = (k,msg) => { if(!String(form[k]||"").trim()) e[k]=msg; };

    if(s===0){
      req("fullName","Inserisci nome e cognome");
      if(!String(form.age).trim()) e.age="Inserisci la tua età";
      else if(!Number.isInteger(Number(form.age)) || +form.age<18 || +form.age>99) e.age="Inserisci un'età intera compresa tra 18 e 99 anni. Le candidature sono riservate ai maggiorenni.";
      if(!String(form.email).trim()) e.email="Inserisci la tua email";
      else if(!isEmail(form.email)) e.email="Indirizzo email non valido";
      req("city","Inserisci la città");
      req("country","Inserisci il Paese");
      if(!Array.isArray(form.profileCategories) || form.profileCategories.length===0)
        e.profileCategories = "Seleziona almeno una categoria";
      if(Array.isArray(form.profileCategories) && form.profileCategories.includes("altro") && !String(form.otherProfileCategory||"").trim())
        e.otherProfileCategory = "Specifica la tua categoria";
      if(!form.isAdult) e.isAdult="Devi confermare di aver compiuto 18 anni";
    }
    if(s===1){
      req("instagram","Inserisci il tuo username Instagram");
      if(!String(form.followers).trim()) e.followers="Inserisci il numero di follower";
      else if(isNaN(form.followers) || +form.followers<0) e.followers="Valore non valido";
      if(!form.screenshotData) e.screenshotData="Carica il primo screenshot richiesto";
      ["views","interactions","accountsReached"].forEach(k=>{
        if(String(form[k]).trim()==="") e[k]="Dato mancante";
        else if(isNaN(form[k]) || +form[k]<0) e[k]="Valore non valido";
      });
      // I follower netti possono essere negativi
      if(String(form.netFollowers).trim()==="") e.netFollowers="Dato mancante";
      else if(isNaN(form.netFollowers)) e.netFollowers="Valore non valido";
      if(form.tiktokFollowers && (isNaN(form.tiktokFollowers) || +form.tiktokFollowers<0)) e.tiktokFollowers="Valore non valido";
      ["contentUrl1","contentUrl2","contentUrl3"].forEach(k=>{
        if(form[k] && !isUrl(form[k])) e[k]="Inserisci un link valido (https://…)";
      });
    }
    if(s===2){
      req("threeWords","Campo obbligatorio");
      req("contentType","Campo obbligatorio");
      req("whatToTransmit","Campo obbligatorio");
      req("whyFollow","Campo obbligatorio");
      req("hasBrandCollabs","Seleziona un'opzione");
      if(form.hasBrandCollabs==="yes") req("brandCollabDetails","Descrivi le collaborazioni");
    }
    if(s===3){
      req("motivation","Campo obbligatorio");
      req("brandLike","Campo obbligatorio");
      req("contentIntegration","Campo obbligatorio");
    }
    if(s===4){
      req("buildWithoutEarnings","Seleziona un'opzione");
      req("brandMeaning","Campo obbligatorio");
    }
    if(s===5){
      req("contentPerMonth","Seleziona un'opzione");
      req("hasRoutine","Seleziona un'opzione");
      req("followsGuidelines","Seleziona un'opzione");
      req("availEvents","Seleziona un'opzione");
      req("availShooting","Seleziona un'opzione");
      req("availUgc","Seleziona un'opzione");
      req("availRawFiles","Seleziona un'opzione");
    }
    if(s===6){
      if(!form.privacyConsent) e.privacyConsent="Devi accettare il trattamento dei dati per inviare la candidatura";
    }
    return e;
  };

  const next = () => {
    const e = validate(step);
    if(Object.keys(e).length){ setErrors(e); scrollTop(); return; }
    setErrors({}); setStep(s=>s+1); scrollTop();
  };
  const prev = () => { setErrors({}); step>0 ? setStep(s=>s-1) : onBack(); scrollTop(); };

  /* ---------- INVIO ---------- */
  const submit = async () => {
    if(saving) return;
    // Local simulation: no API, Firestore, OCR or Telegram calls.
    if(testMode){
      const profileErrors=validate(0);
      const ageErrors=Object.fromEntries(Object.entries(profileErrors).filter(([key])=>key==="age"||key==="isAdult"));
      if(Object.keys(ageErrors).length){ setErrors(ageErrors); setSaveErr("Anche la simulazione richiede un'età di 18–99 anni e la dichiarazione di maggiore età."); setStep(0); scrollTop(); return; }
      setSaveErr(""); setDone(true); window.scrollTo({top:0}); return;
    }
    const e = Object.assign({}, ...STEPS.map((_,i)=>validate(i)));
    if(Object.keys(e).length){ setErrors(e); setSaveErr("Controlla i campi evidenziati prima di inviare.");
      const target=FORM_STEP_FIELDS.findIndex(keys=>keys.some(key=>e[key]));
      setStep(target>=0?target:0); scrollTop(); return; }
    setSaving(true); setSaveErr("");
    try{
      if(!submissionRef.current) submissionRef.current = CollectiveApplications.createSubmissionClient({endpoint:APPLICATIONS_URL});
      await submissionRef.current.send(form);
      setDone(true); window.scrollTo({top:0});
    }catch(error){
      setSaveErr(error instanceof CollectiveApplications.SubmissionError ? error.message : "Invio non disponibile. Riprova più tardi.");
      if(error.field){
        setErrors(p=>({...p,[error.field]:"Controlla il valore inserito."}));
        const target=FORM_STEP_FIELDS.findIndex(keys=>keys.includes(error.field));
        if(target>=0) setStep(target);
      }
    }finally{setSaving(false);}
  };

  /* ---------- SCHERMATA DI CONFERMA ---------- */
  if(done){
    return (
      <div style={{minHeight:"100vh",display:"flex",flexDirection:"column"}}>
        <nav className="nav"><div className="wrap nav-in"><Logo height={24}/></div></nav>
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:"48px 20px"}}>
          <div style={{maxWidth:600,textAlign:"center",animation:"fadeUp .6s ease both"}}>
            <div style={{width:64,height:64,border:"2px solid var(--ok)",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 26px"}}>
              <span style={{color:"var(--ok)",fontSize:30,lineHeight:1}}>✓</span>
            </div>
            <h1 className="h-lg" style={{marginBottom:18}}>{testMode ? "Simulazione completata" : "Candidatura ricevuta"}</h1>
            <p className="body" style={{marginBottom:16}}>
              {testMode ? "Modalità prova: nessuna candidatura è stata salvata e nessuna notifica è stata inviata." : "Grazie per aver presentato la tua candidatura a "+BRAND.program+"."}
            </p>
            {!testMode && <p className="body-sm" style={{marginBottom:32,maxWidth:520,marginLeft:"auto",marginRight:"auto"}}>
              Il nostro team analizzerà il tuo profilo, i dati e le risposte fornite.
              L'invio della candidatura non garantisce l'accesso al programma.
              Se riterremo che esistano le condizioni per costruire una collaborazione,
              ti contatteremo utilizzando l'indirizzo email indicato.
            </p>}
            <a className="btn btn-ghost" href={BRAND.siteUrl}>Torna a EVORΛ</a>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- HELPER RIGHE ---------- */
  const err = k => errors[k];
  const inv = k => errors[k] ? "true" : "false";

  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column"}}>
      <nav className="nav">
        <div className="wrap nav-in">
          <Logo height={24}/>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {testMode && (
              <button className="btn btn-ghost btn-sm" style={{borderColor:"var(--warn)",color:"var(--warn)"}}
                onClick={()=>{ setForm({...TEST_FORM}); setStep(6); }}>Compila test</button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={onBack}>Esci</button>
          </div>
        </div>
      </nav>

      <div className="wrap-narrow" style={{padding:"32px 20px 90px",flex:1}} ref={topRef}>
        <div className="eyebrow" style={{marginBottom:10}}>{BRAND.program}</div>
        <h1 className="h-md" style={{marginBottom:22}}>Candidatura al Partner Program</h1>
        {testMode && <div className="status-box" role="status">Modalità prova: invio e lettura automatica disattivati. Nessun dato verrà salvato.</div>}

        {/* PROGRESS */}
        <div className="steps" role="progressbar" aria-valuenow={step+1} aria-valuemin="1" aria-valuemax={STEPS.length}>
          {STEPS.map((s,i)=><div key={s} className={"step-seg"+(i<=step?" done":"")}/>)}
        </div>
        <div className="step-meta">
          <span className="h-sm">{STEPS[step]}</span>
          <span className="label-xs">Step {step+1} di {STEPS.length}</span>
        </div>

        {/* ============ STEP 1 — PROFILO ============ */}
        {step===0 && (
          <section style={{animation:"fadeUp .3s ease both"}}>
            <Field label="Nome e cognome" required
              error={nameNeedsCompletion ? "Il nome letto dallo screenshot era troncato: completalo per intero." : err("fullName")}
              htmlFor="f-name">
              <input id="f-name" value={form.fullName}
                aria-invalid={nameNeedsCompletion ? "true" : inv("fullName")}
                onChange={e=>{ set("fullName",e.target.value); if(nameNeedsCompletion) setNameNeedsCompletion(false); }}
                placeholder="Mario Rossi" autoComplete="name"/>
            </Field>
            <div className="g2-gap">
              <Field label="Età" required error={err("age")} htmlFor="f-age" hint="Candidature riservate a chi ha compiuto 18 anni (età ammessa: 18–99 anni).">
                <input id="f-age" type="number" inputMode="numeric" min="18" max="99" step="1" value={form.age} aria-invalid={inv("age")}
                  onChange={e=>set("age",e.target.value)} placeholder="26"/>
              </Field>
              <Field label="Email" required error={err("email")} hint="La useremo per ricontattarti." htmlFor="f-email">
                <input id="f-email" type="email" value={form.email} aria-invalid={inv("email")}
                  onChange={e=>set("email",e.target.value)} placeholder="nome@email.com" autoComplete="email"/>
              </Field>
            </div>
            <div className="g2-gap">
              <Field label="Città" required error={err("city")} htmlFor="f-city">
                <input id="f-city" value={form.city} aria-invalid={inv("city")}
                  onChange={e=>set("city",e.target.value)} placeholder="Milano"/>
              </Field>
              <Field label="Paese" required error={err("country")} htmlFor="f-country">
                <input id="f-country" value={form.country} aria-invalid={inv("country")}
                  onChange={e=>set("country",e.target.value)} placeholder="Italia"/>
              </Field>
            </div>
            <Field label="Categoria del profilo" required
              hint="Puoi selezionarne più di una."
              error={err("profileCategories") || err("otherProfileCategory")}>
              <div className="pick-grid" role="group" aria-label="Categorie del profilo">
                {CATEGORIES.map(c=>{
                  const on = (form.profileCategories||[]).includes(c.v);
                  return (
                    <label key={c.v} className={"pick"+(on?" on":"")}>
                      <input type="checkbox" checked={on}
                        onChange={()=>{
                          const list = Array.isArray(form.profileCategories) ? form.profileCategories.slice() : [];
                          const i = list.indexOf(c.v);
                          if(i>=0) list.splice(i,1); else list.push(c.v);
                          set("profileCategories", list);
                        }}/>
                      <span>{c.l}</span>
                    </label>
                  );
                })}
              </div>
            </Field>
            {(form.profileCategories||[]).includes("altro") && (
              <Field label="Specifica la tua categoria" required error={err("otherProfileCategory")} htmlFor="f-otherCat">
                <input id="f-otherCat" value={form.otherProfileCategory} aria-invalid={inv("otherProfileCategory")}
                  onChange={e=>set("otherProfileCategory",e.target.value)} placeholder="Es. Fisioterapista sportivo"/>
              </Field>
            )}
            <div className="field">
              <label className="check">
                <input type="checkbox" checked={form.isAdult} onChange={e=>set("isAdult",e.target.checked)}/>
                <span>Dichiaro di aver compiuto 18 anni.</span>
              </label>
              {err("isAdult") && <span className="field-err" role="alert">{err("isAdult")}</span>}
            </div>
          </section>
        )}

        {/* ============ STEP 2 — SOCIAL ============ */}
        {/* Modal informativo Insights */}
        {showInfoModal && (
          <div className="modal-overlay" onClick={()=>setShowInfoModal(false)}>
            <div className="modal" onClick={e=>e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Come trovare gli Insight Instagram">
              <button className="modal-close" onClick={()=>setShowInfoModal(false)} aria-label="Chiudi">✕</button>
              <div className="h-sm" style={{marginBottom:14}}>Dove trovi questi dati?</div>
              <p className="body-sm" style={{marginBottom:10}}>Apri Instagram e segui questo percorso:</p>
              <p style={{fontFamily:"var(--fh)",fontWeight:700,fontSize:15,color:"var(--t1)",lineHeight:1.5,marginBottom:14}}>
                Profilo → Dashboard per professionisti → Visualizzazioni
              </p>
              <p className="body-sm" style={{marginBottom:12}}>
                Assicurati che il periodo selezionato sia <strong style={{color:"var(--t1)"}}>30 giorni</strong>.
              </p>
              <p className="body-sm" style={{marginBottom:12}}>Nella schermata devono essere visibili:</p>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
                {["Visualizzazioni","Follower netti","Interazioni","Account raggiunti"].map(x=>(
                  <div key={x} style={{display:"flex",alignItems:"center",gap:10}}>
                    <span className="dot" style={{background:"var(--red)"}}/>
                    <span style={{fontFamily:"var(--fh)",fontWeight:600,fontSize:13,color:"var(--t1)"}}>{x}</span>
                  </div>
                ))}
              </div>
              <p className="body-sm" style={{color:"var(--t3)"}}>
                Se sul tuo dispositivo non riesci a visualizzare tutti i dati in un'unica schermata,
                puoi caricare un secondo screenshot scorrendo leggermente verso il basso.
              </p>
            </div>
          </div>
        )}

        

        {/* Popup: schermata sbagliata caricata */}
        {wrongScreenSlot!==null && (
          <div className="modal-overlay" onClick={()=>setWrongScreenSlot(null)}>
            <div className="modal" onClick={e=>e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="wrong-screen-title">
              <button type="button" className="modal-close" onClick={()=>setWrongScreenSlot(null)} aria-label="Chiudi">×</button>
              <div id="wrong-screen-title" className="h-sm" style={{color:"var(--warn)",marginBottom:8,fontSize:16}}>
                Sembra la schermata sbagliata
              </div>
              <p className="body-sm" style={{marginBottom:16}}>
                Hai caricato la <strong style={{color:"var(--t1)"}}>Dashboard per professionisti</strong>. Ci serve invece la pagina <strong style={{color:"var(--t1)"}}>Insight</strong>, che si raggiunge da lì.
              </p>
              <p className="body-sm" style={{marginBottom:10,fontSize:13,color:"var(--t2)"}}>
                <strong style={{color:"var(--t1)"}}>Come arrivarci:</strong><br/>
                Dalla Dashboard per professionisti tocca <strong style={{color:"var(--t1)"}}>Insight</strong> (in alto) → seleziona il periodo <strong style={{color:"var(--t1)"}}>30 giorni</strong>.
              </p>
              <div style={{margin:"14px auto",maxWidth:220,border:"1px solid var(--brd)",background:"var(--bg-2)",padding:8}}>
                <img src={BRAND.insightsExampleSrc} alt="Esempio della schermata Insight corretta"
                  style={{display:"block",width:"100%",height:"auto"}}/>
                <div className="label-xs" style={{textAlign:"center",marginTop:8,color:"var(--t3)"}}>
                  Questa è la schermata giusta
                </div>
              </div>
              <p className="body-sm" style={{fontSize:12,color:"var(--t4)",marginBottom:16,lineHeight:1.5}}>
                I dati che ci servono sono: Visualizzazioni, Follower netti, Interazioni e Account raggiunti.
              </p>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                <button type="button" className="btn btn-primary btn-sm"
                  onClick={()=>{ const slot=wrongScreenSlot; setWrongScreenSlot(null); removeScreenshot(slot); }}>
                  Rimuovi e riprova
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={()=>setWrongScreenSlot(null)}>
                  Ho capito
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Lightbox: ingrandimento miniature screenshot caricati nello step iniziale */}
        {lightbox && (
          <div className="lightbox-overlay" onClick={()=>setLightbox(null)}>
            <button type="button" className="lightbox-close" onClick={()=>setLightbox(null)} aria-label="Chiudi">×</button>
            <img src={lightbox} alt="Screenshot ingrandito" onClick={e=>e.stopPropagation()}/>
          </div>
        )}
        {step===1 && (
          <section style={{animation:"fadeUp .3s ease both"}}>
            {/* ── INSTAGRAM ── */}
            <div className="eyebrow" style={{marginBottom:14}}>Instagram</div>
            <div className="g2-gap">
              <Field label="Username Instagram" required
                error={usernameNeedsCompletion ? "Lo username letto dallo screenshot era troncato: completalo per intero." : err("instagram")}
                htmlFor="f-ig">
                <input id="f-ig" value={form.instagram}
                  aria-invalid={usernameNeedsCompletion ? "true" : inv("instagram")}
                  onChange={e=>{ set("instagram",e.target.value); if(usernameNeedsCompletion) setUsernameNeedsCompletion(false); }}
                  placeholder="@username"/>
              </Field>
              <Field label="Follower" required error={err("followers")} htmlFor="f-fol">
                <input id="f-fol" type="number" inputMode="numeric" value={form.followers} aria-invalid={inv("followers")}
                  onChange={e=>set("followers",e.target.value)} placeholder="12500"/>
              </Field>
            </div>

            {/* ── INSIGHT: TITOLO + DESCRIZIONE ── */}
            <div style={{marginTop:22,marginBottom:14}}>
              <div className="field-label" style={{marginBottom:6}}>Insight degli ultimi 30 giorni</div>
              <p className="body-sm" style={{fontSize:13,color:"var(--t3)",marginBottom:prefilled?0:12,lineHeight:1.5}}>
                Visualizzazioni, follower netti, interazioni e account raggiunti.
              </p>
              {!prefilled && (
                <button type="button" className="info-trigger" onClick={()=>setShowInfoModal(true)}
                  aria-label="Come trovare i dati Instagram" style={{marginTop:12}}>
                  <span className="info-btn" aria-hidden="true">i</span>
                  <span className="info-trigger-label">Come trovare questi dati</span>
                </button>
              )}
            </div>

            {prefilled ? (
              <>
                {/* ── DATI GIÀ VERIFICATI NELLO STEP INIZIALE ── */}
                <div style={{marginTop:8,paddingTop:4}}>
                  <div className="h-sm" style={{marginBottom:4}}>Controlla i dati rilevati</div>
                  <p className="body-sm" style={{fontSize:13,marginBottom:14,color:"var(--t3)"}}>
                    Abbiamo compilato automaticamente questi dati dagli screenshot caricati. Controlla che siano corretti.
                  </p>
                  <div className="g2-gap">
                    {renderInsightField("views","Visualizzazioni","28400","")}
                    {renderInsightField("netFollowers","Follower netti","260","Può essere negativo")}
                    {renderInsightField("interactions","Interazioni","1240","")}
                    {renderInsightField("accountsReached","Account raggiunti","18400","")}
                  </div>

                  {/* Miniature degli screenshot caricati nello step iniziale, ingrandibili al tocco */}
                  {(form.profileScreenshotData || form.screenshotData || form.screenshotData2) && (
                    <div style={{marginTop:16}}>
                      <div className="label-xs" style={{marginBottom:8}}>Screenshot caricati</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        {form.profileScreenshotData && (
                          <button type="button" className="thumb-btn" style={{width:64}}
                            onClick={()=>setLightbox(form.profileScreenshotData)} aria-label="Ingrandisci screenshot profilo">
                            <img src={form.profileScreenshotData} alt="Screenshot profilo"/>
                          </button>
                        )}
                        {form.screenshotData && (
                          <button type="button" className="thumb-btn" style={{width:64}}
                            onClick={()=>setLightbox(form.screenshotData)} aria-label="Ingrandisci primo screenshot Insight">
                            <img src={form.screenshotData} alt="Screenshot Insight 1"/>
                          </button>
                        )}
                        {form.screenshotData2 && (
                          <button type="button" className="thumb-btn" style={{width:64}}
                            onClick={()=>setLightbox(form.screenshotData2)} aria-label="Ingrandisci secondo screenshot Insight">
                            <img src={form.screenshotData2} alt="Screenshot Insight 2"/>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* ── SCREENSHOT 1 — obbligatorio, compatto ── */}
                <div className="field" style={{marginBottom:10}}>
                  <label className={"upload-compact"+(form.screenshotData?" done":"")+(ocr1.drag?" over":"")+(err("screenshotData")?" err":"")}
                    onDragOver={e=>{e.preventDefault();setOcr1(s=>({...s,drag:true}));}}
                    onDragLeave={()=>setOcr1(s=>({...s,drag:false}))}
                    onDrop={e=>{e.preventDefault();setOcr1(s=>({...s,drag:false}));processFile(e.dataTransfer.files[0],1);}}>
                    {form.screenshotData
                      ? <div className="u-thumb"><img src={form.screenshotData} alt="Anteprima primo screenshot"/></div>
                      : <div className="u-plus" aria-hidden="true">+</div>}
                    <div className="u-info">
                      <div className="u-title">Screenshot 1 — obbligatorio</div>
                      <div className="u-sub">
                        {form.screenshotData
                          ? "Screenshot caricato · tocca per sostituire"
                          : (ocr1.state==="reading" ? "Preparazione in corso…"
                             : ocr1.state==="analyzing" ? "Lettura automatica in corso…"
                             : "+ Tocca per caricare lo screenshot")}
                      </div>
                    </div>
                    {form.screenshotData && <span className="u-check" aria-hidden="true">✓</span>}
                    <input type="file" accept="image/*" className="sr-only"
                      aria-label="Carica il primo screenshot"
                      onChange={e=>{ processFile(e.target.files[0],1); e.target.value=""; }}/>
                  </label>
                  {form.screenshotData && (
                    <div className="upload-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={()=>removeScreenshot(1)}>Rimuovi</button>
                    </div>
                  )}
                  {err("screenshotData") && <span className="field-err" role="alert">{err("screenshotData")}</span>}
                </div>

                {/* ── SCREENSHOT 2 — facoltativo, compatto ── */}
                <div className="field" style={{marginBottom:8}}>
                  <label className={"upload-compact"+(form.screenshotData2?" done":"")+(ocr2.drag?" over":"")}
                    onDragOver={e=>{e.preventDefault();setOcr2(s=>({...s,drag:true}));}}
                    onDragLeave={()=>setOcr2(s=>({...s,drag:false}))}
                    onDrop={e=>{e.preventDefault();setOcr2(s=>({...s,drag:false}));processFile(e.dataTransfer.files[0],2);}}>
                    {form.screenshotData2
                      ? <div className="u-thumb"><img src={form.screenshotData2} alt="Anteprima secondo screenshot"/></div>
                      : <div className="u-plus" aria-hidden="true">+</div>}
                    <div className="u-info">
                      <div className="u-title">Screenshot 2 — facoltativo</div>
                      <div className="u-sub">
                        {form.screenshotData2
                          ? "Secondo screenshot caricato · tocca per sostituire"
                          : (ocr2.state==="reading" ? "Preparazione in corso…"
                             : ocr2.state==="analyzing" ? "Lettura automatica in corso…"
                             : "+ Aggiungi un secondo screenshot")}
                      </div>
                      {!form.screenshotData2 && (
                        <div style={{fontFamily:"var(--fb)",fontSize:11,color:"var(--t4)",marginTop:4,lineHeight:1.4,whiteSpace:"normal"}}>
                          Usalo solo se alcuni dati non sono visibili nella prima immagine.
                        </div>
                      )}
                    </div>
                    {form.screenshotData2 && <span className="u-check" aria-hidden="true">✓</span>}
                    <input type="file" accept="image/*" className="sr-only"
                      aria-label="Carica il secondo screenshot"
                      onChange={e=>{ processFile(e.target.files[0],2); e.target.value=""; }}/>
                  </label>
                  {form.screenshotData2 && (
                    <div className="upload-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={()=>removeScreenshot(2)}>Rimuovi</button>
                    </div>
                  )}
                </div>

                {/* ── MESSAGGI DINAMICI DOPO IL CARICAMENTO ── */}
                {ocr1.state==="failed" && insightConflicts.length===0 && (
                  <div className="status-box" style={{borderColor:"rgba(230,126,34,.45)",marginTop:8}}>
                    <div className="dot" style={{background:"var(--warn)",marginTop:6}}/>
                    <div className="body-sm" style={{color:"var(--t2)"}}>
                      {ocr1.screenType === "dashboard_wrong" ? (
                        <>
                          <strong style={{color:"var(--warn)"}}>Screenshot 1 · schermata sbagliata.</strong>{" "}
                          Serve la pagina Insight, non la Dashboard.{" "}
                          <button type="button" className="nav-link" style={{background:"none",border:"none",cursor:"pointer",textDecoration:"underline",padding:0,fontSize:"inherit",color:"var(--warn)"}}
                            onClick={()=>setWrongScreenSlot(1)}>Vedi esempio</button>
                        </>
                      ) : (
                        <>
                          <strong style={{color:"var(--warn)"}}>{ocr1.msg||"Lettura non riuscita."}</strong>{" "}
                          Puoi caricare un\'altra immagine oppure inserire i dati manualmente.
                        </>
                      )}
                    </div>
                  </div>
                )}
                {ocr2.state==="failed" && (
                  <div className="status-box" style={{borderColor:"rgba(230,126,34,.45)",marginTop:8}}>
                    <div className="dot" style={{background:"var(--warn)",marginTop:6}}/>
                    <div className="body-sm" style={{color:"var(--t2)"}}>
                      {ocr2.screenType === "dashboard_wrong" ? (
                        <>
                          <strong style={{color:"var(--warn)"}}>Screenshot 2 · schermata sbagliata.</strong>{" "}
                          Serve la pagina Insight, non la Dashboard.{" "}
                          <button type="button" className="nav-link" style={{background:"none",border:"none",cursor:"pointer",textDecoration:"underline",padding:0,fontSize:"inherit",color:"var(--warn)"}}
                            onClick={()=>setWrongScreenSlot(2)}>Vedi esempio</button>
                        </>
                      ) : ocr2.msg || "Lettura del secondo screenshot non riuscita."}
                    </div>
                  </div>
                )}
                {(ocr1.state==="done" || ocr2.state==="done") && insightConflicts.length===0 && (
                  (form.views==="" || form.netFollowers==="" || form.interactions==="" || form.accountsReached==="")
                    ? (
                      <div className="status-box" style={{borderColor:"rgba(230,126,34,.45)",marginTop:8}}>
                        <div className="dot" style={{background:"var(--warn)",marginTop:6}}/>
                        <div className="body-sm" style={{color:"var(--t2)"}}>
                          Alcuni valori non sono stati rilevati. Puoi aggiungere un secondo screenshot oppure inserirli manualmente.
                        </div>
                      </div>
                    )
                    : (
                      <div className="status-box" style={{borderColor:"rgba(39,174,96,.45)",marginTop:8}}>
                        <div className="dot" style={{background:"var(--ok)",marginTop:6}}/>
                        <div className="body-sm" style={{color:"var(--t2)"}}>
                          Dati rilevati automaticamente. Controllali prima di continuare.
                        </div>
                      </div>
                    )
                )}
                {insightConflicts.length>0 && (
                  <div className="status-box" style={{borderColor:"rgba(230,126,34,.45)",marginTop:8}}>
                    <div className="dot" style={{background:"var(--warn)",marginTop:6}}/>
                    <div className="body-sm" style={{color:"var(--t2)"}}>
                      <strong style={{color:"var(--warn)"}}>Abbiamo rilevato valori differenti tra i due screenshot.</strong>{" "}
                      Controlla e conferma manualmente quelli corretti.
                      <div style={{marginTop:8}}>
                        {insightConflicts.map(c=>(
                          <div key={c.key} style={{fontSize:12,color:"var(--t3)",marginTop:4}}>
                            {{views:"Visualizzazioni",netFollowers:"Follower netti",interactions:"Interazioni",accountsReached:"Account raggiunti"}[c.key]}:
                            {" screenshot 1 → "}<strong style={{color:"var(--t1)"}}>{c.valueA}</strong>
                            {" · screenshot 2 → "}<strong style={{color:"var(--t1)"}}>{c.valueB}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── DATI ESTRATTI · SEMPRE MODIFICABILI ── */}
                <div style={{marginTop:22,paddingTop:18,borderTop:"1px solid var(--brd)"}}>
                  <div className="h-sm" style={{marginBottom:4}}>Controlla i dati rilevati</div>
                  <p className="body-sm" style={{fontSize:13,marginBottom:14,color:"var(--t3)"}}>
                    I valori sono stati compilati automaticamente. Correggili se necessario.
                  </p>
                  <div className="g2-gap">
                    {renderInsightField("views","Visualizzazioni","28400","")}
                    {renderInsightField("netFollowers","Follower netti","260","Può essere negativo")}
                    {renderInsightField("interactions","Interazioni","1240","")}
                    {renderInsightField("accountsReached","Account raggiunti","18400","")}
                  </div>
                </div>
              </>
            )}

            {/* ── TIKTOK ── */}
            <div className="eyebrow" style={{margin:"30px 0 14px",color:"var(--t3)"}}>TikTok · facoltativo</div>
            <div className="g2-gap">
              <Field label="Username TikTok" htmlFor="f-tt">
                <input id="f-tt" value={form.tiktok} onChange={e=>set("tiktok",e.target.value)} placeholder="@username"/>
              </Field>
              <Field label="Follower TikTok" error={err("tiktokFollowers")} htmlFor="f-ttf">
                <input id="f-ttf" type="number" inputMode="numeric" value={form.tiktokFollowers}
                  aria-invalid={inv("tiktokFollowers")} onChange={e=>set("tiktokFollowers",e.target.value)} placeholder="4800"/>
              </Field>
            </div>

            {/* ── CONTENUTI ── */}
            <div className="eyebrow" style={{margin:"30px 0 14px",color:"var(--t3)"}}>Contenuti rappresentativi · facoltativo</div>
            <p className="body-sm" style={{marginBottom:16}}>
              Condividi fino a tre contenuti che rappresentano meglio il tuo modo di comunicare.
            </p>
            {[1,2,3].map(n=>(
              <Field key={n} label={"Link contenuto "+n} error={err("contentUrl"+n)} htmlFor={"f-url"+n}>
                <input id={"f-url"+n} type="url" value={form["contentUrl"+n]} aria-invalid={inv("contentUrl"+n)}
                  onChange={e=>set("contentUrl"+n,e.target.value)} placeholder="https://www.instagram.com/reel/…"/>
              </Field>
            ))}
          </section>
        )}

        {/* ============ STEP 3 — POSIZIONAMENTO ============ */}
        {step===2 && (
          <section style={{animation:"fadeUp .3s ease both"}}>
            <Field label="Tre parole che ti descrivono come creator" required error={err("threeWords")} htmlFor="f-3w">
              <input id="f-3w" value={form.threeWords} maxLength={LIMITS.short} aria-invalid={inv("threeWords")}
                onChange={e=>set("threeWords",e.target.value)} placeholder="Es. concreto, costante, diretto"/>
            </Field>
            <Field label="Che tipo di contenuti pubblichi principalmente?" required error={err("contentType")} htmlFor="f-ct">
              <CharField id="f-ct" value={form.contentType} onChange={v=>set("contentType",v)} max={LIMITS.medium}
                invalid={!!err("contentType")} placeholder="Formati, temi, frequenza di pubblicazione…"/>
            </Field>
            <Field label="Cosa vuoi trasmettere al tuo pubblico?" required error={err("whatToTransmit")} htmlFor="f-wt">
              <CharField id="f-wt" value={form.whatToTransmit} onChange={v=>set("whatToTransmit",v)} max={LIMITS.medium}
                invalid={!!err("whatToTransmit")} placeholder="Il messaggio centrale del tuo profilo…"/>
            </Field>
            <Field label="Per quale motivo le persone scelgono di seguirti e continuano a farlo?" required
              error={err("whyFollow")} htmlFor="f-wf">
              <CharField id="f-wf" value={form.whyFollow} onChange={v=>set("whyFollow",v)} max={LIMITS.medium}
                invalid={!!err("whyFollow")} placeholder="Cosa ti distingue concretamente…"/>
            </Field>
            <Field label="Hai già collaborato con brand del settore fitness?" required error={err("hasBrandCollabs")}>
              <ChipGroup name="collab" value={form.hasBrandCollabs} onChange={v=>set("hasBrandCollabs",v)}
                options={[{v:"yes",l:"Sì"},{v:"no",l:"No, sarebbe la prima"}]}/>
            </Field>
            {form.hasBrandCollabs==="yes" && (
              <Field label="Con quali brand e in che forma?" required error={err("brandCollabDetails")} htmlFor="f-bcd">
                <CharField id="f-bcd" value={form.brandCollabDetails} onChange={v=>set("brandCollabDetails",v)} max={LIMITS.medium}
                  invalid={!!err("brandCollabDetails")} rows={3} placeholder="Brand, tipo di collaborazione, periodo…"/>
              </Field>
            )}
          </section>
        )}

        {/* ============ STEP 4 — COMPATIBILITÀ ============ */}
        {step===3 && (
          <section style={{animation:"fadeUp .3s ease both"}}>
            <Field label="Perché ritieni che possa esistere una collaborazione credibile tra il tuo percorso ed EVORΛ?"
              required error={err("motivation")} htmlFor="f-mot">
              <CharField id="f-mot" value={form.motivation} onChange={v=>set("motivation",v)} max={LIMITS.long} rows={5}
                invalid={!!err("motivation")} placeholder="Parlaci del punto di contatto tra il tuo percorso e il brand…"/>
            </Field>
            <Field label="Cosa apprezzi di EVORΛ?" required error={err("brandLike")} htmlFor="f-bl">
              <CharField id="f-bl" value={form.brandLike} onChange={v=>set("brandLike",v)} max={LIMITS.medium}
                invalid={!!err("brandLike")} placeholder="Prodotti, comunicazione, posizionamento…"/>
            </Field>
            <Field label="Come integreresti EVORΛ nei tuoi contenuti senza renderli una pubblicità forzata?"
              required error={err("contentIntegration")} htmlFor="f-ci">
              <CharField id="f-ci" value={form.contentIntegration} onChange={v=>set("contentIntegration",v)} max={LIMITS.long} rows={5}
                invalid={!!err("contentIntegration")} placeholder="Descrivi concretamente formati e contesti…"/>
            </Field>
          </section>
        )}

        {/* ============ STEP 5 — MENTALITÀ ============ */}
        {step===4 && (
          <section style={{animation:"fadeUp .3s ease both"}}>
            <Field label="Saresti disponibile a iniziare con un periodo in cui entrambe le parti valutano la qualità della collaborazione, senza una garanzia di risultati economici immediati?"
              required error={err("buildWithoutEarnings")}>
              <ChipGroup name="trial" value={form.buildWithoutEarnings} onChange={v=>set("buildWithoutEarnings",v)}
                options={[
                  {v:"yes",l:"Sì"},
                  {v:"yes_conditions",l:"Sì, entro condizioni definite"},
                  {v:"depends",l:"Dipende dal progetto"},
                  {v:"paid_only",l:"Preferisco compenso garantito"}
                ]}/>
            </Field>
            <Field label="Che cosa significa per te rappresentare un brand?"
              required error={err("brandMeaning")} htmlFor="f-bm">
              <CharField id="f-bm" value={form.brandMeaning} onChange={v=>set("brandMeaning",v)} max={LIMITS.long} rows={4}
                invalid={!!err("brandMeaning")} placeholder="Con parole tue…"/>
            </Field>
          </section>
        )}

        {/* ============ STEP 6 — DISPONIBILITÀ ============ */}
        {step===5 && (
          <section style={{animation:"fadeUp .3s ease both"}}>
            <Field label="Quanti contenuti dedicati o integrati a EVORΛ riusciresti realisticamente a produrre ogni mese mantenendo il tuo standard qualitativo?"
              required error={err("contentPerMonth")}>
              <ChipGroup name="cpm" value={form.contentPerMonth} onChange={v=>set("contentPerMonth",v)}
                options={[
                  {v:"lt1",l:"Meno di 1 al mese"},
                  {v:"1-2",l:"1–2 al mese"},
                  {v:"3-4",l:"3–4 al mese"},
                  {v:"5+",l:"5 o più"},
                  {v:"depends",l:"Dipende dal progetto"}
                ]}/>
            </Field>
            <Field label="Hai una costanza di pubblicazione?" required error={err("hasRoutine")}>
              <ChipGroup name="routine" value={form.hasRoutine} onChange={v=>set("hasRoutine",v)}
                options={[{v:"yes",l:"Sì, costante"},{v:"building",l:"La sto costruendo"},{v:"no",l:"No, irregolare"}]}/>
            </Field>
            <Field label="Sei disponibile a seguire linee guida creative concordate?" required error={err("followsGuidelines")}>
              <ChipGroup name="guide" value={form.followsGuidelines} onChange={v=>set("followsGuidelines",v)}
                options={[{v:"yes",l:"Sì"},{v:"mostly",l:"Sì, con margine creativo"},{v:"no",l:"No"}]}/>
            </Field>

            <div className="divider" style={{margin:"26px 0 22px"}}/>

            <Field label="Disponibilità a partecipare a eventi" required error={err("availEvents")}>
              <ChipGroup name="ev" value={form.availEvents} onChange={v=>set("availEvents",v)} options={YESNO}/>
            </Field>
            <Field label="Disponibilità a partecipare a shooting" required error={err("availShooting")}>
              <ChipGroup name="sh" value={form.availShooting} onChange={v=>set("availShooting",v)} options={YESNO}/>
            </Field>
            <Field label="Disponibilità a creare contenuti utilizzabili anche sui canali EVORΛ" required error={err("availUgc")}>
              <ChipGroup name="ugc" value={form.availUgc} onChange={v=>set("availUgc",v)} options={YESNO}/>
            </Field>
            <Field label="Possibilità di fornire i file originali quando concordato" required error={err("availRawFiles")}>
              <ChipGroup name="raw" value={form.availRawFiles} onChange={v=>set("availRawFiles",v)} options={YESNO}/>
            </Field>

            <div className="divider" style={{margin:"26px 0 22px"}}/>
            <div className="label-xs" style={{marginBottom:16}}>Campi facoltativi</div>

            <Field label="Hai già acquistato prodotti EVORΛ?" htmlFor="f-bp">
              <input id="f-bp" value={form.boughtProducts} maxLength={LIMITS.short}
                onChange={e=>set("boughtProducts",e.target.value)} placeholder="Quali…"/>
            </Field>
            <Field label="C'è qualcosa che miglioreresti del brand?" htmlFor="f-imp">
              <CharField id="f-imp" value={form.improvements} onChange={v=>set("improvements",v)} max={LIMITS.medium} rows={3}
                placeholder="Feedback onesto…"/>
            </Field>
            <Field label="Vuoi aggiungere qualcosa?" htmlFor="f-ex">
              <CharField id="f-ex" value={form.extra} onChange={v=>set("extra",v)} max={LIMITS.medium} rows={3}
                placeholder="Nota finale…"/>
            </Field>
          </section>
        )}

        {/* ============ STEP 7 — RIEPILOGO ============ */}
        {step===6 && (
          <section style={{animation:"fadeUp .3s ease both"}}>
            <p className="body-sm" style={{marginBottom:20}}>
              Controlla i dati principali prima di inviare. Puoi tornare indietro per modificarli.
            </p>

            <div className="panel" style={{padding:18,marginBottom:10}}>
              <div className="label-xs" style={{marginBottom:12}}>Profilo</div>
              <div className="g2">
                {[
                  ["Nome",form.fullName],
                  ["Email",form.email],
                  ["Città",form.city+", "+form.country],
                  ["Categorie",(Array.isArray(form.profileCategories)&&form.profileCategories.length?form.profileCategories.map(catLabel).join(" · "):"—")+(form.profileCategories&&form.profileCategories.includes("altro")&&form.otherProfileCategory?" · "+form.otherProfileCategory:"")]
                ].map(([k,v])=>(
                  <div className="kv" key={k}><div className="kv-k">{k}</div><div className="kv-v">{v||"—"}</div></div>
                ))}
              </div>
            </div>

            <div className="panel" style={{padding:18,marginBottom:10}}>
              <div className="label-xs" style={{marginBottom:12}}>Social e Insights</div>
              <div className="g3-keep">
                {[["Instagram", parseSocial(form.instagram,"instagram").handle ? "@"+parseSocial(form.instagram,"instagram").handle : "—"],["Follower",fmtInt(form.followers)],["TikTok", parseSocial(form.tiktok,"tiktok").handle ? "@"+parseSocial(form.tiktok,"tiktok").handle : "—"]].map(([k,v])=>(
                  <div className="kv" key={k}><div className="kv-k">{k}</div><div className="kv-v">{v}</div></div>
                ))}
              </div>
              <div className="g2" style={{marginTop:2}}>
                {[["Visualizzazioni",fmtInt(form.views)],["Account raggiunti",fmtInt(form.accountsReached)],["Interazioni",fmtInt(form.interactions)],["Follower netti",(+form.netFollowers>0?"+":"")+fmtInt(form.netFollowers)]].map(([k,v])=>(
                  <div className="kv" key={k}><div className="kv-k">{k}</div><div className="kv-v">{v}</div></div>
                ))}
              </div>
              {form.screenshotData && (
                <div style={{marginTop:12,display:"flex",alignItems:"center",gap:10}}>
                  <div className="dot" style={{background:"var(--ok)"}}/>
                  <span className="body-sm">Screenshot allegato{form.screenshotName ? " · "+form.screenshotName : ""}</span>
                </div>
              )}
            </div>

            <div className="field" style={{marginTop:22}}>
              <label className="check" style={{borderColor: err("privacyConsent") ? "#B03A3A" : "var(--brd)"}}>
                <input type="checkbox" checked={form.privacyConsent} onChange={e=>set("privacyConsent",e.target.checked)}/>
                <span>
                  Acconsento al trattamento dei dati personali forniti ai fini della valutazione della candidatura
                  al programma {BRAND.program}. <span className="field-req">*</span>
                </span>
              </label>
              {err("privacyConsent") && <span className="field-err" role="alert">{err("privacyConsent")}</span>}
            </div>


          </section>
        )}

        {saveErr && <div className="status-box" role="alert" style={{borderColor:"#B03A3A",marginTop:12}}><div className="body-sm">{saveErr}</div></div>}

        {/* ============ NAVIGAZIONE ============ */}
        <div style={{display:"flex",gap:10,marginTop:34,paddingTop:22,borderTop:"1px solid var(--brd)"}}>
          <button className="btn btn-ghost" style={{flex:1}} onClick={prev} disabled={saving}>
            {step===0 ? "Annulla" : "Indietro"}
          </button>
          {step < STEPS.length-1 ? (
            <button className="btn btn-primary" style={{flex:2}} onClick={next}
              disabled={ocr1.state==="reading"||ocr1.state==="analyzing"||ocr2.state==="reading"||ocr2.state==="analyzing"}>
              {(ocr1.state==="analyzing"||ocr2.state==="analyzing") ? "Lettura in corso…" : "Avanti"}
            </button>
          ) : (
            <button className="btn btn-primary" style={{flex:2}} onClick={submit} disabled={saving}>
              {saving ? "Invio in corso…" : "Invia la candidatura"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* Dati di prova per il pulsante "Compila test" (visibile solo da area riservata) */
const TEST_FORM = {
  ...EMPTY_FORM,
  fullName:"Candidato Prova", age:"27", email:"prova@evora.test", city:"Milano", country:"Italia",
  isAdult:true, profileCategories:["coach","creator"], otherProfileCategory:"",
  instagram:"@profilo_prova", followers:"8500", tiktok:"@profilo_prova", tiktokFollowers:"3200",
  views:"24800", netFollowers:"260", interactions:"1120", accountsReached:"18400",
  contentUrl1:"https://www.instagram.com/",
  threeWords:"Concreto, costante, diretto",
  contentType:"Reels tecnici su allenamento e alimentazione, più contenuti dietro le quinte.",
  whatToTransmit:"Che i risultati arrivano dalla continuità, non dalle scorciatoie.",
  whyFollow:"Perché spiego le cose senza promesse irrealistiche e mostro anche gli errori.",
  hasBrandCollabs:"yes", brandCollabDetails:"Due collaborazioni continuative con brand di integratori nel 2025.",
  motivation:"Il posizionamento del brand coincide con il modo in cui comunico da anni: nessuna promessa facile, molta costanza.",
  brandLike:"La coerenza tra estetica e messaggio, e la qualità percepita dei prodotti.",
  contentIntegration:"Inserendolo nella routine reale: pre allenamento, trasferte, giornate tipo. Nessun contenuto costruito solo per il prodotto.",
  howWouldTell:"Partirei dal problema reale del mio pubblico e mostrerei il prodotto come parte della soluzione quotidiana.",
  valueBeyondContent:"Feedback tecnico sui prodotti, presenza in palestra e contatti con altri professionisti del settore.",
  athleteImage:"Una persona credibile, disciplinata, riconoscibile anche fuori dai social.",
  scenarioBrandContent:"Lo pubblicherei comunque, adattando il formato per renderlo più efficace senza tradire il messaggio del brand.",
  buildWithoutEarnings:"yes_conditions",
  badContentReaction:"Non lo interpreto come fallimento: verifico se il problema è il contenuto o la distribuzione.",
  analysisElements:"Retention nei primi secondi, copertura rispetto alla media, salvataggi e commenti.",
  brandMeaning:"Significa che ogni contenuto che pubblico riflette anche su chi rappresento.",
  contentPerMonth:"3-4", hasRoutine:"yes", followsGuidelines:"mostly",
  availEvents:"yes", availShooting:"yes", availUgc:"yes", availRawFiles:"maybe",
  boughtProducts:"Pre-workout e abbigliamento",
  improvements:"Più contenuti girati dai creator rispetto agli shooting in studio.",
  extra:"Disponibile per una call conoscitiva.",
  privacyConsent:true
};


/* ---------- fine di app/public-form.jsx ---------- */
CollectiveModules.add("app/public-form.jsx");
