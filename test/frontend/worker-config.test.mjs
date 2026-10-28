import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../public/worker-config.js',import.meta.url),'utf8');
import {publicPage,adminPage,frontendSource,between,SINGLE_PAGE} from './app-source.mjs';
const html=frontendSource;
// Avvio con Firebase: area staff; nel ripristino (pagina unica) è index.html, come prima della separazione.
// Nella separazione la pagina pubblica seleziona l'ambiente e usa soltanto il Worker.
const firebasePage=SINGLE_PAGE?publicPage:adminPage;
const adminBootstrap=between(firebasePage,'const environment =','const db =');
const staging='https://evora-collective-staging.francesco87-mazzeo.workers.dev';
const production='https://throbbing-feather-957f.francesco87-mazzeo.workers.dev';
function load(hostname='localhost',{code=source,protocol='http:',override}={}){
 const sandbox={location:{hostname,protocol},EVORA_TEST_WORKER_BASE:override};
 vm.createContext(sandbox);vm.runInContext(code,sandbox);return sandbox;
}
for(const hostname of ['localhost','127.0.0.1','[::1]'])test(`Retired staging fails closed on ${hostname}`,()=>{
 assert.throws(()=>load(hostname),/Local live services disabled/);
});
for(const hostname of ['collective.evorafitness.it','example.github.io'])test(`Public ${hostname} retains production`,()=>{
 const {current}=load(hostname,{protocol:'https:'}).CollectiveEnvironment;
 assert.equal(current.workerBase,production);assert.equal(current.firebase.projectId,'evora-athletes');
 assert.equal(current.name,'production');assert.ok(Object.isFrozen(current)&&Object.isFrozen(current.firebase));
});
test('No retired staging service remains in the runtime configuration',()=>{
 assert.doesNotMatch(source,/evora-collective-staging|984522935462|AIzaSyCLo1_iE5WlZJ0-GyGqNVtXNCiCGqgD_ls/);
 assert.doesNotMatch(html,/evora-collective-staging/);
});
for(const hostname of ['localhost','collective.evorafitness.it'])test(`Worker-only override blocked on ${hostname}`,()=>{
 for(const override of [staging,production,'invalid',null])assert.throws(()=>load(hostname,{override}));
});
test('Opening an HTML file directly blocks configuration',()=>assert.throws(()=>load('',{protocol:'file:'})));
test('HTTP public origin is rejected',()=>assert.throws(()=>load('collective.evorafitness.it',{protocol:'http:'})));
for(const [label,from,to] of [
 ['missing key','apiKey: "AIzaSyABauyOisUza0ojws0Vp_aDmmP8oNNSeZU"','apiKey: ""'],
 ['wrong project','projectId: "evora-athletes"','projectId: "other-project"'],
 ['wrong domain','authDomain: "evora-athletes.firebaseapp.com"','authDomain: "other.firebaseapp.com"'],
 ['wrong bucket','storageBucket: "evora-athletes.firebasestorage.app"','storageBucket: "other.firebasestorage.app"'],
 ['invalid appId','appId: "1:520957090168:web:a19e2f727ae69adf9c108d"','appId: "invalid"'],
 ['invalid sender','messagingSenderId: "520957090168"','messagingSenderId: "invalid"']
])test(`Invalid production ${label} blocks initialization`,()=>{
 assert.ok(source.includes(from));
 let initialized=0,requests=0;
 const sandbox={location:{hostname:'collective.evorafitness.it',protocol:'https:'},firebase:{initializeApp(){initialized++;}},fetch(){requests++;}};
 vm.createContext(sandbox);
 assert.throws(()=>vm.runInContext(source.replace(from,to),sandbox));
 assert.throws(()=>vm.runInContext(adminBootstrap,sandbox));
 assert.throws(()=>vm.runInContext(between(publicPage,'const environment =','</script>'),sandbox));
 assert.equal(initialized,0);assert.equal(requests,0);assert.equal(sandbox.CollectiveEnvironment,undefined);
});
test('Single environment selection feeds both SDK initialization and every endpoint',()=>{
 for(const page of [publicPage,firebasePage])assert.match(page,/const environment = CollectiveEnvironment.current;/);
 assert.match(firebasePage,/const firebaseConfig = environment.firebase;\s*firebase.initializeApp\(firebaseConfig\);/);
 assert.match(html,/WORKER_BASE = environment.workerBase/);
 for(const suffix of ['/applications','/admin/scoring','/auth','/notify'])assert.ok(html.includes('WORKER_BASE + "'+suffix+'"'));
 assert.match(html,/OCR_PROXY\s*= WORKER_BASE;/);
 assert.ok(firebasePage.indexOf('public/worker-config.js')<firebasePage.indexOf('firebase.initializeApp('));
 assert.ok(publicPage.indexOf('public/worker-config.js')<publicPage.indexOf('const environment ='));
 assert.doesNotMatch(source,/localStorage|sessionStorage|URLSearchParams/);
});
test('Missing configuration module cannot initialize Firebase',()=>{
 let initialized=0;
 const sandbox={firebase:{initializeApp(){initialized++;}}};vm.createContext(sandbox);
 assert.throws(()=>vm.runInContext(adminBootstrap,sandbox));assert.equal(initialized,0);
});
test('The public page loads no Firebase SDK and never initializes it',{skip:SINGLE_PAGE&&'pagina unica (ripristino): Firebase si carica come prima della separazione'},()=>{
 assert.doesNotMatch(publicPage,/gstatic\.com\/firebasejs|firebase\.|initializeApp/);
 assert.match(adminPage,/gstatic\.com\/firebasejs\/10\.12\.0\/firebase-app-compat\.js/);
});
test('During the rollback /admin/ only redirects to /#admin and initializes nothing',{skip:!SINGLE_PAGE&&'solo durante il ripristino'},()=>{
 assert.match(adminPage,/location\.replace\("\.\.\/#admin"\)/);
 assert.doesNotMatch(adminPage,/gstatic\.com|initializeApp|worker-config/);
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
