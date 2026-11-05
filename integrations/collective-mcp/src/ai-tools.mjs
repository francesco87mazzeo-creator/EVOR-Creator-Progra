// propose_ai_evaluation / save_ai_evaluation. Two steps: the proposal never writes; saving requires the
// signed proposal, the identical content and an explicit confirmation flag, and writes only the AI fields.
import {validateEvaluation,EvaluationError,RUBRICS} from '../../../server/collective/mcp-ai-policy.mjs';
import {DataError} from './reader.mjs';

const content=input=>{
 try{return validateEvaluation({score:input.score,summary:input.summary,rubricVersion:input.rubricVersion,...(input.criteria!==undefined?{criteria:input.criteria}:{})});}
 catch(error){if(error instanceof EvaluationError)throw new DataError(error.code);throw error;}
};
export function createAiTools({ai,proposals,principal}){
 return {
  async propose_ai_evaluation(input){
   const proposal=content(input);
   const state=await ai.state(input.applicationId);
   if(!state?.exists)throw new DataError('APPLICATION_NOT_FOUND');
   if(typeof state.version!=='string')throw new DataError('AI_UNAVAILABLE');
   const issued=await proposals.issue({uid:principal.uid,applicationId:input.applicationId,content:proposal,basedOnVersion:state.version});
   const rubric=RUBRICS[proposal.rubricVersion];
   return {
    status:'proposta_pronta_non_salvata',
    applicationId:input.applicationId,
    candidate:{fullName:state.fullName,instagramHandle:state.instagramHandle},
    proposal,
    rubric:{version:proposal.rubricVersion,label:rubric.label,test:rubric.test===true},
    existingEvaluation:state.current?{...state.current,willMoveToHistory:true}:null,
    historyCount:state.historyCount,
    proposalToken:issued.token,expiresAt:issued.expiresAt,
    nextStep:"Mostra all'utente candidatura, punteggio e motivazione e chiedi una conferma esplicita per QUESTO salvataggio. Solo dopo un sì esplicito chiama save_ai_evaluation con gli stessi identici valori, il proposalToken e confirmed:true. Non salvare mai di tua iniziativa.",
    notice:'Valutazione AI non vincolante: non modifica stato, scoring, questionario, metriche o valutazioni dello staff.'
   };
  },
  async save_ai_evaluation(input){
   if(input.confirmed!==true)throw new DataError('CONFIRMATION_REQUIRED');
   const evaluation=content(input);
   const claims=await proposals.verify(input.proposalToken,{uid:principal.uid,applicationId:input.applicationId,content:evaluation});
   const result=await ai.save({id:input.applicationId,evaluation,basedOnVersion:claims.base,proposalId:claims.n});
   if(result?.status==='saved')return {saved:true,duplicate:false,applicationId:input.applicationId,evaluatedAt:result.evaluatedAt,historyCount:result.historyCount,
    savedFields:['aiEvaluation',...(result.historyCount?['aiEvaluationHistory']:[])]};
   if(result?.status==='already_saved')return {saved:true,duplicate:true,applicationId:input.applicationId,evaluatedAt:result.evaluatedAt,
    message:'Questa proposta era già stata salvata: nessuna nuova scrittura.'};
   if(result?.status==='conflict')throw new DataError('APPLICATION_CHANGED_SINCE_PROPOSAL');
   if(result?.status==='not_found')throw new DataError('APPLICATION_NOT_FOUND');
   if(result?.status==='denied')throw new DataError('WRITE_DENIED');
   throw new DataError('AI_UNAVAILABLE');
  }
 };
}
