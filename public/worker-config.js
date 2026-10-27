/* Production configuration only. Localhost deliberately fails closed: retired staging must never fall back to production. */
(function(root){
  'use strict';
  const productionWorker='https://throbbing-feather-957f.francesco87-mazzeo.workers.dev';
  const productionFirebase = {
  apiKey: "AIzaSyABauyOisUza0ojws0Vp_aDmmP8oNNSeZU",
  authDomain: "evora-athletes.firebaseapp.com",
  projectId: "evora-athletes",
  storageBucket: "evora-athletes.firebasestorage.app",
  messagingSenderId: "520957090168",
  appId: "1:520957090168:web:a19e2f727ae69adf9c108d"
};
  function resolve(location){
    if(root.EVORA_TEST_WORKER_BASE!==undefined)throw new Error('Worker overrides are disabled.');
    if(!location||!['http:','https:'].includes(location.protocol))throw new Error('Serve the frontend over HTTPS.');
    if(['localhost','127.0.0.1','[::1]'].includes(location.hostname))throw new Error('Local live services disabled: staging was retired. Use isolated mocks for tests.');
    if(location.protocol!=='https:')throw new Error('Production requires HTTPS.');
    const firebase=productionFirebase;
    const keys=['apiKey','authDomain','projectId','storageBucket','messagingSenderId','appId'];
    if(keys.some(k=>typeof firebase[k]!=='string'||!firebase[k].trim())||
       firebase.projectId!=='evora-athletes'||firebase.authDomain!=='evora-athletes.firebaseapp.com'||
       firebase.storageBucket!=='evora-athletes.firebasestorage.app'||
       !/^AIza[\w-]{35}$/.test(firebase.apiKey)||!/^\d+$/.test(firebase.messagingSenderId)||
       !firebase.appId.startsWith('1:'+firebase.messagingSenderId+':web:')||
       !/^1:\d+:web:[a-f0-9]+$/.test(firebase.appId))
      throw new Error('Invalid production configuration. Operations blocked.');
    return Object.freeze({name:'production',workerBase:productionWorker,firebase:Object.freeze({...firebase})});
  }
  const current=resolve(root.location);
  root.CollectiveEnvironment=Object.freeze({resolve,current});
})(globalThis);
