import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../public/worker-config.js',import.meta.url),'utf8');
const html=await readFile(new URL('../../index.html',import.meta.url),'utf8');
const staging='https://evora-collective-staging.francesco87-mazzeo.workers.dev';
const production='https://throbbing-feather-957f.francesco87-mazzeo.workers.dev';
function load(hostname='localhost',{code=source,protocol='http:',override}={}){
 const sandbox={location:{hostname,protocol},EVORA_TEST_WORKER_BASE:override};
 vm.createContext(sandbox);vm.runInContext(code,sandbox);return sandbox;
}
for(const hostname of ['localhost','127.0.0.1','[::1]'])test(`Atomic staging default on ${hostname}`,()=>{
 const {current}=load(hostname).CollectiveEnvironment;
 assert.equal(current.workerBase,staging);assert.equal(current.firebase.projectId,'evora-collective-staging');
 assert.equal(current.firebase.authDomain,'evora-collective-staging.firebaseapp.com');
 assert.ok(Object.isFrozen(current)&&Object.isFrozen(current.firebase));
});
for(const hostname of ['collective.evorafitness.it','example.github.io'])test(`Public ${hostname} retains production`,()=>{
 const {current}=load(hostname,{protocol:'https:'}).CollectiveEnvironment;
 assert.equal(current.workerBase,production);assert.equal(current.firebase.projectId,'evora-athletes');
});
for(const hostname of ['localhost','collective.evorafitness.it'])test(`Worker-only override blocked on ${hostname}`,()=>{
 for(const override of [staging,production,'invalid',null])assert.throws(()=>load(hostname,{override}));
});
test('Opening an HTML file directly blocks configuration',()=>assert.throws(()=>load('',{protocol:'file:'})));
for(const [label,from,to] of [
 ['missing key',"apiKey:'AIzaSyCLo1_iE5WlZJ0-GyGqNVtXNCiCGqgD_ls'","apiKey:''"],
 ['production API key',"apiKey:'AIzaSyCLo1_iE5WlZJ0-GyGqNVtXNCiCGqgD_ls'","apiKey:'AIzaSyABauyOisUza0ojws0Vp_aDmmP8oNNSeZU'"],
 ['invalid key',"apiKey:'AIzaSyCLo1_iE5WlZJ0-GyGqNVtXNCiCGqgD_ls'","apiKey:'invalid'"],
 ['mixed project',"projectId:'evora-collective-staging'","projectId:'evora-athletes'"],
 ['mixed authDomain',"authDomain:'evora-collective-staging.firebaseapp.com'","authDomain:'evora-athletes.firebaseapp.com'"],
 ['mixed bucket',"storageBucket:'evora-collective-staging.firebasestorage.app'","storageBucket:'evora-athletes.firebasestorage.app'"],
 ['missing appId',"appId:'1:984522935462:web:94a7a90f36496ad1923867'","appId:''"],
 ['mixed sender',"messagingSenderId:'984522935462'","messagingSenderId:'520957090168'"],
 ['production Worker',`const stagingWorker='${staging}'`,`const stagingWorker='${production}'`]
])test(`Broken staging ${label} never initializes Firebase or falls back`,()=>{
 assert.ok(source.includes(from));
 let initialized=0,requests=0;
 const sandbox={location:{hostname:'localhost',protocol:'http:'},firebase:{initializeApp(){initialized++;}},fetch(){requests++;}};
 vm.createContext(sandbox);
 assert.throws(()=>vm.runInContext(source.replace(from,to),sandbox));
 // A later script must also fail, even though browsers continue after a script error.
 const bootstrap=html.slice(html.indexOf('const environment ='),html.indexOf('const db ='));
 assert.throws(()=>vm.runInContext(bootstrap,sandbox));
 assert.equal(initialized,0);assert.equal(requests,0);assert.equal(sandbox.CollectiveEnvironment,undefined);
});
test('Single environment selection feeds both SDK initialization and every endpoint',()=>{
 assert.match(html,/const environment = CollectiveEnvironment.current;/);
 assert.match(html,/const firebaseConfig = environment.firebase;\s*firebase.initializeApp\(firebaseConfig\);/);
 assert.match(html,/WORKER_BASE = environment.workerBase/);
 for(const suffix of ['/applications','/admin/scoring','/auth','/notify'])assert.ok(html.includes('WORKER_BASE + "'+suffix+'"'));
 assert.match(html,/OCR_PROXY\s*= WORKER_BASE;/);
 assert.ok(html.indexOf('public/worker-config.js')<html.indexOf('firebase.initializeApp('));
 assert.doesNotMatch(source,/localStorage|sessionStorage|URLSearchParams/);
});
test('Missing configuration module cannot initialize Firebase',()=>{
 let initialized=0;
 const sandbox={firebase:{initializeApp(){initialized++;}}};vm.createContext(sandbox);
 const bootstrap=html.slice(html.indexOf('const environment ='),html.indexOf('const db ='));
 assert.throws(()=>vm.runInContext(bootstrap,sandbox));assert.equal(initialized,0);
});
test('Public Firebase configuration preserves the six original values',()=>{
 const actual=load('collective.evorafitness.it',{protocol:'https:'}).CollectiveEnvironment.current.firebase;
 assert.equal(JSON.stringify(actual),JSON.stringify({
  apiKey:'AIzaSyABauyOisUza0ojws0Vp_aDmmP8oNNSeZU',
  authDomain:'evora-athletes.firebaseapp.com',projectId:'evora-athletes',
  storageBucket:'evora-athletes.firebasestorage.app',messagingSenderId:'520957090168',
  appId:'1:520957090168:web:a19e2f727ae69adf9c108d'
 }));
});
