// AI evaluation saved from ChatGPT: strict shape shared by the MCP server and the private write facade.
// Only `aiEvaluation` and `aiEvaluationHistory` are ever written; Firestore Rules enforce the same limit.
export const AI_FIELDS=Object.freeze(['aiEvaluation','aiEvaluationHistory']);
export const MAX_HISTORY=20;
export const MAX_CRITERIA=12;
export const PROPOSAL_TTL_MS=10*60_000;
/** Fields the facade reads to prepare or save a proposal: identity for the confirmation text, AI fields for history. */
export const AI_STATE_FIELDS=Object.freeze(['fullName','instagramHandle',...AI_FIELDS]);

const area=(name,sources,guidance)=>Object.freeze({name,sources:Object.freeze(sources),guidance});
/** Common 0-100 scale: qualitative bands for comparability. The score is the evaluator's overall judgement. */
export const SCORE_BANDS=Object.freeze([
 Object.freeze({min:90,label:'Eccezionale',description:'Profilo pienamente allineato a EVORΛ, con evidenze solide e coerenti in quasi tutte le aree.'}),
 Object.freeze({min:75,label:'Molto buono',description:'Candidatura forte, con pochi limiti circoscritti e un chiaro potenziale di collaborazione.'}),
 Object.freeze({min:60,label:'Buono con riserve',description:'Basi positive, ma con criticità o lacune che vanno approfondite prima di decidere.'}),
 Object.freeze({min:40,label:'Incerto',description:'Elementi contrastanti o insufficienti: la valutazione richiede altre informazioni.'}),
 Object.freeze({min:20,label:'Debole',description:'Allineamento o affidabilità limitati in più aree rilevanti.'}),
 Object.freeze({min:0,label:'Non idoneo',description:'Profilo non compatibile con EVORΛ allo stato attuale.'})
]);
export const bandFor=score=>Number.isInteger(score)?SCORE_BANDS.find(b=>score>=b.min)??null:null;
/** Six areas of rubric-v1, in this order. No fixed weights: their importance is judged and explained case by case. */
export const RUBRIC_V1_AREAS=Object.freeze([
 area('Allineamento con EVORΛ',['motivation','brandLike','brandMeaning','athleteImage','contentIntegration'],
  'Coerenza di valori, linguaggio e motivazioni con EVORΛ; risposte specifiche e argomentate contano più di frasi generiche.'),
 area('Audience e performance Instagram',['followers','views','interactions','accountsReached','netFollowers'],
  'Dimensione, coinvolgimento e crescita dei dati dichiarati, considerando la loro provenienza; dati mancanti o base ridotta limitano il giudizio.'),
 area('Qualità della comunicazione',['threeWords','contentType','whatToTransmit','whyFollow','howWouldTell'],
  'Chiarezza, identità e originalità di ciò che il candidato comunica e di come racconterebbe il brand. Senza contenuti esaminati, è un giudizio sulle risposte, non sui contenuti.'),
 area('Mentalità professionale',['scenarioBrandContent','badContentReaction','analysisElements','buildWithoutEarnings','followsGuidelines'],
  'Approccio ai risultati, apertura a linee guida e periodo di prova, capacità di analisi.'),
 area('Affidabilità e capacità produttiva',['contentPerMonth','hasRoutine','availEvents','availShooting','availUgc','availRawFiles'],
  'Costanza dichiarata, volume realistico di contenuti e disponibilità operative.'),
 area('Valore aggiunto e potenziale',['valueBeyondContent','hasBrandCollabs','brandCollabDetails','profileCategories','boughtProducts','improvements','extra'],
  'Contributi oltre la pubblicazione, esperienza con brand, possibili ruoli e crescita della collaborazione.')
]);
/**
 * Rubrics. Only `active` ones accept NEW evaluations; TEST rubrics stay listed so saved evaluations remain readable,
 * and are never converted.
 */
export const RUBRICS=Object.freeze({
 'rubric-v1':Object.freeze({active:true,test:false,label:'Rubrica AI v1',areas:RUBRIC_V1_AREAS,
  required:Object.freeze(['criteria','strengths','concerns','potential','roles','limitations'])}),
 'rubric-test-0':Object.freeze({active:false,test:true,label:'Criteri provvisori di TEST (storico)'}),
 'rubric-test-1':Object.freeze({active:false,test:true,label:'Proposta di criteri a pesi fissi (TEST, storico)'})
});
export const ACTIVE_RUBRICS=Object.freeze(Object.keys(RUBRICS).filter(k=>RUBRICS[k].active));

