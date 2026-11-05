// AI evaluation saved from ChatGPT: strict shape shared by the MCP server and the private write facade.
// Only `aiEvaluation` and `aiEvaluationHistory` are ever written; Firestore Rules enforce the same limit.
export const AI_FIELDS=Object.freeze(['aiEvaluation','aiEvaluationHistory']);
const criterion=(name,weight,sources,guidance)=>Object.freeze({name,weight,sources:Object.freeze(sources),guidance});
/** Rubric versions accepted for saving. Both are TEST rubrics, staging only, not approved. */
export const RUBRICS=Object.freeze({
 'rubric-test-0':Object.freeze({test:true,label:'Criteri provvisori di TEST, non approvati'}),
 // PROPOSAL to be approved: six weighted criteria, overall score = weighted mean of the criteria (rounded).
 'rubric-test-1':Object.freeze({test:true,label:'Proposta di criteri AI (TEST, da approvare)',structured:true,criteria:Object.freeze([
  criterion('Allineamento con EVORΛ',25,['motivation','brandLike','brandMeaning','athleteImage','contentIntegration'],
   'Quanto valori, linguaggio e motivazioni dichiarate sono coerenti con EVORΛ; risposte specifiche e argomentate valgono più di frasi generiche.'),
  criterion('Audience e performance Instagram',20,['followers','views','interactions','accountsReached','netFollowers'],
   'Dimensione, coinvolgimento (interazioni rispetto a visualizzazioni) e crescita dei dati dichiarati; base ridotta e dati mancanti limitano il giudizio, non lo azzerano.'),
  criterion('Qualità della comunicazione',15,['threeWords','contentType','whatToTransmit','whyFollow','howWouldTell'],
   'Chiarezza, identità e originalità di ciò che il candidato comunica e del modo in cui racconterebbe il brand.'),
  criterion('Mentalità professionale',15,['scenarioBrandContent','badContentReaction','analysisElements','buildWithoutEarnings','followsGuidelines'],
   'Approccio ai risultati, apertura a linee guida e periodo di prova, capacità di analisi.'),
  criterion('Affidabilità e capacità produttiva',15,['contentPerMonth','hasRoutine','availEvents','availShooting','availUgc','availRawFiles'],
   'Costanza dichiarata, volume realistico di contenuti e disponibilità operative.'),
  criterion('Valore aggiunto e potenziale',10,['valueBeyondContent','hasBrandCollabs','brandCollabDetails','profileCategories','boughtProducts','improvements','extra'],
   'Contributi oltre la pubblicazione, esperienza con brand, potenziale di crescita della collaborazione.')
 ])})
});
const listOf=(value,maxItems,min,max,code)=>{
 if(!Array.isArray(value)||value.length>maxItems)fail(code);
 return value.map(item=>cleanText(item,min,max,code));
};
export const MAX_HISTORY=20;
export const MAX_CRITERIA=12;
export const PROPOSAL_TTL_MS=10*60_000;
/** Fields the facade reads to prepare or save a proposal: identity for the confirmation text, AI fields for history. */
export const AI_STATE_FIELDS=Object.freeze(['fullName','instagramHandle',...AI_FIELDS]);

export class EvaluationError extends Error{constructor(code){super(code);this.code=code;}}
function fail(code){throw new EvaluationError(code);}
// No control characters except newlines and tabs; bounded and trimmed.
const cleanText=(value,min,max,code)=>{
 if(typeof value!=='string')fail(code);
 const text=value.replace(/\r\n?/g,'\n').trim();
 if(text.length<min||text.length>max||/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text))fail(code);
 return text;
};
/** Canonical evaluation content; anything outside this shape is rejected, never silently dropped. */
export function validateEvaluation(input,{rubrics=RUBRICS}={}){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_EVALUATION');
 const allowed=['score','summary','rubricVersion','criteria','strengths','concerns','potential','limitations'];
 if(Object.keys(input).some(k=>!allowed.includes(k))||!['score','summary','rubricVersion'].every(k=>Object.hasOwn(input,k)))fail('INVALID_EVALUATION');
 if(!Number.isInteger(input.score)||input.score<0||input.score>100)fail('INVALID_SCORE');
 const summary=cleanText(input.summary,20,4000,'INVALID_SUMMARY');
 if(typeof input.rubricVersion!=='string'||!Object.hasOwn(rubrics,input.rubricVersion))fail('UNKNOWN_RUBRIC');
 let criteria;
 if(input.criteria!==undefined){
  if(!Array.isArray(input.criteria)||input.criteria.length>MAX_CRITERIA)fail('INVALID_CRITERIA');
  criteria=input.criteria.map(c=>{
   if(!c||typeof c!=='object'||Array.isArray(c))fail('INVALID_CRITERIA');
   const k=Object.keys(c).sort().join('|');if(!['name|score','name|note|score'].includes(k))fail('INVALID_CRITERIA');
   if(!Number.isInteger(c.score)||c.score<0||c.score>100)fail('INVALID_CRITERIA');
   return {name:cleanText(c.name,1,80,'INVALID_CRITERIA'),score:c.score,...(c.note!==undefined?{note:cleanText(c.note,1,300,'INVALID_CRITERIA')}:{})};
  });
  if(new Set(criteria.map(c=>c.name.toLowerCase())).size!==criteria.length)fail('INVALID_CRITERIA');
 }
 const rubric=rubrics[input.rubricVersion];
 const extra={};
 if(input.strengths!==undefined)extra.strengths=listOf(input.strengths,8,3,300,'INVALID_STRENGTHS');
 if(input.concerns!==undefined)extra.concerns=listOf(input.concerns,8,3,300,'INVALID_CONCERNS');
 if(input.limitations!==undefined)extra.limitations=listOf(input.limitations,8,3,300,'INVALID_LIMITATIONS');
 if(input.potential!==undefined)extra.potential=cleanText(input.potential,10,1000,'INVALID_POTENTIAL');
 if(rubric.structured){
  // Structured rubric: every criterion, in order, and the overall score equal to their weighted mean.
  if(!criteria||criteria.length!==rubric.criteria.length||criteria.some((c,i)=>c.name!==rubric.criteria[i].name))fail('CRITERIA_NOT_MATCHING_RUBRIC');
  if(['strengths','concerns','potential','limitations'].some(k=>extra[k]===undefined))fail('STRUCTURED_FIELDS_REQUIRED');
  const weighted=Math.round(criteria.reduce((sum,c,i)=>sum+c.score*rubric.criteria[i].weight,0)/100);
  if(weighted!==input.score)fail('SCORE_NOT_WEIGHTED_MEAN');
 }
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
