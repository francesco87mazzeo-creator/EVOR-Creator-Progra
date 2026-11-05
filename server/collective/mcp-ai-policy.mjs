// AI evaluation saved from ChatGPT: strict shape shared by the MCP server and the private write facade.
// Only `aiEvaluation` and `aiEvaluationHistory` are ever written; Firestore Rules enforce the same limit.
export const AI_FIELDS=Object.freeze(['aiEvaluation','aiEvaluationHistory']);
/** Rubric versions accepted for saving. `rubric-test-0` is a provisional TEST rubric, staging only. */
export const RUBRICS=Object.freeze({'rubric-test-0':Object.freeze({test:true,label:'Criteri provvisori di TEST, non approvati'})});
export const MAX_HISTORY=20;
export const MAX_CRITERIA=12;
export const PROPOSAL_TTL_MS=10*60_000;
/** Fields the facade reads to prepare or save a proposal: identity for the confirmation text, AI fields for history. */
export const AI_STATE_FIELDS=Object.freeze(['fullName','instagramHandle',...AI_FIELDS]);

export class EvaluationError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new EvaluationError(code);};
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
 const keys=Object.keys(input).sort().join('|');
 if(!['rubricVersion|score|summary','criteria|rubricVersion|score|summary'].includes(keys))fail('INVALID_EVALUATION');
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
 return Object.freeze({score:input.score,summary,rubricVersion:input.rubricVersion,...(criteria?{criteria}:{})});
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
