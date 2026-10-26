// Formulas/legacy normalization ported from index.html:695–814 (479213a).
// No change to ER/reach/growth, interpolation, weighting, rounding or legacy metric fallbacks.
import {exact, text, number, array, record, freeze, fail} from './validation.mjs';

export const SCORING_VERSION = 2;   // incrementare quando cambiano formule o benchmark predefiniti

export const DEFAULT_SCORING = freeze({
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
    { label:"100K+",    max:null,
      er:{avg:1,good:2,excellent:4},     reach:{avg:15,good:30,excellent:60},   growth:{avg:0.08,good:0.25,excellent:0.8} }
  ]
});

// Normalizza config salvate con lo schema precedente (tiers ELITE/PRO/...).
const normalizeLegacyScoring = (cfg) => {
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
const computeWithConfig = (data, cfgRaw) => {
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


// Strict validation of the stored v2 config, not an authorization check.
export function validateScoringConfig(input) {
  exact(input, ['version','weights','levels','bands'], '$scoring');
  if (input.version !== SCORING_VERSION) fail('VERSION', '$scoring.version');
  exact(input.weights, ['er','reach','growth'], '$scoring.weights');
  for (const key of ['er','reach','growth']) number(input.weights[key], 0, 100, `$scoring.weights.${key}`);
  if (input.weights.er + input.weights.reach + input.weights.growth <= 0) fail('RANGE', '$scoring.weights');
  array(input.levels,4,4,'$scoring.levels');
  input.levels.forEach((level,i) => {
    const path = `$scoring.levels[${i}]`;
    exact(level, ['v','l','min','c'], path);
    if (level.v !== ['HIGH','GOOD','AVERAGE','LOW'][i]) fail('ENUM', `${path}.v`);
    text(level.l, 120, `${path}.l`, true);
    number(level.min, 0, 100, `${path}.min`, true);
    text(level.c, 7, `${path}.c`);
    if (!/^#[A-Fa-f0-9]{6}$/.test(level.c)) fail('FORMAT', `${path}.c`);
    if (i > 0 && input.levels[i-1].min <= level.min) fail('ORDER', `${path}.min`);
  });
  if (input.levels[3].min !== 0) fail('RANGE', '$scoring.levels[3].min');
  array(input.bands,5,5,'$scoring.bands');
  input.bands.forEach((band,i) => {
    const path = `$scoring.bands[${i}]`;
    exact(band, ['label','max','er','reach','growth'], path);
    text(band.label, 120, `${path}.label`, true);
    if (i === 4) { if (band.max !== null) fail('RANGE', `${path}.max`); }
    else {
      number(band.max, 1, 1e12, `${path}.max`, true);
      if (i > 0 && input.bands[i-1].max >= band.max) fail('ORDER', `${path}.max`);
    }
    for (const key of ['er','reach','growth']) {
      const metricPath = `${path}.${key}`;
      exact(band[key], ['avg','good','excellent'], metricPath);
      for (const threshold of ['avg','good','excellent']) number(band[key][threshold], 0, 1e14, `${metricPath}.${threshold}`);
      if (!(0 < band[key].avg && band[key].avg < band[key].good && band[key].good < band[key].excellent)) fail('ORDER', metricPath);
    }
  });
  return structuredClone(input);
}

// Trusted stored configs only. Match existing legacy/partial-v2 migration, then
// validate the effective config before any calculation. Invalid v2 fails closed.
export function resolveScoringConfig(stored) {
  if (stored == null) return validateScoringConfig(DEFAULT_SCORING);
  if (typeof stored !== 'object') fail('TYPE','$scoring');
  record(stored,Object.keys(stored),[],'$scoring');
  if (stored.version !== SCORING_VERSION) return validateScoringConfig(DEFAULT_SCORING);
  // Check the complete original object first for unknown keys and non-JSON values;
  // do not let legacy JSON cloning hide NaN/Infinity, accessors or unexpected data.
  assertStoredConfig(stored);
  const normalized = normalizeLegacyScoring(stored);
  normalized.bands = normalized.bands.map(band => ({...band, max:band.max === Infinity ? null : band.max}));
  return validateScoringConfig(normalized);
}
function assertStoredConfig(stored) {
  record(stored,['version','weights','levels','bands','tiers'],['version'],'$scoring');
  const active=new Set();let nodes=0;
  const visit=(value,path,depth=0)=>{
    if (++nodes > 256 || depth > 8) fail('LENGTH',path);
    if (typeof value === 'number') { if (!Number.isFinite(value)) fail('TYPE',path); return; }
    if (typeof value === 'string') { text(value,200,path);return; }
    if (value === null || typeof value === 'boolean') return;
    if (!value || typeof value !== 'object' || active.has(value)) fail('TYPE',path);
    active.add(value);
    if (Array.isArray(value)) array(value,0,5,path);
    else { record(value,Object.keys(value),[],path);if (Object.keys(value).length>8) fail('LENGTH',path); }
    for (const [key,item] of Object.entries(value)) {
      if (['__proto__','constructor','prototype'].includes(key)) fail('UNKNOWN_FIELD',path);
      visit(item,`${path}.${key}`,depth+1);
    }
    active.delete(value);
  };
  visit(stored,'$scoring');
  if (Object.hasOwn(stored,'weights')) record(stored.weights,['er','reach','growth'],[],'$scoring.weights');
  if (Object.hasOwn(stored,'bands')) {
    array(stored.bands,0,5,'$scoring.bands');
    stored.bands.forEach((band,i)=>{
      const path=`$scoring.bands[${i}]`;
      record(band,['label','max','er','reach','growth'],[],path);
      if (Object.hasOwn(band,'label')) text(band.label,120,`${path}.label`);
      if (Object.hasOwn(band,'max') && band.max!==null) number(band.max,1,1e12,`${path}.max`,true);
      for (const metric of ['er','reach','growth']) if (Object.hasOwn(band,metric)) record(band[metric],['avg','good','excellent'],[],`${path}.${metric}`);
    });
  }
  if (Object.hasOwn(stored,'levels')) array(stored.levels,0,4,'$scoring.levels');
  if (Object.hasOwn(stored,'tiers')) array(stored.tiers,0,5,'$scoring.tiers');
}

export function computeSocial(data, storedConfig = null) {
  return computeWithConfig(data, resolveScoringConfig(storedConfig));
}
