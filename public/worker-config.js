/* Atomic environment selection: loopback uses staging; public defaults are unchanged. */
(function(root){
  'use strict';
  const productionWorker='https://throbbing-feather-957f.francesco87-mazzeo.workers.dev';
  const stagingWorker='https://evora-collective-staging.francesco87-mazzeo.workers.dev';
  const productionFirebase = {
  apiKey: "AIzaSyABauyOisUza0ojws0Vp_aDmmP8oNNSeZU",
  authDomain: "evora-athletes.firebaseapp.com",
  projectId: "evora-athletes",
  storageBucket: "evora-athletes.firebasestorage.app",
  messagingSenderId: "520957090168",
  appId: "1:520957090168:web:a19e2f727ae69adf9c108d"
};
  const stagingFirebase = {
    apiKey:'AIzaSyCLo1_iE5WlZJ0-GyGqNVtXNCiCGqgD_ls',
    authDomain:'evora-collective-staging.firebaseapp.com',
    projectId:'evora-collective-staging',
    storageBucket:'evora-collective-staging.firebasestorage.app',
    messagingSenderId:'984522935462',
    appId:'1:984522935462:web:94a7a90f36496ad1923867'
  };
  function resolve(location){
    // Reject the old Worker-only switch, including on public pages.
    if(root.EVORA_TEST_WORKER_BASE!==undefined)throw new Error('Worker-only overrides are disabled. Use localhost staging.');
    if(!location||!['http:','https:'].includes(location.protocol))throw new Error('Serve the frontend over HTTP on localhost.');
    const local=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
    const firebase=local?stagingFirebase:productionFirebase;
    const worker=local?stagingWorker:productionWorker;
    const project=local?'evora-collective-staging':'evora-athletes';
    const keys=['apiKey','authDomain','projectId','storageBucket','messagingSenderId','appId'];
    if(keys.some(k=>typeof firebase[k]!=='string'||!firebase[k].trim())||
       firebase.projectId!==project||firebase.authDomain!==project+'.firebaseapp.com'||
       firebase.storageBucket!==project+'.firebasestorage.app'||
       (local&&(firebase.apiKey!=="AIzaSyCLo1_iE5WlZJ0-GyGqNVtXNCiCGqgD_ls"||
         firebase.messagingSenderId!=='984522935462'||firebase.appId!=='1:984522935462:web:94a7a90f36496ad1923867'))||
       !/^AIza[\w-]{35}$/.test(firebase.apiKey)||!/^\d+$/.test(firebase.messagingSenderId)||
       !firebase.appId.startsWith('1:'+firebase.messagingSenderId+':web:')||
       !/^1:\d+:web:[a-f0-9]+$/.test(firebase.appId)||
       worker!==(local?'https://evora-collective-staging.francesco87-mazzeo.workers.dev':'https://throbbing-feather-957f.francesco87-mazzeo.workers.dev'))
      throw new Error('Invalid environment configuration. Operations blocked.');
    return Object.freeze({name:local?'staging':'production',workerBase:worker,firebase:Object.freeze({...firebase})});
  }
  const current=resolve(root.location);
  root.CollectiveEnvironment=Object.freeze({resolve,current});
})(globalThis);
