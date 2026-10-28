/* Browser-only transport. No Firestore access, staff credentials or Telegram calls. */
(function (root) {
  'use strict';
  const PUBLIC_FIELDS = Object.freeze(["fullName","email","city","country","otherProfileCategory","instagram","tiktok","screenshotName","screenshotName2","threeWords","contentType","whatToTransmit","whyFollow","brandCollabDetails","motivation","brandLike","contentIntegration","athleteImage","valueBeyondContent","howWouldTell","scenarioBrandContent","badContentReaction","analysisElements","brandMeaning","boughtProducts","improvements","extra","hasBrandCollabs","buildWithoutEarnings","contentPerMonth","hasRoutine","followsGuidelines","availEvents","availShooting","availUgc","availRawFiles","followers","tiktokFollowers","views","netFollowers","interactions","accountsReached","contentUrl1","contentUrl2","contentUrl3","screenshotData","screenshotData2","profileScreenshotData","age","isAdult","privacyConsent","profileCategories","ocrInsights","ocrProfile"]);
  const NUMBERS = ['age','followers','tiktokFollowers','views','netFollowers','interactions','accountsReached'];
  const NULLS = ['ocrInsights','ocrProfile'];
  class SubmissionError extends Error {
    constructor(code, message, {field=null,status=null,retryAfter=null,ambiguous=false}={}) {
      super(message); this.name='SubmissionError';this.code=code;this.field=field;
      this.status=status;this.retryAfter=retryAfter;this.ambiguous=ambiguous;
    }
  }
  function numeric(value,key) {
    if (key==='tiktokFollowers' && (value==='' || value===undefined)) return 0;
    if (typeof value==='string') {
      if (!/^[+-]?\d+$/.test(value.trim())) throw new SubmissionError('INVALID_NUMBER',key==='age'?"Inserisci un'età intera compresa tra 18 e 99 anni.":'Inserisci un numero intero valido.',{field:key});
      value=Number(value.trim());
    }
    if (!Number.isSafeInteger(value) || value>(key==='age'?99:1e12) || value<(key==='netFollowers'?-1e12:key==='age'?18:0)) {
      throw new SubmissionError('INVALID_NUMBER',key==='age'?"Inserisci un'età intera compresa tra 18 e 99 anni.":'Controlla il valore numerico inserito.',{field:key});
    }
    return value;
  }
  function buildPayload(form) {
    const payload={};
    for (const key of PUBLIC_FIELDS) {
      let value=form[key];
      if (NUMBERS.includes(key)) value=numeric(value,key);
      else if (NULLS.includes(key)) value=value===undefined?null:value;
      else if (value===undefined || value===null) value='';
      payload[key]=value;
    }
    if (typeof payload.isAdult!=='boolean' || typeof payload.privacyConsent!=='boolean' || !Array.isArray(payload.profileCategories)) {
      throw new SubmissionError('INVALID_INPUT','Controlla i dati e i consensi inseriti.');
    }
    if (!payload.isAdult) throw new SubmissionError('CONSENT_REQUIRED','Devi confermare di aver compiuto 18 anni.',{field:'isAdult'});
    if (!payload.privacyConsent) throw new SubmissionError('CONSENT_REQUIRED','Devi accettare il trattamento dei dati per inviare la candidatura.',{field:'privacyConsent'});
    if (['screenshotData','screenshotData2','profileScreenshotData'].some(k=>typeof payload[k]!=='string')) throw new SubmissionError('INVALID_IMAGE','Ricarica gli screenshot.');
    if (payload.screenshotData.length+payload.screenshotData2.length+payload.profileScreenshotData.length>900000) throw new SubmissionError('IMAGE_TOO_LARGE','Gli screenshot sono troppo pesanti. Ricaricali.');
    // Serialization snapshots values; future edits to React state cannot change a retry.
    const json=JSON.stringify(payload);
    if (new TextEncoder().encode(json).byteLength>1048576) throw new SubmissionError('BODY_TOO_LARGE','La candidatura è troppo pesante. Riduci gli allegati.');
    return JSON.parse(json);
  }
  function responseError(status,data) {
    const details=data && typeof data.error==='object' && data.error!==null?data.error:data||{};
    const path=typeof details.path==='string'?details.path:typeof data?.path==='string'?data.path:'';
    const normalizedPath=path.startsWith('$.')?path.slice(2):path;
    const field=PUBLIC_FIELDS.find(k=>normalizedPath===k || normalizedPath.startsWith(`${k}.`) || normalizedPath.startsWith(`${k}[`))||null;
    const code=typeof details.code==='string'?details.code:`HTTP_${status}`;
    // Retry-After is not exposed by the Worker; never infer a retry schedule.
    const retryAfter=null;
    let message=status===409?'Non possiamo confermare questo invio. Non inviare una seconda candidatura: contatta il team.':
      status===429?'Troppi tentativi. Attendi prima di riprovare.':
      status===413?'La candidatura è troppo pesante. Riduci gli allegati.':
      status===400||status===422?'Controlla i dati inseriti e riprova.':
      status===401||status===403?'Invio non disponibile. Riprova più tardi o contatta il team.':
      'Il salvataggio non è confermato. Riprova senza modificare i dati.';
    return new SubmissionError(code,message,{field,status,retryAfter,ambiguous:status>=500||status===409});
  }
  async function tokenWithAbort(provider,signal) {
    let onAbort;
    try {
      const cancellation=new Promise((resolve,reject)=>{
        onAbort=()=>reject(new Error('Token acquisition aborted'));
        if(signal.aborted) onAbort(); else signal.addEventListener('abort',onAbort,{once:true});
      });
      return await Promise.race([Promise.resolve().then(()=>provider({signal})),cancellation]);
    } finally {signal.removeEventListener('abort',onAbort);}
  }
  function createSubmissionClient({endpoint,fetchImpl=root.fetch?.bind(root),newKey=()=>root.crypto.randomUUID(),timeoutMs=30000,getTurnstileToken=null}={}) {
    if (typeof endpoint!=='string' || !endpoint.endsWith('/applications')) throw new Error('Invalid applications endpoint');
    let pending=null,inFlight=null;
    function send(form,{testMode=false}={}) {
      // Must precede even payload preparation: test mode never reaches a network path.
      if (testMode) return Promise.resolve({simulated:true});
      let body;
      try { body=JSON.stringify(buildPayload(form)); }
      catch(error) { return Promise.reject(error); }
      if (pending && pending.body!==body && pending.editable) pending=null;
      if (pending && pending.body!==body) return Promise.reject(new SubmissionError('UNCONFIRMED_CHANGE',
        'Un invio precedente è ancora da confermare. Riprova senza modificare i dati, per evitare duplicati.'));
      if (inFlight) return inFlight;
      if (!pending) {
        let key;try {key=newKey();} catch {return Promise.reject(new SubmissionError('KEY_UNAVAILABLE','Impossibile preparare l’invio. Ricarica la pagina prima di inviare.'));}
        if (typeof key!=='string'||!/^[A-Za-z0-9-]{16,64}$/.test(key)) return Promise.reject(new SubmissionError('KEY_UNAVAILABLE','Impossibile preparare l’invio.'));
        pending={body,key};
      }
      const attempt=pending;
      inFlight=(async()=>{
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),timeoutMs);
        try {
          const headers={'Content-Type':'application/json','Idempotency-Key':attempt.key};
          if (getTurnstileToken) {
            const token=await tokenWithAbort(getTurnstileToken,controller.signal);
            if (typeof token!=='string'||!token) throw new SubmissionError('TURNSTILE_REQUIRED','Completa nuovamente la verifica di sicurezza e riprova.');
            headers['X-Turnstile-Token']=token;
          }
          const response=await fetchImpl(endpoint,{method:'POST',headers,
            body:attempt.body,credentials:'omit',signal:controller.signal,redirect:'error'});
          let data;try {data=await response.json();} catch {data=null;}
          if (!response.ok) {
            const error=responseError(response.status,data);
            // Only definitive validation/access rejections permit a corrected new payload/key.
            // 429 too: the Worker rate limiter answers before reading the body, so nothing was stored.
            // An unchanged resend keeps the same key; no automatic retry is scheduled.
            if ([400,401,403,405,413,415,422,429].includes(response.status)) pending.editable=true;
            throw error;
          }
          // Confirm the supplied /applications contract, including replay semantics.
          if (!data||data.ok!==true||typeof data.id!=='string'||!data.id||
              !(response.status===201 || (response.status===200 && data.duplicate===true))) throw new SubmissionError('UNCONFIRMED_RESPONSE',
            'Il salvataggio non è confermato. Riprova senza modificare i dati.',{ambiguous:true});
          pending=null;
          return {simulated:false,id:data.id,duplicate:response.status===200};
        } catch(error) {
          if (error instanceof SubmissionError) throw error;
          throw new SubmissionError(controller.signal.aborted?'TIMEOUT':'NETWORK',
            'Il salvataggio non è confermato. Controlla la connessione e riprova senza modificare i dati.',{ambiguous:true});
        } finally {clearTimeout(timer);inFlight=null;}
      })();
      return inFlight;
    }
    return Object.freeze({send});
  }
  root.CollectiveApplications=Object.freeze({PUBLIC_FIELDS,buildPayload,createSubmissionClient,SubmissionError});
})(globalThis);