export class EvaluationError extends Error{constructor(code){super(code);this.code=code;}}
function fail(code){throw new EvaluationError(code);}
// No control characters except newlines and tabs; bounded and trimmed.
const cleanText=(value,min,max,code)=>{
 if(typeof value!=='string')fail(code);
 const text=value.replace(/\r\n?/g,'\n').trim();
 if(text.length<min||text.length>max||/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text))fail(code);
 return text;
};
const listOf=(value,maxItems,min,max,code)=>{
 if(!Array.isArray(value)||value.length>maxItems)fail(code);
 return value.map(item=>cleanText(item,min,max,code));
};
const OPTIONAL_LISTS={strengths:['INVALID_STRENGTHS',8,3,300],concerns:['INVALID_CONCERNS',8,3,300],limitations:['INVALID_LIMITATIONS',8,3,300],roles:['INVALID_ROLES',6,3,120]};
/** Canonical content of a NEW evaluation: active rubric only; anything outside this shape is rejected, never dropped. */
export function validateEvaluation(input,{rubrics=RUBRICS}={}){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_EVALUATION');
 const allowed=['score','summary','rubricVersion','criteria','strengths','concerns','potential','roles','limitations'];
 if(Object.keys(input).some(k=>!allowed.includes(k))||!['score','summary','rubricVersion'].every(k=>Object.hasOwn(input,k)))fail('INVALID_EVALUATION');
 if(!Number.isInteger(input.score)||input.score<0||input.score>100)fail('INVALID_SCORE');
 const summary=cleanText(input.summary,20,4000,'INVALID_SUMMARY');
 if(typeof input.rubricVersion!=='string'||!Object.hasOwn(rubrics,input.rubricVersion))fail('UNKNOWN_RUBRIC');
 const rubric=rubrics[input.rubricVersion];
 if(!rubric.active)fail('RUBRIC_NOT_ACTIVE');
 let criteria;
 if(input.criteria!==undefined){
  if(!Array.isArray(input.criteria)||input.criteria.length>MAX_CRITERIA)fail('INVALID_CRITERIA');
  criteria=input.criteria.map(c=>{
   if(!c||typeof c!=='object'||Array.isArray(c))fail('INVALID_CRITERIA');
   const k=Object.keys(c).sort().join('|');if(!['name|score','name|note|score'].includes(k))fail('INVALID_CRITERIA');
   if(!Number.isInteger(c.score)||c.score<0||c.score>100)fail('INVALID_CRITERIA');
   return {name:cleanText(c.name,1,80,'INVALID_CRITERIA'),score:c.score,...(c.note!==undefined?{note:cleanText(c.note,1,600,'INVALID_CRITERIA')}:{})};
  });
  if(new Set(criteria.map(c=>c.name.toLowerCase())).size!==criteria.length)fail('INVALID_CRITERIA');
 }
 const extra={};
 for(const [key,[code,maxItems,min,max]] of Object.entries(OPTIONAL_LISTS))if(input[key]!==undefined)extra[key]=listOf(input[key],maxItems,min,max,code);
 if(input.potential!==undefined)extra.potential=cleanText(input.potential,10,1000,'INVALID_POTENTIAL');
 if(rubric.areas){
  // Every area, in order, each with a motivated analysis. No fixed weights: the overall score is not recomputed.
  if(!criteria||criteria.length!==rubric.areas.length||criteria.some((c,i)=>c.name!==rubric.areas[i].name))fail('CRITERIA_NOT_MATCHING_RUBRIC');
  if(criteria.some(c=>!c.note||c.note.length<20))fail('AREA_ANALYSIS_REQUIRED');
 }
 if((rubric.required||[]).some(k=>k!=='criteria'&&extra[k]===undefined))fail('STRUCTURED_FIELDS_REQUIRED');
 return Object.freeze({score:input.score,summary,rubricVersion:input.rubricVersion,...(criteria?{criteria}:{}),...extra});
}
/** Stable serialization used for the proposal fingerprint (key order independent). */
export function canonicalJson(value){
 return JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v);
}
/** History rule mirrored by Firestore Rules: previous evaluation appended, oldest dropped at the cap. */
export function nextHistory(previous,history){
 const before=Array.isArray(history)?history:[];
 if(!previous)return before;
 const first=canonicalJson(before[0]);
 const kept=before.length<MAX_HISTORY?before:before.filter(item=>canonicalJson(item)!==first);
 return [...kept,previous];
}
