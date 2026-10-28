/* Staff scoring transport only. Never stores/logs ID tokens or writes Firestore. */
(function(root){
  'use strict';
  class ScoringSaveError extends Error {
    constructor(code,message,status=null){super(message);this.name='ScoringSaveError';this.code=code;this.status=status;}
  }
  async function saveScoring({endpoint,auth,config,fetchImpl=root.fetch?.bind(root),timeoutMs=30000}){
    if(typeof endpoint!=='string'||!endpoint.endsWith('/admin/scoring'))throw new Error('Invalid admin scoring endpoint');
    let body;
    try{body=JSON.stringify(config);}catch{throw new ScoringSaveError('INVALID_CONFIG','Configurazione non valida. Controlla pesi, riferimenti e soglie.');}
    const user=auth?.currentUser;
    if(!user||typeof user.getIdToken!=='function')throw new ScoringSaveError('LOGIN_REQUIRED','Sessione non disponibile. Accedi nuovamente all’area riservata.');
    let token;
    try{token=await user.getIdToken();}catch(error){
      if(error?.code==='auth/network-request-failed')throw new ScoringSaveError('NETWORK','Impossibile verificare la sessione. Controlla la connessione e riprova.');
      throw new ScoringSaveError('LOGIN_REQUIRED','Sessione scaduta o non disponibile. Accedi nuovamente all’area riservata.');
    }
    if(typeof token!=='string'||!token||auth.currentUser!==user)throw new ScoringSaveError('LOGIN_REQUIRED','Sessione non disponibile. Accedi nuovamente all’area riservata.');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
        body,credentials:'omit',redirect:'error',signal:controller.signal});
      // The contract defines success via HTTP; no undocumented JSON shape is required.
      if(response.ok)return;
      if(response.status===400)throw new ScoringSaveError('INVALID_CONFIG','Configurazione non valida. Controlla pesi, riferimenti e soglie.',400);
      if(response.status===401)throw new ScoringSaveError('LOGIN_REQUIRED','Sessione scaduta. Accedi nuovamente all’area riservata.',401);
      if(response.status===403)throw new ScoringSaveError('FORBIDDEN','Non sei autorizzato a modificare lo scoring. È richiesto il ruolo admin.',403);
      throw new ScoringSaveError('SERVICE_ERROR','Salvataggio non confermato. Riprova più tardi.',response.status);
    }catch(error){
      if(error instanceof ScoringSaveError)throw error;
      throw new ScoringSaveError(controller.signal.aborted?'TIMEOUT':'NETWORK','Salvataggio non confermato. Controlla la connessione e riprova.');
    }finally{clearTimeout(timer);}
  }
  root.CollectiveAdminScoring=Object.freeze({saveScoring,ScoringSaveError});
})(globalThis);
