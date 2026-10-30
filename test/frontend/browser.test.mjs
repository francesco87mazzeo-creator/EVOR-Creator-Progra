import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {validatePublicApplication,prepareApplication} from '../../server/collective/application.mjs';
import {publicFixture,frontendDocument,NOW} from '../../server/collective/test/frontend-reference.mjs';
import {SINGLE_PAGE} from './app-source.mjs';
import {buildSinglePage,buildAdminPage} from '../../tools/frontend-mode.mjs';
import {rollbackServices} from '../../worker/test/rollback-services.mjs';
import scoreLevels from '../../public/score-levels.js';
import {computeScore} from '../../server/collective/scoring.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const assets=process.env.EVORA_BROWSER_ASSETS;
assert.ok(assets,'Set EVORA_BROWSER_ASSETS to the directory containing test-only node_modules (@babel/standalone, react@18, react-dom@18).');
// Babel può stare in una cartella a parte (EVORA_BABEL_ASSETS): deve essere la versione fissata nelle pagine.
const babelRequire=createRequire(`${process.env.EVORA_BABEL_ASSETS||assets}/package.json`);
// Sito servito dall'origine sintetica: le due pagine e i moduli app/ (la query ?v= viene ignorata).
const site={};
for(const file of ['index.html','admin/index.html','app/styles.css','app/shared.jsx','app/public-form.jsx','app/admin.jsx','app/public-main.jsx','app/admin-main.jsx'])
 site[file]=await readFile(new URL(`../../${file}`,import.meta.url),'utf8');
const sitePath={'/':'index.html','/index.html':'index.html','/admin/':'admin/index.html','/admin/index.html':'admin/index.html'};
const contentType=file=>file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/plain';
const workerConfig=await readFile(new URL('../../public/worker-config.js',import.meta.url),'utf8');
const mockWorker='https://throbbing-feather-957f.francesco87-mazzeo.workers.dev';
const mockOrigin='https://synthetic.collective.test';
const client=await readFile(new URL('../../public/applications-client.js',import.meta.url),'utf8');
const scoreLevelsModule=await readFile(new URL('../../public/score-levels.js',import.meta.url),'utf8');
const adminScoringClient=await readFile(new URL('../../public/admin-scoring-client.js',import.meta.url),'utf8');
const js={
 'https://unpkg.com/react@18.3.1/umd/react.production.min.js':await readFile(`${assets}/node_modules/react/umd/react.production.min.js`),
 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js':await readFile(`${assets}/node_modules/react-dom/umd/react-dom.production.min.js`),
 'https://unpkg.com/@babel/standalone@8.0.9/babel.min.js':await readFile(babelRequire.resolve('@babel/standalone/babel.min.js'))
};
const firebaseStub=`(function(){
 const counters=window.testCounters=window.testCounters||{reads:0,writes:0};
 const candidate=__CANDIDATE__,allowWrites=__ALLOW_WRITES__;
 if(!localStorage.getItem('syntheticBenchmarksSeeded')){localStorage.setItem('syntheticBenchmarksSeeded','1');const b=__BENCHMARKS_SEED__;if(b!==null)localStorage.setItem('syntheticBenchmarks',JSON.stringify(b));}
 const seed=__SCORE_LEVELS__;if(!localStorage.getItem("syntheticLevelsSeeded")){localStorage.setItem("syntheticLevelsSeeded","1");if(seed!==null)localStorage.setItem("syntheticScoreLevels",JSON.stringify(seed));}
 const session=window.testSession={signIns:0,signOuts:0},listeners=[];
 const user={uid:'staff-admin',getIdToken:async()=> 'synthetic-firebase-id-token',getIdTokenResult:async()=>({claims:{role:__ROLE__}})};
 const notify=()=>listeners.forEach(cb=>cb(auth.currentUser));
 const auth={currentUser:__SIGNED_IN__?user:null,setPersistence:async()=>{},
 onAuthStateChanged(cb){listeners.push(cb);Promise.resolve().then(()=>cb(auth.currentUser));return()=>{const i=listeners.indexOf(cb);if(i>=0)listeners.splice(i,1);};},
 async signInWithCustomToken(token){if(token!=='synthetic-custom-token')throw Error('Unexpected custom token');session.signIns++;auth.currentUser=user;notify();},
 async signOut(){session.signOuts++;auth.currentUser=null;notify();}};
 // Like the production Rules: reads without a signed-in staff user are denied.
 const read=async()=>{if(!auth.currentUser)throw Object.assign(Error('Missing or insufficient permissions.'),{code:'permission-denied'});counters.reads++;return{exists:false,docs:Array.isArray(candidate)?candidate.map((item,index)=>({id:"synthetic-id-"+index,data:()=>item})):candidate?[{id:"synthetic-id",data:()=>candidate}]:[]};};
 const write=patch=>{counters.writes++;if(allowWrites){counters.lastWrite=patch;return Promise.resolve();}throw Error('Unexpected Firestore write');};
 const db={collection(collection){return{doc(id){return{get:async(options)=>{if(collection==="settings"&&id==="instagramBenchmarks"){await read();(window.testBenchmarkReads??=[]).push(options?.source||"default");if(window.testBenchmarkReadMode==="fail")throw Error("Synthetic post-write read failure");if(window.testBenchmarkReadMode==="missing")return{exists:false};if(__BENCHMARKS_READ_ERROR__)throw Error('Synthetic benchmark read error');const value=localStorage.getItem('syntheticBenchmarks');return{exists:value!==null,data:()=>{const result=JSON.parse(value);if(window.testBenchmarkReadMode==="mismatch"&&result)result.engagement[0].medium+=0.125;return result;}};}if(collection==="settings"&&id==="scoreLevels"){await read();if(__LEVELS_READ_ERROR__)throw Error("Synthetic levels read error");const value=localStorage.getItem("syntheticScoreLevels");return{exists:value!==null,data:()=>JSON.parse(value)};}return read();},set:write,update:write,delete:write};},orderBy(){return{get:read};}};}};
 window.firebase={initializeApp(config){if(config.projectId!=="evora-athletes")throw Error("Production Firebase blocked by test harness");window.testFirebaseConfig=config;},firestore:()=>db,auth:Object.assign(()=>auth,{Auth:{Persistence:{LOCAL:'local'}}})};
})();`;
let browser;
before(async()=>{browser=await chromium.launch({executablePath:process.env.EVORA_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--host-resolver-rules=MAP * ~NOTFOUND']});});
after(async()=>browser?.close());
// ocr: ({kind,index,route,cors,synthetic}) può rispondere al posto del Worker simulato (errore, ritardo, nessuna risposta);
// se restituisce undefined vale la risposta sintetica. applicationResponses: risposte in sequenza per /applications.
async function openConfigSection(page,label){const summary=page.getByText(label,{exact:true});if(!await summary.evaluate(el=>el.parentElement.open))await summary.click();}
async function pageFor(t,{admin=false,applicationResponse,applicationResponses,applicationHandler=null,scoringResponse,benchmarksResponse,benchmarksReadError=false,benchmarksSeed=null,levelsResponse,levelsSeed=null,levelsReadError=false,staffRole="admin",legacyStaffAssets=false,candidate=null,allowWrites=false,configuration=workerConfig,bootFailure=false,signedIn=true,expectBlocked=false,moduleOverrides={},expectErrors=false,ocr=null,clock=false}={}) {
 const context=await browser.newContext({serviceWorkers:'block'});t.after(()=>context.close());
 const page=await context.newPage();t.after(()=>page.close());
 const calls=[],errors=[],blocked=[],served=[],ocrIndex={};let applications=0;
 page.on('pageerror',e=>errors.push(e.message));
 if(clock)await page.clock.install();
 if(signedIn)await page.addInitScript(()=>localStorage.setItem('evora_login_at',String(Date.now())));
 await context.route('**/*',async route=>{
  const req=route.request(),url=req.url();
  const cors={'Access-Control-Allow-Origin':mockOrigin,'Access-Control-Allow-Headers':'Content-Type,Idempotency-Key,X-Turnstile-Token,Authorization','Access-Control-Allow-Methods':'POST,OPTIONS'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
  if(url===mockOrigin+'/public/worker-config.js')return route.fulfill({contentType:'text/javascript',body:configuration});
  if(url===mockOrigin+'/public/applications-client.js')return route.fulfill({contentType:'text/javascript',body:client});
  if(new URL(url).origin===mockOrigin&&new URL(url).pathname==='/public/admin-scoring-client.js')return route.fulfill({contentType:'text/javascript',body:legacyStaffAssets&&new URL(url).search===''?adminScoringClient.replace('saveScoring,saveScoreLevels,ScoringSaveError','saveScoring,ScoringSaveError'):adminScoringClient});
  if(url.startsWith(mockOrigin+'/')){
   const path=new URL(url).pathname,file=sitePath[path]||(path.startsWith('/app/')&&site[path.slice(1)]!==undefined?path.slice(1):null);
   if(file){served.push(file);return route.fulfill({contentType:contentType(file),body:legacyStaffAssets&&file==='admin/index.html'?(moduleOverrides[file]??site[file]).replace(/<script src="\.\.\/public\/score-levels[^"]*"><\/script>/,'').replace(/public\/admin-scoring-client\.js\?v=[0-9a-f]+/,'public/admin-scoring-client.js'):(moduleOverrides[file]??site[file])});}
  }
  // Come unpkg (CORS *): con crossorigin il browser verifica davvero gli hash integrity delle pagine.
  if(new URL(url).origin===mockOrigin&&new URL(url).pathname==='/public/score-levels.js')return route.fulfill({contentType:'text/javascript',body:scoreLevelsModule});
  if(js[url])return route.fulfill({contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:js[url]});
  if(url.startsWith('https://www.gstatic.com/firebasejs/'))return route.fulfill({contentType:'text/javascript',body:firebaseStub.replace('__BENCHMARKS_READ_ERROR__',JSON.stringify(benchmarksReadError)).replace('__BENCHMARKS_SEED__',JSON.stringify(benchmarksSeed)).replace('__SCORE_LEVELS__',JSON.stringify(levelsSeed)).replace('__LEVELS_READ_ERROR__',JSON.stringify(levelsReadError)).replace('__ROLE__',JSON.stringify(staffRole)).replace('__CANDIDATE__',JSON.stringify(candidate)).replace('__ALLOW_WRITES__',JSON.stringify(allowWrites)).replace('__SIGNED_IN__',JSON.stringify(signedIn))});
  if(url.startsWith('https://fonts.'))return route.fulfill({contentType:'text/css',body:''});
  if(req.method()==='POST') {
   assert.equal(new URL(url).origin,mockWorker,'Every POST must be intercepted at the mocked Worker origin');
   calls.push({url,body:req.postDataJSON(),headers:req.headers()});
   if(url===mockWorker+'/auth'&&req.postDataJSON()?.code==='synthetic-admin-code')return route.fulfill({status:200,headers:cors,contentType:'application/json',body:JSON.stringify({ok:true,role:'admin',token:'synthetic-custom-token'})});
   if(url===mockWorker+'/auth')return route.fulfill({status:401,headers:cors,contentType:'application/json',body:'{}'});
   if(url===mockWorker+'/notify')return route.fulfill({status:403,headers:cors,contentType:'application/json',body:'{"ok":false}'});
   if(url.endsWith('/admin/score-levels')){
    const status=levelsResponse?.status||200;
    if(status===200)await page.evaluate(config=>localStorage.setItem('syntheticScoreLevels',JSON.stringify(config)),req.postDataJSON());
    return route.fulfill({status,headers:cors,contentType:'application/json',body:JSON.stringify(levelsResponse?.body||{ok:true})});
   }
   if(url.endsWith('/admin/benchmarks')){const status=benchmarksResponse?.status||200;if(status===200)await page.evaluate(config=>localStorage.setItem('syntheticBenchmarks',JSON.stringify(config)),scoreLevels.benchmarks.toDocument(req.postDataJSON()));return route.fulfill({status,headers:cors,contentType:'application/json',body:JSON.stringify({ok:status===200})});}
   if(url.endsWith('/admin/scoring'))return route.fulfill({status:scoringResponse?.status||200,headers:cors,contentType:'application/json',body:JSON.stringify(scoringResponse?.body||{ok:true})});
   if(url.endsWith('/applications')){
    if(applicationHandler){
     const response=await applicationHandler(new Request(url,{method:'POST',headers:req.headers(),body:req.postData()}));
     return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
    }
    const r=applicationResponses?applicationResponses[Math.min(applications++,applicationResponses.length-1)]:applicationResponse;
    return route.fulfill({status:r?.status||201,headers:cors,contentType:'application/json',body:JSON.stringify(r?.body||{ok:true,id:'synthetic-result'})});
   }
   if(url===mockWorker+'/') {
    const prompt=req.postDataJSON().messages[0].content[1].text;
    const kind=prompt.includes('displayName')?'profile':prompt.includes('cerca il dato')?'verify':'insights';
    const n=value=>({value,visibility:'complete'});
    const synthetic=(result=kind==='profile'?{screen_type:'profile_ok',displayName:{value:'Synthetic Candidate',visibility:'complete',truncated:false},username:{value:'synthetic',visibility:'complete',truncated:false},followers:n(8500)}:
     {screen_type:'insights_ok',views:n(24800),netFollowers:n(260),interactions:n(1120),accountsReached:n(18400)})=>
     route.fulfill({headers:cors,contentType:'application/json',body:JSON.stringify({content:[{text:JSON.stringify(result)}]})});
    const index=ocrIndex[kind]=(ocrIndex[kind]??-1)+1;
    // Il callback restituisce la propria gestione (fulfill, abort o una promessa che non si risolve) oppure undefined.
    if(ocr){const handled=ocr({kind,index,route,cors,synthetic});if(handled!==undefined)return handled;}
    return synthetic();
   }
  }
  // No network escape: unexpected requests are aborted locally and fail the test.
  blocked.push(req.method()+' '+url);
  return route.abort('blockedbyclient');
 });
 // L'area staff si apre dall'indirizzo storico /#admin: reindirizza ad admin/, oppure resta sulla pagina unica nel ripristino.
 await page.goto(`${mockOrigin}/${admin?'#admin':''}`);
 if(admin&&!SINGLE_PAGE)await page.waitForURL(`${mockOrigin}/admin/`);
 if(!expectBlocked)t.after(()=>assert.deepEqual(blocked,[],'No request may leave the test harness'));
 if(!expectErrors)t.after(()=>bootFailure?assert.ok(errors.some(e=>e.includes('Invalid production configuration'))):assert.deepEqual(errors,[],'No uncaught browser errors'));
 return{page,calls,blocked,served,errors};
}
/** Pagina pubblica: nessun SDK Firebase caricato, quindi nessuna lettura o scrittura possibile.
 * Nella pagina unica (ripristino) Firebase si carica come prima della separazione: nessuna lettura o scrittura. */
async function assertNoFirebase(page){
 if(SINGLE_PAGE)return assert.deepEqual(await page.evaluate(()=>window.testCounters),{reads:0,writes:0});
 assert.deepEqual(await page.evaluate(()=>({firebase:typeof window.firebase,counters:typeof window.testCounters})),{firebase:'undefined',counters:'undefined'});
}
async function jpeg(page){return Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=30;c.height=30;c.getContext('2d').fillRect(0,0,30,30);return c.toDataURL('image/jpeg').split(',')[1];}),'base64');}
// beforeContinue: attese o verifiche nel precheck; manual: prosegue con l'inserimento manuale; step1: dati Instagram a mano.
async function fillPublic(page,{age='27',profileOnly=false,beforeContinue=null,manual=false,step1=null,files=null}={}) {
 await page.getByRole('button',{name:/Candidati|candidatura/i}).first().click();
 await page.getByRole('heading',{name:'Prepara i tuoi dati Instagram'}).waitFor();
 const buffer=await jpeg(page),file={name:'synthetic.jpg',mimeType:'image/jpeg',buffer};
 await page.getByLabel('Carica screenshot profilo',{exact:true}).setInputFiles(files?.profile||file);
 await page.getByLabel('Carica primo screenshot Insight',{exact:true}).setInputFiles(files?.ins1||file);
 if(beforeContinue)await beforeContinue();
 await page.getByRole('button',{name:manual?'Prosegui inserendo i dati a mano':'Continua con la candidatura'}).click();
 await page.locator('#f-age').fill(age);await page.locator('#f-email').fill('synthetic@example.test');await page.locator('#f-city').fill('Synthetic City');
 // Senza lettura del profilo il nome non è precompilato: lo inserisce il candidato.
 if(!await page.locator('#f-name').inputValue())await page.locator('#f-name').fill('Synthetic Manual');
 await page.getByLabel('Coach / Personal trainer',{exact:true}).check();
 await page.locator('label.check input').check();
 if(profileOnly)return;
 const next=()=>page.getByRole('button',{name:'Avanti',exact:true}).click();
 await next();if(step1)await step1();await next();
 for(const id of ['f-3w','f-ct','f-wt','f-wf'])await page.locator(`#${id}`).fill('Synthetic response');
 await page.getByRole('radiogroup',{name:'collab',exact:true}).getByRole('radio').nth(1).click();await next();
 for(const id of ['f-mot','f-bl','f-ci'])await page.locator(`#${id}`).fill('Synthetic response');await next();
 await page.getByRole('radiogroup',{name:'trial',exact:true}).getByRole('radio').first().click();await page.locator('#f-bm').fill('Synthetic response');await next();
 for(const name of ['cpm','routine','guide','ev','sh','ugc','raw'])await page.getByRole('radiogroup',{name,exact:true}).getByRole('radio').first().click();
 await next();await page.locator('label.check input').check();
}
test('Public journey submits 54 fields to the Worker, never Firestore or Telegram',{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t);await fillPublic(page,{age:'18'});
 await page.getByRole('button',{name:'Invia la candidatura',exact:true}).click();
 await page.getByRole('heading',{name:'Candidatura ricevuta',exact:true}).waitFor();
 const sent=calls.filter(c=>c.url.endsWith('/applications'));assert.equal(sent.length,1);
 assert.equal(sent[0].body.age,18);assert.equal(Object.keys(sent[0].body).length,54);validatePublicApplication(sent[0].body);
 assert.ok(sent[0].headers['idempotency-key']);assert.ok(!calls.some(c=>c.url.endsWith('/notify')));
 await assertNoFirebase(page);
});
test('Admin test form simulates submit and disables upload OCR without any writes',{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t,{admin:true});
 await page.getByRole('button',{name:'Form di prova',exact:true}).click();
 await page.evaluate(()=>{window.testCounters.reads=0;window.testCounters.writes=0;});
 await page.getByRole('button',{name:'Compila test',exact:true}).click();
 for(let i=0;i<5;i++)await page.getByRole('button',{name:'Indietro',exact:true}).click();
 await page.getByLabel('Carica il primo screenshot',{exact:true}).setInputFiles({name:'synthetic.jpg',mimeType:'image/jpeg',buffer:await jpeg(page)});
 await page.getByText('Lettura automatica disattivata in modalità prova.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Compila test',exact:true}).click();
 await page.getByRole('button',{name:'Invia la candidatura',exact:true}).click();
 await page.getByRole('heading',{name:'Simulazione completata',exact:true}).waitFor();
 assert.equal(calls.length,0);assert.deepEqual(await page.evaluate(()=>window.testCounters),{reads:0,writes:0});
});
test('Server field error returns to its page and stays visible',{timeout:60000},async t=>{
 const {page}=await pageFor(t,{applicationResponse:{status:422,body:{error:{code:'RANGE',path:'$.age'}}}});await fillPublic(page);
 await page.getByRole('button',{name:'Invia la candidatura',exact:true}).click();
 await page.getByRole('alert').getByText('Controlla i dati inseriti e riprova.',{exact:true}).waitFor();
 assert.equal(await page.locator('#f-age').getAttribute('aria-invalid'),'true');
 assert.equal(await page.getByRole('heading',{name:'Candidatura ricevuta',exact:true}).count(),0);
});

test('Browser age checks reject minors and invalid ages without an applications request',{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t);await fillPublic(page,{age:'17',profileOnly:true});
 assert.equal(await page.locator('#f-age').getAttribute('min'),'18');
 assert.equal(await page.locator('#f-age').getAttribute('max'),'99');
 assert.equal(await page.locator('#f-age').getAttribute('step'),'1');
 await page.getByText('Dichiaro di aver compiuto 18 anni.',{exact:true}).waitFor();
 for(const age of ['14','17','17.5','100']) {
  await page.locator('#f-age').fill(age);await page.getByRole('button',{name:'Avanti',exact:true}).click();
  assert.equal(await page.locator('#f-age').getAttribute('aria-invalid'),'true');
  await page.getByText("Inserisci un'età intera compresa tra 18 e 99 anni. Le candidature sono riservate ai maggiorenni.",{exact:true}).waitFor();
  assert.equal(calls.filter(c=>c.url.endsWith('/applications')).length,0);
 }
 await page.locator('#f-age').fill('18');await page.getByRole('button',{name:'Avanti',exact:true}).click();
 await page.locator('#f-ig').waitFor();
 await assertNoFirebase(page);
});

test('Admin scoring uses authenticated Worker save; read and reset remain unchanged',{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t,{admin:true});
 await page.getByRole('button',{name:'Configurazione Scoring',exact:true}).click();await openConfigSection(page,'Formule attuali e parametri numerici (invariati)');
 const weight=page.getByLabel('Coinvolgimento',{exact:true});await weight.fill('12');
 await page.getByRole('button',{name:'Ripristina valori iniziali',exact:true}).click();
 assert.equal(await weight.inputValue(),'65');assert.equal(calls.length,0);
 const reads=await page.evaluate(()=>window.testCounters.reads);
 await page.getByRole('button',{name:'Salva configurazione',exact:true}).click();
 await page.getByText('Configurazione salvata',{exact:true}).waitFor();
 const sent=calls.filter(c=>c.url.endsWith('/admin/scoring'));assert.equal(sent.length,1);
 assert.equal(sent[0].headers.authorization,'Bearer synthetic-firebase-id-token');
 assert.deepEqual(sent[0].body,{version:3,weights:{engagement:65,visibility:35},references:{engagementRate:2,views:30000},lowBase:{views:1000,interactions:10}});
 // Un campo vuoto non viene inviato come zero.
 await weight.fill('');await page.getByRole('button',{name:'Salva configurazione',exact:true}).click();
 await page.getByText('Controlla i valori evidenziati.',{exact:true}).waitFor();
 assert.equal(calls.filter(c=>c.url.endsWith('/admin/scoring')).length,1);
 assert.deepEqual(await page.evaluate(()=>window.testCounters),{reads,writes:0});
});

test('Score levels: add, validate, persist, reload and delete; both graphs share the saved config, numbers unchanged',{timeout:60000},async t=>{
 const candidate={...prepareApplication({...await publicFixture(),fullName:'Synthetic Levels',accountsReached:null},{now:NOW}),scoringVersion:2,socialScore:81};
 const numeric=computeScore(candidate);
 const {page,calls}=await pageFor(t,{admin:true,candidate});
 await page.getByRole('button',{name:'Livelli e colori',exact:true}).click();await openConfigSection(page,'Livelli numerici e colori');
 await page.getByText('Configurazione assente: sono attivi i livelli storici predefiniti.',{exact:false}).waitFor();
 assert.equal(calls.length,0,'missing config is not automatically persisted');
 await page.getByRole('button',{name:'Aggiungi livello Social Score',exact:true}).click();
 assert.equal(await page.getByLabel(/Social Score: nome/).count(),5);
 await page.getByLabel('Social Score: nome 4',{exact:true}).fill('Selezione test');
 await page.getByLabel('Social Score: colore 4',{exact:true}).evaluate(el=>{
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'#123456');
  el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
 });
 await page.getByLabel('Singole metriche: nome 3',{exact:true}).fill('Metrica test');
 await page.getByLabel('Social Score: a 1',{exact:true}).fill('18');
 await page.getByText('Gli intervalli si sovrappongono:',{exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Salva livelli',exact:true}).isDisabled(),true);
 assert.equal(calls.length,0);
 await page.getByLabel('Social Score: a 1',{exact:true}).fill('17');
 await page.getByRole('button',{name:'Salva livelli',exact:true}).click();
 await page.getByText('Livelli salvati. Punteggi numerici invariati.',{exact:true}).waitFor();
 const sent=calls.filter(c=>c.url.endsWith('/admin/score-levels'));assert.equal(sent.length,1);
 assert.equal(sent[0].headers.authorization,'Bearer synthetic-firebase-id-token');
 assert.equal(sent[0].body.social.length,5);assert.equal(sent[0].body.social[3].color,'#123456');
 await page.reload();
 await page.locator('button.row').filter({hasText:'Synthetic Levels'}).click();
 const social=page.getByRole('img',{name:/Social Score:.*Selezione test/});await social.waitFor();
 assert.equal(await social.locator('[data-score-level="good"]').evaluate(el=>el.style.backgroundColor),'rgb(18, 52, 86)');
 await page.getByRole('img',{name:/Coinvolgimento:.*Metrica test/}).waitFor();
 assert.match(await social.getAttribute('aria-label'),new RegExp(numeric.socialScore.toFixed(2)));
 await page.getByText('Punteggio registrato all\'invio con il modello precedente:',{exact:false}).waitFor();
 assert.equal(await page.evaluate(()=>window.testCounters.writes),0);
 assert.equal(calls.some(c=>c.url.endsWith('/admin/scoring')||c.url.endsWith('/applications')||c.url.endsWith('/notify')),false);
 await page.getByRole('button',{name:'Livelli e colori',exact:true}).click();await openConfigSection(page,'Livelli numerici e colori');
 await page.getByRole('button',{name:'Social Score: elimina 2',exact:true}).click();
 assert.equal(await page.getByLabel(/Social Score: nome/).count(),4);
 await page.getByRole('button',{name:'Salva livelli',exact:true}).click();
 await page.getByText('Livelli salvati. Punteggi numerici invariati.',{exact:true}).waitFor();
 assert.equal(calls.filter(c=>c.url.endsWith('/admin/score-levels')).at(-1).body.social.length,4);
});

test('Score levels: chart boundaries, missing scores, escaped labels and mobile layout',{timeout:60000},async t=>{
 const cfg=scoreLevels.defaults();cfg.social[2].label='<img src=x onerror=alert(1)>';
 const candidate=prepareApplication({...await publicFixture(),fullName:'Synthetic Graph'},{now:NOW});
 const {page}=await pageFor(t,{admin:true,candidate,levelsSeed:cfg});
 await page.setViewportSize({width:390,height:844});
 await page.locator('button.row').filter({hasText:'Synthetic Graph'}).click();
 await page.getByRole('img',{name:/Social Score:.*<img src=x/}).waitFor();
 assert.equal(await page.locator('img[src="x"]').count(),0,'labels are text, never HTML');
 for(const value of [0,35,55,75,100,null]){
  await page.evaluate(value=>{
   if(!window.levelProbe){const el=document.createElement('div');el.id='level-probe';document.body.append(el);window.levelProbe=ReactDOM.createRoot(el);}
   ReactDOM.flushSync(()=>window.levelProbe.render(React.createElement(ScoreBands,{value,levels:CollectiveScoreLevels.defaults().social,label:'Boundary probe'})));
  },value);
  const probe=page.locator('#level-probe');
  assert.equal(await probe.locator('[data-score-marker]').count(),value===null?0:1);
  const name=await probe.getByRole('img').getAttribute('aria-label');
  assert.ok(name.includes(value===null?'non disponibile':scoreLevels.classify(value,scoreLevels.DEFAULT_CONFIG.social).label));
 }
 await page.getByRole('button',{name:'Livelli e colori',exact:true}).click();await openConfigSection(page,'Livelli numerici e colori');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'editor table scrolls inside its container');
});

test('Score levels: manager sees classifications but cannot open the editor',{timeout:60000},async t=>{
 const candidate=prepareApplication({...await publicFixture(),fullName:'Synthetic Manager'},{now:NOW});
 const {page}=await pageFor(t,{admin:true,candidate,staffRole:'manager'});
 await page.locator('button.row').filter({hasText:'Synthetic Manager'}).click();
 await page.getByRole('img',{name:/Social Score:/}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Livelli e colori',exact:true}).count(),0);
});

test('Score levels: cached HTML and old transport bootstrap the missing dependencies without redirects',{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t,{admin:true,legacyStaffAssets:true});
 await page.getByRole('button',{name:'Livelli e colori',exact:true}).click();await openConfigSection(page,'Livelli numerici e colori');
 await page.getByRole('button',{name:'Salva livelli',exact:true}).click();
 await page.getByText('Livelli salvati. Punteggi numerici invariati.',{exact:true}).waitFor();
 assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith('/admin/score-levels'));
 assert.ok(page.url().endsWith('/admin/'));
});
test('Score levels: per-group limits are configurable above 20 and persist without truncation',{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t,{admin:true});
 await page.getByRole('button',{name:'Livelli e colori',exact:true}).click();await openConfigSection(page,'Livelli numerici e colori');
 await page.getByLabel('Social Score: limite livelli',{exact:true}).fill('25');
 await page.getByLabel('Singole metriche: limite livelli',{exact:true}).fill('4');
 for(let i=4;i<21;i++)await page.getByRole('button',{name:'Aggiungi livello Social Score',exact:true}).click();
 assert.equal(await page.getByLabel(/Social Score: nome/).count(),21);
 await page.getByLabel('Social Score: limite livelli',{exact:true}).fill('20');
 assert.equal(await page.getByRole('button',{name:'Salva livelli',exact:true}).isDisabled(),true);
 assert.equal(await page.getByLabel(/Social Score: nome/).count(),21,'no automatic deletion');
 await page.getByLabel('Social Score: limite livelli',{exact:true}).fill('101');
 await page.getByText('Il limite deve essere un numero intero da 1 a 100.',{exact:true}).waitFor();
 await page.getByLabel('Social Score: limite livelli',{exact:true}).fill('25');
 await page.getByRole('button',{name:'Salva livelli',exact:true}).click();
 await page.getByText('Livelli salvati. Punteggi numerici invariati.',{exact:true}).waitFor();
 assert.equal(calls.length,1);assert.deepEqual(calls[0].body.maxLevels,{social:25,metrics:4});
 await page.reload();await page.getByRole('button',{name:'Livelli e colori',exact:true}).click();await openConfigSection(page,'Livelli numerici e colori');
 await page.getByLabel('Social Score: limite livelli',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('Social Score: limite livelli',{exact:true}).inputValue(),'25');
 assert.equal(await page.getByLabel(/Social Score: nome/).count(),21);
});
for(const [name,options] of [['read failure',{levelsReadError:true}],['invalid stored config',{levelsSeed:{version:2}}]]){
 test(`Score levels: ${name} does not silently fall back or permit overwrite`,{timeout:60000},async t=>{
  const {page,calls}=await pageFor(t,{admin:true,...options});
  await page.getByRole('button',{name:'Livelli e colori',exact:true}).click();await openConfigSection(page,'Livelli numerici e colori');
  await page.getByRole('button',{name:'Riprova lettura livelli',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Salva livelli',exact:true}).count(),0);
  assert.equal(await page.getByText('Configurazione assente: sono attivi i livelli storici predefiniti.',{exact:false}).count(),0);
  assert.equal(calls.length,0);
 });
}
for(const status of [400,403,503])test(`Score levels: HTTP ${status} keeps changes local, no false success`,{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t,{admin:true,levelsResponse:{status}});
 await page.getByRole('button',{name:'Livelli e colori',exact:true}).click();await openConfigSection(page,'Livelli numerici e colori');
 await page.getByLabel('Social Score: nome 1',{exact:true}).fill('Synthetic unsaved');
 await page.getByRole('button',{name:'Salva livelli',exact:true}).click();
 await page.getByRole('button',{name:'Salva livelli',exact:true}).waitFor({state:'visible'});
 await page.waitForFunction(()=>document.body.textContent.includes('Livelli non validi.')||document.body.textContent.includes('Non sei autorizzato')||document.body.textContent.includes('Salvataggio non confermato'));
 assert.equal(await page.getByLabel('Social Score: nome 1',{exact:true}).inputValue(),'Synthetic unsaved');
 assert.equal(await page.evaluate(()=>localStorage.getItem('syntheticScoreLevels')),null);
 assert.equal(await page.getByText('Livelli salvati. Punteggi numerici invariati.',{exact:true}).count(),0);
 assert.equal(calls.length,1);
});
test('Score levels: HTTP 401 requires login and does not persist',{timeout:60000},async t=>{
 const {page}=await pageFor(t,{admin:true,levelsResponse:{status:401}});
 await page.getByRole('button',{name:'Livelli e colori',exact:true}).click();await openConfigSection(page,'Livelli numerici e colori');
 await page.getByRole('button',{name:'Salva livelli',exact:true}).click();
 await page.getByRole('button',{name:'Accedi',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>localStorage.getItem('syntheticScoreLevels')),null);
});
for(const [status,message] of [[400,'Configurazione non valida. Controlla pesi, riferimenti e soglie.'],[403,'Non sei autorizzato a modificare lo scoring. È richiesto il ruolo admin.']]) {
 test(`Admin scoring HTTP ${status} shows error without saving or logging out`,{timeout:60000},async t=>{
  const {page,calls}=await pageFor(t,{admin:true,scoringResponse:{status,body:{error:'server internal detail'}}});
  await page.getByRole('button',{name:'Configurazione Scoring',exact:true}).click();await openConfigSection(page,'Formule attuali e parametri numerici (invariati)');
  const weight=page.locator('input[type="number"]').first();await weight.fill('12');
  await page.getByRole('button',{name:'Salva configurazione',exact:true}).click();
  await page.getByText(message,{exact:true}).waitFor();
  assert.equal(await weight.inputValue(),'12');assert.equal(await page.getByText('Configurazione salvata',{exact:true}).count(),0);
  assert.equal(calls.filter(c=>c.url.endsWith('/admin/scoring')).length,1);assert.equal(await page.evaluate(()=>window.testCounters.writes),0);
 });
}
test('Admin scoring HTTP 401 ends local session and requests a new login',{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t,{admin:true,scoringResponse:{status:401}});
 await page.getByRole('button',{name:'Configurazione Scoring',exact:true}).click();await openConfigSection(page,'Formule attuali e parametri numerici (invariati)');
 await page.getByRole('button',{name:'Salva configurazione',exact:true}).click();
 await page.getByRole('heading',{name:'Accesso riservato',exact:true}).waitFor();
 await page.getByText('Sessione scaduta. Accedi nuovamente all’area riservata.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>localStorage.getItem('evora_login_at')),null);
 assert.equal(calls.filter(c=>c.url.endsWith('/admin/scoring')).length,1);assert.equal(await page.evaluate(()=>window.testCounters.writes),0);
});

test('Admin Block 1: exactly five clickable counters, historical statuses remain visible and untouched',{timeout:60000},async t=>{
 const base=prepareApplication({...await publicFixture(),fullName:'Synthetic State Base'},{now:NOW});
 const statuses=['new','review','approved','rejected','shortlist','watchlist','more_info','archived','legacy_special'];
 const candidates=statuses.map((status,index)=>({...base,fullName:'Synthetic State '+index,status,instagram:'@synthetic'+index,instagramHandle:'synthetic'+index}));
 const {page}=await pageFor(t,{admin:true,candidate:candidates,allowWrites:true});
 const stats=page.locator('button.stat');
 await stats.first().waitFor();
 assert.equal(await stats.count(),5);
 assert.deepEqual(await stats.allTextContents(),['9Totali','1Nuove','1In valutazione','1Approvate','1Rifiutate']);
 assert.equal(await page.locator('button.row').count(),9);
 assert.equal(await page.getByText('Stato non riconosciuto: legacy_special',{exact:true}).count(),1,'unknown statuses must not masquerade as Nuova');
 assert.equal(await page.evaluate(()=>window.testCounters.writes),0,'reading historical statuses never writes');
 await stats.filter({hasText:'Nuove'}).click();
 assert.equal(await page.locator('button.row').count(),1);
 assert.equal(await page.locator('button.row').filter({hasText:'Synthetic State 0'}).count(),1);
 await stats.filter({hasText:'In valutazione'}).click();
 assert.equal(await page.locator('button.row').count(),1);
 assert.equal(await page.locator('button.row').filter({hasText:'Synthetic State 1'}).count(),1);
 await stats.filter({hasText:'Totali'}).click();
 assert.equal(await page.locator('button.row').count(),9,'Totali includes all historical statuses');
 await page.getByRole('button',{name:/Filtri/}).click();
 assert.equal(await page.getByText('Stato',{exact:true}).count(),0,'state selector duplicates the counters');
 assert.equal(await page.getByRole('combobox').count()>0,true,'other filters and sort remain');
 assert.equal(await page.evaluate(()=>window.testCounters.writes),0);
});

test('Admin Block 1: legacy status can be inspected, only four states are selectable',{timeout:60000},async t=>{
 const base=prepareApplication({...await publicFixture(),fullName:'Synthetic Legacy Status'},{now:NOW});
 base.status='shortlist';
 const {page}=await pageFor(t,{admin:true,candidate:base,allowWrites:true});
 await page.locator('button.row').filter({hasText:'Synthetic Legacy Status'}).click();
 await page.getByText('Stato storico attuale:',{exact:false}).waitFor();
 assert.equal(await page.getByText('Shortlist',{exact:true}).count()>0,true);
 const statusGroup=page.getByRole('group',{name:'Seleziona stato candidatura'});
 assert.deepEqual(await statusGroup.locator('button').allTextContents(),['Nuova','In valutazione','Approvata','Rifiutata']);
 assert.equal(await page.evaluate(()=>window.testCounters.writes),0,'opening a legacy status never converts it');
 await statusGroup.getByRole('button',{name:'In valutazione',exact:true}).click();
 await page.getByText('Stato aggiornato',{exact:true}).waitFor();
 assert.equal((await page.evaluate(()=>window.testCounters.lastWrite)).status,'review');
 assert.equal(await page.evaluate(()=>window.testCounters.writes),1,'only explicit selection updates the state');
});

test('Admin Block 1: CSV is available only in the secondary menu and still exports',{timeout:60000},async t=>{
 const candidate=prepareApplication({...await publicFixture(),fullName:'Synthetic Export'},{now:NOW});
 const {page}=await pageFor(t,{admin:true,candidate});
 const actions=page.locator('.admin-actions-menu');
 await actions.locator('summary').waitFor();
 assert.equal(await page.getByRole('button',{name:'Esporta CSV',exact:true}).isVisible(),false);
 await actions.locator('summary').click();
 const exportButton=page.getByRole('button',{name:'Esporta CSV',exact:true});
 assert.equal(await exportButton.isVisible(),true);
 const downloadPromise=page.waitForEvent('download');
 await exportButton.click();
 const download=await downloadPromise;
 assert.ok(download.suggestedFilename().startsWith('evora_collective_'));
 assert.ok(download.suggestedFilename().endsWith('.csv'));
 assert.equal(await page.evaluate(()=>window.testCounters.writes),0,'export remains read-only');
});

test('Management input limits accept boundary-length values without altering save behavior',{timeout:60000},async t=>{
 const candidate=prepareApplication({...await publicFixture(),fullName:'Synthetic Limits'},{now:NOW});
 const {page}=await pageFor(t,{admin:true,candidate,allowWrites:true});
 await page.locator('button.row').filter({hasText:'Synthetic Limits'}).click();
 const notes=page.getByPlaceholder('Osservazioni, contatti effettuati, decisioni…',{exact:true});
 const code=page.getByPlaceholder('ES. MARIO10',{exact:true});
 assert.equal(await notes.getAttribute('maxlength'),'10000');assert.equal(await code.getAttribute('maxlength'),'120');
 await notes.fill('x'.repeat(10000));await page.getByRole('button',{name:'Salva note',exact:true}).click();
 await page.getByText('Note salvate',{exact:true}).waitFor();
 assert.equal((await page.evaluate(()=>window.testCounters.lastWrite)).notes.length,10000);
 await code.fill('a'.repeat(120));await page.getByRole('button',{name:'Salva',exact:true}).click();
 await page.getByText('Codice salvato',{exact:true}).waitFor();
 assert.equal((await page.evaluate(()=>window.testCounters.lastWrite)).creatorCode,'A'.repeat(120));
 await page.getByRole('button',{name:'Correggi dati Insights',exact:true}).click();
 const correction=page.getByPlaceholder('Es. Valore corretto dal secondo screenshot',{exact:true});
 assert.equal(await correction.getAttribute('maxlength'),'2000');await correction.fill('n'.repeat(2000));
 await page.getByRole('button',{name:'Salva e ricalcola',exact:true}).click();
 await page.getByRole('button',{name:'Correggi dati Insights',exact:true}).waitFor();
 assert.equal((await page.evaluate(()=>window.testCounters.lastWrite)).insightsCorrection.note.length,2000);
 assert.equal(await page.evaluate(()=>window.testCounters.writes),3);
});
test('Legacy overlong notes/code show clear errors and never trigger writes',{timeout:60000},async t=>{
 const candidate=prepareApplication({...await publicFixture(),fullName:'Synthetic Legacy'},{now:NOW});
 candidate.notes='x'.repeat(10001);candidate.creatorCode='A'.repeat(121);
 const {page}=await pageFor(t,{admin:true,candidate});
 await page.locator('button.row').filter({hasText:'Synthetic Legacy'}).click();
 await page.getByRole('button',{name:'Salva note',exact:true}).click();
 await page.getByText('Le note interne possono contenere al massimo 10.000 caratteri. Riducile prima di salvare.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Salva',exact:true}).click();
 await page.getByText('Il codice creator può contenere al massimo 120 caratteri, anche dopo la conversione in maiuscolo.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.testCounters.writes),0);
});

test('Mocked Worker URL is used for auth and notification error responses',async t=>{
 const {page,calls}=await pageFor(t,{admin:true});
 // Il redirect termina prima che Babel abbia necessariamente caricato il modulo Admin.
 await page.waitForFunction(()=>typeof AUTH!=='undefined' && typeof sendTelegram==='function');
 const result=await page.evaluate(async()=>{
  let error;try{await AUTH.login('synthetic-invalid');}catch(e){error=e.message;}
  return {error,notification:await sendTelegram('Synthetic test only')};
 });
 assert.equal(result.error,'Codice non riconosciuto.');assert.equal(result.notification.ok,false);
 assert.deepEqual(calls.map(c=>c.url),[mockWorker+'/auth',mockWorker+'/notify']);
});

test('Synthetic browser origin selects production-shaped configuration with all network intercepted',async t=>{
 const {page}=await pageFor(t);
 assert.equal(await page.evaluate(()=>CollectiveEnvironment.current.workerBase),mockWorker);
 await assertNoFirebase(page);
 const staff=await pageFor(t,{admin:true});
 assert.equal(await staff.page.evaluate(()=>window.testFirebaseConfig.projectId),'evora-athletes');
 assert.equal(await staff.page.evaluate(()=>CollectiveEnvironment.current.workerBase),mockWorker);
});

for(const admin of [false,true])test(`Invalid configuration blocks SDK initialization and every POST (${admin?'staff':'public'} page)`,async t=>{
 const {page,calls}=await pageFor(t,{admin,bootFailure:true,configuration:workerConfig.replace('projectId: "evora-athletes"','projectId: "invalid-project"')});
 assert.equal(await page.evaluate(()=>window.testFirebaseConfig),undefined);
 assert.equal(calls.length,0);
 assert.equal(await page.getByRole('button',{name:admin?/Accedi/:/Candidati|candidatura/i}).count(),0);
});

const separatedOnly={skip:SINGLE_PAGE&&'frontend-mode.json = single-page: nessun isolamento dei moduli durante il ripristino'};
test('Public page loads only public modules: no Firebase, no staff code, no admin client',separatedOnly,async t=>{
 const {page,served}=await pageFor(t);
 await page.getByRole('button',{name:/Candidati|candidatura/i}).first().waitFor();
 assert.deepEqual(served,['index.html','app/styles.css','app/shared.jsx','app/public-form.jsx','app/public-main.jsx']);
 assert.deepEqual(await page.evaluate(()=>['AdminPanel','FB','AUTH','sendTelegram','CollectiveAdminScoring'].filter(n=>{try{return typeof eval(n)!=='undefined';}catch{return false;}})),[]);
 await assertNoFirebase(page);
});

test('A broken staff module cannot break the public form, and the staff page reports it',{timeout:60000,...separatedOnly},async t=>{
 const broken={'app/admin.jsx':'function AdminPanel({ onBack }) { return (<div>; // errore di sintassi intenzionale\n'};
 const {page,calls,served}=await pageFor(t,{moduleOverrides:broken});
 await fillPublic(page,{age:'27'});
 await page.getByRole('button',{name:'Invia la candidatura',exact:true}).click();
 await page.getByRole('heading',{name:'Candidatura ricevuta',exact:true}).waitFor();
 assert.equal(calls.filter(c=>c.url.endsWith('/applications')).length,1);
 assert.ok(!served.includes('app/admin.jsx'));
 const staff=await pageFor(t,{admin:true,moduleOverrides:broken,expectErrors:true});
 await staff.page.waitForFunction(()=>document.readyState==='complete');
 assert.equal(await staff.page.getByRole('heading',{name:'Accesso riservato',exact:true}).count(),0);
 assert.ok(staff.served.includes('app/admin.jsx'));
});

test('Single-page rollback (generated from the current modules): candidature, staff area on /#admin and on /admin/',{timeout:60000},async t=>{
 const rollback={'index.html':buildSinglePage(),'admin/index.html':buildAdminPage()};
 const {page,calls,served}=await pageFor(t,{moduleOverrides:rollback});
 await fillPublic(page,{age:'27'});
 await page.getByRole('button',{name:'Invia la candidatura',exact:true}).click();
 await page.getByRole('heading',{name:'Candidatura ricevuta',exact:true}).waitFor();
 const sent=calls.filter(c=>c.url.endsWith('/applications'));assert.equal(sent.length,1);validatePublicApplication(sent[0].body);
 assert.deepEqual(await page.evaluate(()=>window.testCounters),{reads:0,writes:0});
 assert.ok(!served.some(f=>f.startsWith('app/')),'la pagina unica non dipende dai file app/');
 // Accesso diretto a admin/ durante il ripristino: la pagina unica di admin/ apre l'area staff, senza reindirizzare.
 await page.goto(`${mockOrigin}/admin/`);
 await page.getByRole('button',{name:'Configurazione Scoring',exact:true}).waitFor();
 await page.getByRole('button',{name:'Form di prova',exact:true}).waitFor();
 assert.equal(page.url(),`${mockOrigin}/admin/`);
 await page.goto(`${mockOrigin}/#admin`);
 await page.getByRole('button',{name:'Configurazione Scoring',exact:true}).waitFor();
 assert.equal(page.url(),`${mockOrigin}/#admin`);
});

// Pagine in cache durante le transizioni: ogni combinazione di index.html e admin/index.html di versioni diverse
// (separata S, ripristino R), con ingresso da /#admin o da /admin/, deve arrivare all'area staff senza rimbalzi.
for(const [entry,expected] of [['/#admin',{S:'/admin/',R:'/#admin'}],['/admin/',{S:'/admin/',R:'/admin/'}]])
 for(const idx of ['S','R'])for(const adm of ['S','R'])
  test(`Mixed cached pages: index ${idx} + admin ${adm}, entry ${entry} reaches the staff area without redirect loops`,{timeout:60000,skip:SINGLE_PAGE&&'frontend-mode.json = single-page: le pagine separate S non sono sul disco; matrice verificata in modalità separata'},async t=>{
   const overrides={...(idx==='R'?{'index.html':buildSinglePage()}:{}),...(adm==='R'?{'admin/index.html':buildAdminPage()}:{})};
   const {page}=await pageFor(t,{moduleOverrides:overrides});
   // Ingresso con caricamento completo, come da segnalibro (la query evita un cambio di sola # sulla pagina già aperta).
   const navs={count:0};page.on('framenavigated',f=>{if(f===page.mainFrame())navs.count++;});
   await page.goto(`${mockOrigin}${entry==='/#admin'?'/?ingresso#admin':'/admin/'}`);
   await page.getByRole('button',{name:'Configurazione Scoring',exact:true}).waitFor({timeout:20000});
   await page.waitForTimeout(1500);
   assert.ok(navs.count<=2,`${navs.count} navigazioni: possibile reindirizzamento circolare`);
   const url=new URL(page.url());const landed=entry==='/#admin'?expected[idx]:expected[adm];
   assert.equal(url.pathname+url.hash,landed==='/#admin'?'/#admin':'/admin/');
   await page.getByRole('button',{name:'Configurazione Scoring',exact:true}).waitFor();
  });

test('Staff page opens from admin/ and from the historical /#admin address',{skip:SINGLE_PAGE&&'frontend-mode.json = single-page: /#admin e /admin/ sono verificati dal test «Single-page rollback»'},async t=>{
 const {page,served}=await pageFor(t,{admin:true});
 assert.equal(page.url(),`${mockOrigin}/admin/`);
 await page.getByRole('button',{name:'Configurazione Scoring',exact:true}).waitFor();
 // Prima del reindirizzamento il browser può già aver richiesto lo stile della pagina pubblica.
 assert.deepEqual(served.slice(served.indexOf('admin/index.html')),['admin/index.html','app/styles.css','app/shared.jsx','app/public-form.jsx','app/admin.jsx','app/admin-main.jsx']);
 assert.ok(!served.slice(0,served.indexOf('admin/index.html')).some(f=>f.endsWith('.jsx')));
});

test('Admin login keeps the Firebase session and loads candidates (login race regression)',{timeout:60000},async t=>{
 const candidate=prepareApplication({...await publicFixture(),fullName:'Synthetic Login'},{now:NOW});
 const {page,calls}=await pageFor(t,{admin:true,signedIn:false,candidate});
 await page.getByRole('heading',{name:'Accesso riservato',exact:true}).waitFor();
 await page.locator('#access-code').fill('synthetic-admin-code');
 await page.getByRole('button',{name:'Accedi',exact:true}).click();
 await page.locator('button.row').filter({hasText:'Synthetic Login'}).waitFor();
 assert.equal(await page.getByText('Impossibile caricare le candidature. Verifica la connessione.').count(),0);
 assert.deepEqual(await page.evaluate(()=>({...window.testSession,user:firebase.auth().currentUser?.uid})),{signIns:1,signOuts:0,user:'staff-admin'});
 assert.deepEqual(calls.map(c=>c.url),[mockWorker+'/auth']);
});

test('Unexpected requests and WebSockets never leave the harness',async t=>{
 const {page,blocked}=await pageFor(t,{expectBlocked:true});
 const result=await page.evaluate(async worker=>{
  const attempt=async url=>{try{await fetch(url);return 'reached';}catch(e){return 'blocked';}};
  const ws=await new Promise(resolve=>{try{const s=new WebSocket('wss://firestore.googleapis.com/');s.onopen=()=>resolve('open');s.onerror=()=>resolve('blocked');}catch(e){resolve('blocked');}});
  return {external:await attempt('https://example.com/'),firestore:await attempt('https://firestore.googleapis.com/v1/projects/evora-athletes/databases/(default)/documents/candidature'),workerGet:await attempt(worker+'/'),ws};
 },mockWorker);
 assert.deepEqual(result,{external:'blocked',firestore:'blocked',workerGet:'blocked',ws:'blocked'});
 assert.deepEqual(blocked.map(b=>b.split(' ')[0]),['GET','GET','GET']);
});

/* ---------- Affidabilità del percorso di candidatura (PR #5) ---------- */
const sentApplication=calls=>calls.filter(c=>c.url.endsWith('/applications'));
async function fillManualInsights(page){
 await page.getByText('Inserisci i dati Insight',{exact:true}).waitFor();
 for(const [id,value] of [['f-views','24000'],['f-netFollowers','-12'],['f-interactions','900'],['f-accountsReached','15000']])await page.locator(`#${id}`).fill(value);
}
async function submitAndConfirm(page){
 await page.getByRole('button',{name:'Invia la candidatura',exact:true}).click();
 await page.getByRole('heading',{name:'Candidatura ricevuta',exact:true}).waitFor();
}

test('OCR unavailable (network): manual Insight entry, screenshots kept, data not marked as OCR-verified',{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t,{ocr:({kind,route})=>kind==='insights'?route.abort('failed'):undefined});
 await fillPublic(page,{manual:true,step1:()=>fillManualInsights(page),beforeContinue:async()=>{
  await page.getByText(/^Connessione assente o instabile. Lo screenshot è caricato: non serve sceglierlo di nuovo./).waitFor();
  assert.equal(await page.getByRole('button',{name:'Continua con la candidatura'}).isDisabled(),true);
 }});
 await submitAndConfirm(page);
 const [sent]=sentApplication(calls);validatePublicApplication(sent.body);
 assert.equal(sent.body.ocrInsights,null,'manual Insight values carry no OCR evidence');
 assert.ok(sent.body.ocrProfile&&sent.body.ocrProfile.result.screenType==='profile_ok','the successful profile read is kept');
 assert.deepEqual([sent.body.views,sent.body.netFollowers,sent.body.interactions,sent.body.accountsReached],[24000,-12,900,15000]);
 assert.match(sent.body.screenshotData,/^data:image\/jpeg;base64,/);assert.match(sent.body.profileScreenshotData,/^data:image\/jpeg;base64,/);
 assert.equal(sent.body.instagram,'@synthetic');assert.equal(Object.keys(sent.body).length,54);
});

test('OCR 429 on the profile and 502 on Insight: both entered by hand, nothing marked as read',{timeout:60000},async t=>{
 const fail=(route,cors,status)=>route.fulfill({status,headers:cors,contentType:'application/json',body:JSON.stringify({error:{message:'Servizio non disponibile'}})});
 const {page,calls}=await pageFor(t,{ocr:({kind,route,cors})=>fail(route,cors,kind==='profile'?429:502)});
 await fillPublic(page,{manual:true,beforeContinue:async()=>{
  await page.getByText(/^Troppe richieste di lettura in questo momento. Lo screenshot è caricato/).waitFor();
  await page.getByText(/^Il servizio di lettura automatica non è disponibile in questo momento. Lo screenshot è caricato/).waitFor();
  await page.getByText(/inserire tu username, follower e i dati Insight/).waitFor();
 },step1:async()=>{
  await page.getByText('La lettura automatica del profilo non era disponibile: inserisci username e follower come appaiono nello screenshot.',{exact:true}).waitFor();
  assert.equal(await page.locator('#f-ig').inputValue(),'');assert.equal(await page.locator('#f-fol').inputValue(),'');
  await page.locator('#f-ig').fill('@manual.synthetic');await page.locator('#f-fol').fill('4300');
  await fillManualInsights(page);
 }});
 await submitAndConfirm(page);
 const [sent]=sentApplication(calls);validatePublicApplication(sent.body);
 assert.equal(sent.body.ocrInsights,null);assert.equal(sent.body.ocrProfile,null);
 assert.equal(sent.body.instagram,'@manual.synthetic');assert.equal(sent.body.followers,4300);
});

test('OCR timeout shows a clear message and the same screenshot can be read again without re-uploading',{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t,{clock:true,ocr:({kind,index})=>kind==='insights'&&index===0?new Promise(()=>{}):undefined});
 await fillPublic(page,{beforeContinue:async()=>{
  await page.getByText('Lettura automatica in corso…').waitFor();
  await page.clock.fastForward(31000);
  await page.getByText(/^La lettura automatica sta richiedendo troppo tempo. Lo screenshot è caricato/).waitFor();
  await page.getByRole('button',{name:'Riprova la lettura',exact:true}).click();
  await page.getByText('✓ Insight verificati',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Prosegui inserendo i dati a mano'}).count(),0);
 }});
 await submitAndConfirm(page);
 const [sent]=sentApplication(calls);
 assert.equal(sent.body.views,24800);assert.ok(sent.body.ocrInsights,'the successful retry is a real OCR read');
 assert.equal(calls.filter(c=>c.url===mockWorker+'/').length,3,'profile + timed-out read + one manual retry, no automatic retries');
});

test('Manual entry never bypasses mandatory screenshots or content checks',{timeout:60000},async t=>{
 // Schermata profilo sbagliata (errore di contenuto) + Insight non disponibile: nessun inserimento manuale.
 const {page}=await pageFor(t,{ocr:({kind,route,synthetic})=>kind==='profile'?synthetic({screen_type:'wrong_screen',displayName:null,username:null,followers:null}):route.abort('failed')});
 await page.getByRole('button',{name:/Candidati|candidatura/i}).first().click();
 const file={name:'synthetic.jpg',mimeType:'image/jpeg',buffer:await jpeg(page)};
 await page.getByLabel('Carica primo screenshot Insight',{exact:true}).setInputFiles(file);
 await page.getByText(/Connessione assente o instabile\./).waitFor();
 assert.equal(await page.getByRole('button',{name:'Prosegui inserendo i dati a mano'}).count(),0,'profile screenshot still required');
 await page.getByLabel('Carica screenshot profilo',{exact:true}).setInputFiles(file);
 await page.getByRole('dialog').getByText('Schermata non corretta',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Ho capito',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Prosegui inserendo i dati a mano'}).count(),0,'a wrong screen is not a technical failure');
 assert.equal(await page.getByRole('button',{name:'Continua con la candidatura'}).isDisabled(),true);
});

test('A replaced screenshot ignores the late OCR answer of the image it replaced',{timeout:60000},async t=>{
 let releaseFirst;const n=value=>({value,visibility:'complete'});
 const read=views=>({screen_type:'insights_ok',views:n(views),netFollowers:n(10),interactions:n(20),accountsReached:n(30)});
 const {page,calls}=await pageFor(t,{ocr:({kind,index,synthetic})=>kind!=='insights'?undefined
  :index===0?new Promise(resolve=>{releaseFirst=()=>resolve(synthetic(read(111)));}):synthetic(read(222))});
 await fillPublic(page,{beforeContinue:async()=>{
  await page.getByText('Lettura automatica in corso…').waitFor();
  const other={name:'replacement.jpg',mimeType:'image/jpeg',buffer:Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=40;c.height=40;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,40,40);return c.toDataURL('image/jpeg').split(',')[1];}),'base64')};
  await page.getByLabel('Carica primo screenshot Insight',{exact:true}).setInputFiles(other);
  await page.getByText('✓ Insight verificati',{exact:true}).waitFor();
  releaseFirst();await page.waitForTimeout(300);
 },step1:async()=>{assert.equal(await page.locator('#f-views').inputValue(),'222');}});
 await submitAndConfirm(page);
 const [sent]=sentApplication(calls);
 assert.equal(sent.body.views,222);assert.equal(sent.body.ocrInsights.merged.views,222);assert.equal(sent.body.screenshotName,'replacement.jpg');
});

test('Screenshots: each within 700,000 characters and the sum fitted to 900,000 before the form',{timeout:120000},async t=>{
 const {page,calls}=await pageFor(t,{ocr:({kind,synthetic})=>kind==='insights'?synthetic({screen_type:'insights_ok',views:{value:24800,visibility:'partial'},netFollowers:{value:260,visibility:'complete'},interactions:{value:1120,visibility:'complete'},accountsReached:{value:18400,visibility:'complete'}}):undefined});
 // Screenshot sintetici "densi" (testo e riquadri): ognuno resta sotto il limite singolo, ma insieme lo superano.
 const heavy=async seed=>({name:`heavy-${seed}.png`,mimeType:'image/png',buffer:Buffer.from(await page.evaluate(seed=>{
  let x=seed*7919;const rnd=()=>((x=(x*1103515245+12345)%2147483648)/2147483648);
  const c=document.createElement('canvas');c.width=1170;c.height=2532;const g=c.getContext('2d');
  g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);
  for(let i=0;i<5000;i++){g.fillStyle=`hsl(${rnd()*360},70%,${20+rnd()*60}%)`;g.font=`${10+rnd()*24}px sans-serif`;g.fillText(Math.floor(rnd()*1e9).toString(36),rnd()*c.width,rnd()*c.height);}
  for(let i=0;i<400;i++){g.fillStyle=`hsla(${rnd()*360},60%,50%,.5)`;g.fillRect(rnd()*c.width,rnd()*c.height,rnd()*120,rnd()*60);}
  return c.toDataURL('image/png').split(',')[1];
 },seed),'base64')});
 const files={profile:await heavy(1),ins1:await heavy(2)};
 await fillPublic(page,{files,beforeContinue:async()=>{
  await page.getByText('✓ Dati letti · da ricontrollare',{exact:true}).waitFor();
  await page.getByLabel('Carica secondo screenshot Insight',{exact:true}).setInputFiles(await heavy(3));
  await page.waitForFunction(()=>document.querySelectorAll('.u-thumb img').length===3&&![...document.querySelectorAll('.u-sub')].some(e=>/in corso/.test(e.textContent)));
  const sizes=await page.evaluate(()=>[...document.querySelectorAll('.u-thumb img')].map(i=>i.src.length));
  assert.ok(sizes.every(s=>s<=700000),`individual limit: ${sizes}`);
  assert.ok(sizes.reduce((a,b)=>a+b,0)>900000,`the three screenshots must exceed the total before fitting: ${sizes}`);
 }});
 await submitAndConfirm(page);
 const [sent]=sentApplication(calls);validatePublicApplication(sent.body);
 const total=sent.body.screenshotData.length+sent.body.screenshotData2.length+sent.body.profileScreenshotData.length;
 assert.ok(total<=900000,`total ${total}`);
 for(const k of ['screenshotData','screenshotData2','profileScreenshotData'])assert.ok(sent.body[k].length>=50000,`${k} still a usable image`);
});

/**
 * Attende che Babel abbia eseguito per intero i moduli richiesti (registrati nell'ultima riga di ciascun modulo)
 * e che i nomi usati dal test siano definiti. page.goto termina al "load", prima della compilazione di Babel.
 */
async function appReady(page,names,modules=['app/shared.jsx','app/public-form.jsx']){
 await page.waitForFunction(({names,modules})=>{
  try{ if(!modules.every(m=>CollectiveModules.has(m)))return false; }catch{ return false; }
  return names.every(n=>{try{return typeof (0,eval)(n)!=='undefined';}catch{return false;}});
 },{names,modules});
}

test('Screenshot fitting recompresses only when needed and reports when the sum cannot fit',{timeout:60000},async t=>{
 const {page}=await pageFor(t);
 await appReady(page,['compressImage','readFileAsDataURL','fitScreenshotsToLimit']);
 const result=await page.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=900;c.height=900;const g=c.getContext('2d');
  for(let i=0;i<900*900/40;i++){g.fillStyle=`rgb(${Math.random()*255|0},${Math.random()*255|0},${Math.random()*255|0})`;g.fillRect(Math.random()*900,Math.random()*900,3,3);}
  const blob=await new Promise(r=>c.toBlob(r,'image/png'));const file=new File([blob],'noise.png',{type:'image/png'});
  const data=await compressImage(await readFileAsDataURL(file));
  const slots=[{key:'a',data,file},{key:'b',data,file},{key:'c',data,file}];
  return {fits:await fitScreenshotsToLimit(slots,data.length*2),impossible:await fitScreenshotsToLimit(slots,30000),untouched:await fitScreenshotsToLimit(slots,data.length*3)};
 });
 assert.equal(result.untouched.ok,true);assert.deepEqual(result.untouched.data,{},'no recompression when the sum already fits');
 assert.equal(result.fits.ok,true);assert.ok(Object.keys(result.fits.data).length>=1);
 assert.equal(result.impossible.ok,false);
});

test('After HTTP 429 the candidate can correct a field and resend once, with a fresh idempotency key',{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t,{applicationResponses:[{status:429,body:{ok:false,error:'Troppe richieste, riprova più tardi'}},{status:201,body:{ok:true,id:'synthetic-after-429'}}]});
 await fillPublic(page);
 await page.getByRole('button',{name:'Invia la candidatura',exact:true}).click();
 await page.getByRole('alert').getByText('Troppi tentativi. Attendi prima di riprovare.',{exact:true}).waitFor();
 assert.equal(sentApplication(calls).length,1,'no automatic retry');
 await page.getByRole('button',{name:'Indietro',exact:true}).click();
 await page.locator('#f-bp').fill('Corrected after 429');
 await page.getByRole('button',{name:'Avanti',exact:true}).click();
 await submitAndConfirm(page);
 const sent=sentApplication(calls);assert.equal(sent.length,2);
 assert.notEqual(sent[0].headers['idempotency-key'],sent[1].headers['idempotency-key']);
 assert.equal(sent[1].body.boughtProducts,'Corrected after 429');
});

test('Timeout with an uncertain outcome: changed data are refused, the identical resend reuses the key',{timeout:90000},async t=>{
 let first=true;
 const {page,calls}=await pageFor(t,{clock:true,applicationResponses:[{status:200,body:{ok:true,id:'synthetic-replay',duplicate:true}}]});
 await page.route(`${mockWorker}/applications`,async route=>{
  if(route.request().method()==='POST'&&first){first=false;calls.push({url:route.request().url(),body:route.request().postDataJSON(),headers:route.request().headers()});return;}
  return route.fallback();
 });
 await fillPublic(page);
 await page.getByRole('button',{name:'Invia la candidatura',exact:true}).click();
 await page.clock.fastForward(31000);
 await page.getByRole('alert').getByText('Il salvataggio non è confermato. Controlla la connessione e riprova senza modificare i dati.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Indietro',exact:true}).click();
 await page.locator('#f-bp').fill('Changed while uncertain');
 await page.getByRole('button',{name:'Avanti',exact:true}).click();
 await page.getByRole('button',{name:'Invia la candidatura',exact:true}).click();
 await page.getByRole('alert').getByText(/Un invio precedente è ancora da confermare/).waitFor();
 assert.equal(sentApplication(calls).length,1,'the changed payload never left the browser');
 await page.getByRole('button',{name:'Indietro',exact:true}).click();
 await page.locator('#f-bp').fill('');
 await page.getByRole('button',{name:'Avanti',exact:true}).click();
 await submitAndConfirm(page);
 const sent=sentApplication(calls);assert.equal(sent.length,2);
 assert.equal(sent[0].headers['idempotency-key'],sent[1].headers['idempotency-key']);
});

/* ---------- Revisione Codex della PR #5: precheck, compressione, classificazione OCR ---------- */
// Trattiene le letture locali dei file (FileReader) finché il test non le rilascia: simula un telefono lento.
async function holdLocalReads(page){
 await page.evaluate(()=>{
  const original=FileReader.prototype.readAsDataURL;window.__heldReads=[];window.__holdReads=true;
  FileReader.prototype.readAsDataURL=function(file){if(!window.__holdReads)return original.call(this,file);window.__heldReads.push(()=>original.call(this,file));};
  window.__releaseReads=()=>{window.__holdReads=false;window.__heldReads.splice(0).forEach(run=>run());};
 });
}
async function syntheticImage(page,name){
 return {name,mimeType:'image/jpeg',buffer:Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=40;c.height=40;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,40,40);return c.toDataURL('image/jpeg').split(',')[1];}),'base64')};
}
async function denseScreenshot(page,seed){
 return {name:`dense-${seed}.png`,mimeType:'image/png',buffer:Buffer.from(await page.evaluate(seed=>{
  let x=seed*7919;const rnd=()=>((x=(x*1103515245+12345)%2147483648)/2147483648);
  const c=document.createElement('canvas');c.width=1170;c.height=2532;const g=c.getContext('2d');
  g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);
  for(let i=0;i<5000;i++){g.fillStyle=`hsl(${rnd()*360},70%,${20+rnd()*60}%)`;g.font=`${10+rnd()*24}px sans-serif`;g.fillText(Math.floor(rnd()*1e9).toString(36),rnd()*c.width,rnd()*c.height);}
  for(let i=0;i<400;i++){g.fillStyle=`hsla(${rnd()*360},60%,50%,.5)`;g.fillRect(rnd()*c.width,rnd()*c.height,rnd()*120,rnd()*60);}
  return c.toDataURL('image/png').split(',')[1];
 },seed),'base64')};
}
const partialInsights=({kind,synthetic})=>kind==='insights'?synthetic({screen_type:'insights_ok',views:{value:24800,visibility:'partial'},netFollowers:{value:260,visibility:'complete'},interactions:{value:1120,visibility:'complete'},accountsReached:{value:18400,visibility:'complete'}}):undefined;
const idle=page=>page.waitForFunction(()=>![...document.querySelectorAll('.u-sub')].some(e=>/in corso/.test(e.textContent)));
// Tre screenshot densi (somma oltre il limite): Continua avvia la ricompressione, che rileggerà i file originali.
async function startHeavyContinue(page){
 await page.getByRole('button',{name:/Candidati|candidatura/i}).first().click();
 await page.getByLabel('Carica screenshot profilo',{exact:true}).setInputFiles(await denseScreenshot(page,1));
 await page.getByLabel('Carica primo screenshot Insight',{exact:true}).setInputFiles(await denseScreenshot(page,2));
 await page.getByText('✓ Dati letti · da ricontrollare',{exact:true}).waitFor();
 await page.getByLabel('Carica secondo screenshot Insight',{exact:true}).setInputFiles(await denseScreenshot(page,3));
 await page.waitForFunction(()=>document.querySelectorAll('.u-thumb img').length===3);await idle(page);
 await holdLocalReads(page);
 await page.getByRole('button',{name:'Continua con la candidatura'}).click();
 await page.waitForFunction(()=>window.__heldReads.length>=1);
}

test('Replacing a screenshot invalidates its reading at once and blocks Continue while the new one is prepared',{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t);
 await fillPublic(page,{beforeContinue:async()=>{
  await page.getByText('✓ Insight verificati',{exact:true}).waitFor();
  const cont=page.getByRole('button',{name:'Continua con la candidatura'});
  assert.equal(await cont.isDisabled(),false);
  await holdLocalReads(page);
  await page.getByLabel('Carica primo screenshot Insight',{exact:true}).setInputFiles(await syntheticImage(page,'replacement.jpg'));
  await page.waitForFunction(()=>window.__heldReads.length===1);
  // Lettura locale ancora in corso: nessun risultato precedente, nessuna continuazione possibile.
  assert.equal(await cont.isDisabled(),true);
  assert.equal(await page.getByText('✓ Insight verificati',{exact:true}).count(),0);
  await page.getByText('Preparazione in corso…').waitFor();
  await page.evaluate(()=>window.__releaseReads());
  await page.getByText('✓ Insight verificati',{exact:true}).waitFor();
 }});
 await submitAndConfirm(page);
 assert.equal(sentApplication(calls)[0].body.screenshotName,'replacement.jpg');
});

for(const action of ['remove','replace'])test(`A screenshot ${action}d during the final compression never opens the form with the previous data`,{timeout:180000},async t=>{
 const {page}=await pageFor(t,{ocr:partialInsights});
 await startHeavyContinue(page);
 if(action==='remove')await page.getByRole('button',{name:'Rimuovi',exact:true}).nth(2).click();
 else await page.getByLabel('Carica secondo screenshot Insight',{exact:true}).setInputFiles(await syntheticImage(page,'late-replacement.jpg'));
 await page.evaluate(()=>window.__releaseReads());
 await idle(page);await page.waitForTimeout(1500);
 assert.equal(await page.locator('#f-age').count(),0,'the superseded continuation must not open the form');
 await page.getByRole('heading',{name:'Prepara i tuoi dati Instagram'}).waitFor();
 // Nuovo tentativo con gli screenshot attuali: il modulo si apre e contiene solo quelli.
 await page.getByRole('button',{name:'Continua con la candidatura'}).click();
 await page.locator('#f-age').fill('27',{timeout:120000});
 await page.locator('#f-email').fill('synthetic@example.test');await page.locator('#f-city').fill('Synthetic City');
 if(!await page.locator('#f-name').inputValue())await page.locator('#f-name').fill('Synthetic Candidate');
 await page.getByLabel('Coach / Personal trainer',{exact:true}).check();await page.locator('label.check input').check();
 await page.getByRole('button',{name:'Avanti',exact:true}).click();
 const thumbs=await page.evaluate(()=>[...document.querySelectorAll('.thumb-btn img')].map(i=>i.alt));
 assert.equal(thumbs.includes('Screenshot Insight 2'),action==='replace');
 if(action==='replace')assert.ok((await page.locator('img[alt="Screenshot Insight 2"]').getAttribute('src')).length<20000,'the late replacement, not the dense original');
});

test('Leaving the pre-check during the final compression never opens the form afterwards',{timeout:180000},async t=>{
 const {page,calls}=await pageFor(t,{ocr:partialInsights});
 await startHeavyContinue(page);
 await page.getByRole('button',{name:'Esci',exact:true}).click();
 await page.evaluate(()=>window.__releaseReads?.());
 // La ricompressione dei file densi prosegue anche dopo l'uscita: il modulo non deve comparire nemmeno quando termina.
 const opened=await page.locator('#f-age').waitFor({timeout:20000}).then(()=>true,()=>false);
 assert.equal(opened,false,'the form opened after leaving the pre-check');
 await page.getByRole('button',{name:/Candidati|candidatura/i}).first().waitFor();
 assert.equal(sentApplication(calls).length,0);
});

for(const status of [400,403,413])test(`OCR HTTP ${status} is not a temporary failure: no manual entry, clear guidance to replace the screenshot`,{timeout:60000},async t=>{
 const {page}=await pageFor(t,{ocr:({kind,route,cors})=>kind==='insights'?route.fulfill({status,headers:cors,contentType:'application/json',body:'{"error":{"message":"Richiesta non consentita"}}'}):undefined});
 await page.getByRole('button',{name:/Candidati|candidatura/i}).first().click();
 const file={name:'synthetic.jpg',mimeType:'image/jpeg',buffer:await jpeg(page)};
 await page.getByLabel('Carica screenshot profilo',{exact:true}).setInputFiles(file);
 await page.getByLabel('Carica primo screenshot Insight',{exact:true}).setInputFiles(file);
 const expected=status===413?/troppo pesante per la lettura automatica/:status===403?/non è autorizzata da questa pagina/:/non accetta questa immagine/;
 await page.getByRole('alert').getByText(expected).waitFor();
 await page.getByText('✓ Screenshot verificato',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Prosegui inserendo i dati a mano'}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Riprova la lettura'}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Continua con la candidatura'}).isDisabled(),true);
});

test('Compression keeps the real readability floors and refuses budgets it cannot reach',{timeout:60000},async t=>{
 const {page}=await pageFor(t);
 await appReady(page,['compressImageDetailed','MAX_STORED_BYTES','IMG_MIN_WIDTH','IMG_MIN_QUALITY']);
 const r=await page.evaluate(async()=>{
  const noisy=(w,h,cell)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');
   for(let y=0;y<h;y+=cell)for(let x=0;x<w;x+=cell){g.fillStyle=`rgb(${Math.random()*255|0},${Math.random()*255|0},${Math.random()*255|0})`;g.fillRect(x,y,cell,cell);}return c.toDataURL('image/png');};
  const at=async(d,max)=>{try{const o=await compressImageDetailed(d,max);return {width:o.width,height:o.height,quality:o.quality,length:o.dataUrl.length,max};}catch(e){return {error:e.message,max};}};
  const big=noisy(1400,2400,4),small=noisy(300,500,4);
  const free=await at(big,MAX_STORED_BYTES*10);
  // Budget via via più stretti: la larghezza non scende mai sotto 640 px né la qualità sotto 0,32; altrimenti rifiuto.
  const ladder=[];for(const f of [1,2,3,4,6,10])ladder.push(await at(big,Math.round(free.length/f)));
  return {minWidth:IMG_MIN_WIDTH,minQuality:IMG_MIN_QUALITY,free,ladder,impossible:await at(big,5000),
   smallTight:await at(small,2000),smallFree:await at(small,MAX_STORED_BYTES)};
 });
 assert.equal(r.minWidth,640);assert.equal(r.minQuality,0.32);
 assert.equal(r.free.width,1400);assert.equal(r.free.quality,0.82);
 for(const s of r.ladder){
  if(s.error){assert.match(s.error,/troppo grande/);continue;}
  assert.ok(s.width>=640,`width ${s.width}`);assert.ok(s.quality>=0.32,`quality ${s.quality}`);assert.ok(s.length<=s.max);
  if(s.width<1400)assert.equal(s.quality,0.32,'width shrinks only after the quality steps are exhausted');
 }
 assert.ok(r.ladder.some(s=>!s.error&&s.width<1400),'at least one budget required a narrower image');
 assert.ok(r.ladder.some(s=>!s.error&&s.width===640)||r.ladder.some(s=>s.error),'the floor is reached or the budget refused');
 assert.match(r.impossible.error,/troppo grande/,'an impossible budget is refused instead of going below the floors');
 assert.match(r.smallTight.error,/troppo grande/,'a narrow image is never shrunk below its own width');
 assert.equal(r.smallFree.width,300);assert.equal(r.smallFree.height,500);
});

/* ---------- Scoring v2: account raggiunti facoltativi, letture incerte, Admin ---------- */
const complete=value=>({value,visibility:'complete'});
const insightsRead=over=>({screen_type:'insights_ok',views:complete(24800),netFollowers:complete(260),interactions:complete(1120),accountsReached:complete(18400),...over});

test('Verified distinct-account layout: OCR response 1206/-1/54/250 reaches the form and submission unchanged',{timeout:60000},async t=>{
 // The visual model is mocked: this checks data flow, not image recognition accuracy.
 const {page,calls}=await pageFor(t,{ocr:({kind,synthetic})=>kind==='insights'
  ?synthetic(insightsRead({views:complete('1,206'),netFollowers:complete('-1'),interactions:complete('54'),accountsReached:complete('250')}))
  :undefined});
 await fillPublic(page,{step1:async()=>{
  for(const [key,value] of Object.entries({views:'1206',netFollowers:'-1',interactions:'54',accountsReached:'250'}))
   assert.equal(await page.locator('#f-'+key).inputValue(),value);
 }});
 await submitAndConfirm(page);
 const [sent]=sentApplication(calls);validatePublicApplication(sent.body);
 for(const [key,value] of Object.entries({views:1206,netFollowers:-1,interactions:54,accountsReached:250})){
  assert.equal(sent.body[key],value);
  assert.equal(sent.body.ocrInsights.merged[key],value);
 }
 assert.equal(sent.body.ocrInsights.conflicts.length,0);
});

test('Accounts reached not in the screenshot: one screenshot is enough, the field stays empty and is sent as null',{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t,{ocr:({kind,synthetic})=>kind==='insights'?synthetic(insightsRead({accountsReached:{value:null,visibility:'not_visible'}})):undefined});
 await fillPublic(page,{beforeContinue:async()=>{
  await page.getByText('È un dato facoltativo: puoi proseguire.',{exact:false}).first().waitFor();
  assert.equal(await page.getByRole('button',{name:'Continua con la candidatura'}).isDisabled(),false);
  assert.equal(await page.getByLabel('Carica secondo screenshot Insight',{exact:true}).count(),1,'a second screenshot is offered, not required');
  assert.equal(await page.getByText('alcuni dati non sono completamente visibili',{exact:false}).count(),0);
 },step1:async()=>{
  assert.equal(await page.locator('#f-accountsReached').inputValue(),'');
  assert.equal(await page.locator('#f-views').inputValue(),'24800');
 }});
 await page.getByText('Non indicato',{exact:true}).waitFor();   // riepilogo: nessuno zero mostrato
 await submitAndConfirm(page);
 const [sent]=sentApplication(calls);validatePublicApplication(sent.body);
 assert.equal(sent.body.accountsReached,null);assert.equal(sent.body.ocrInsights.merged.accountsReached,null);
 assert.equal(sent.body.views,24800);
});

test('Unreadable OCR values are never zero: a missing value asks for a second screenshot, which completes only that value',{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t,{ocr:({kind,index,synthetic})=>kind!=='insights'?undefined
  :index===0?synthetic(insightsRead({views:{value:'—',visibility:'complete'},accountsReached:{value:'non visibile'}}))
  :synthetic(insightsRead({views:complete('31.000'),netFollowers:{value:null,visibility:'not_visible'},interactions:{value:null,visibility:'not_visible'}}))});
 await fillPublic(page,{beforeContinue:async()=>{
  await page.getByText('alcuni dati non sono completamente visibili',{exact:false}).first().waitFor();
  assert.equal(await page.locator('.status-box strong',{hasText:'Visualizzazioni'}).count()>0,true);
  assert.equal(await page.getByRole('button',{name:'Continua con la candidatura'}).isDisabled(),true,'no invented value lets the candidate through');
  assert.equal(await page.getByRole('button',{name:'Prosegui inserendo i dati a mano'}).count(),1,'manual completion is offered, a second screenshot remains possible');
  await page.getByLabel('Carica secondo screenshot Insight',{exact:true}).setInputFiles({name:'second.jpg',mimeType:'image/jpeg',buffer:await jpeg(page)});
  await page.getByText('✓ Insight verificati',{exact:true}).waitFor();
 },step1:async()=>{
  assert.equal(await page.locator('#f-views').inputValue(),'31000');
  assert.equal(await page.locator('#f-interactions').inputValue(),'1120','the first reading is kept for the values it had');
  assert.equal(await page.locator('#f-accountsReached').inputValue(),'18400','completed by the second screenshot');
 }});
 await submitAndConfirm(page);
 const [sent]=sentApplication(calls);validatePublicApplication(sent.body);
 assert.equal(sent.body.views,31000);assert.equal(sent.body.ocrInsights.screenshot1.views.value,null);
 assert.equal(sent.body.ocrInsights.screenshot1.accountsReached.value,null);
});

test('OCR values without an explicit visibility are read but must be double-checked, never shown as verified',{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t,{ocr:({kind,synthetic})=>kind==='insights'?synthetic({screen_type:'insights_ok',views:'24.800',netFollowers:'+260',interactions:'1.120',accountsReached:'18.400'}):undefined});
 await fillPublic(page,{beforeContinue:async()=>{
  await page.getByText('✓ Dati letti · da ricontrollare',{exact:true}).waitFor();
  assert.equal(await page.getByText('✓ Insight verificati',{exact:true}).count(),0);
 },step1:async()=>{assert.equal(await page.locator('#f-views').inputValue(),'24800');}});
 await submitAndConfirm(page);
 const [sent]=sentApplication(calls);
 assert.equal(sent.body.ocrInsights.screenshot1.views.visibility,'partial');
});

test('Form step blocks empty or non-integer Insights values; zero and negative net followers are accepted',{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t);
 await fillPublic(page,{step1:async()=>{
  await page.locator('#f-views').fill('');await page.locator('#f-interactions').fill('12.5');
  await page.locator('#f-netFollowers').fill('0');await page.locator('#f-accountsReached').fill('');
  await page.getByRole('button',{name:'Avanti',exact:true}).click();
  await page.getByText('Dato mancante',{exact:true}).waitFor();
  await page.getByText('Inserisci un numero intero',{exact:true}).waitFor();
  assert.equal(await page.locator('#f-views').getAttribute('aria-invalid'),'true');
  assert.equal(await page.locator('#f-accountsReached').getAttribute('aria-invalid'),'false','optional and empty is valid');
  assert.equal(sentApplication(calls).length,0);
  await page.locator('#f-views').fill('24800');await page.locator('#f-interactions').fill('1120');
 }});
 await submitAndConfirm(page);
 const [sent]=sentApplication(calls);validatePublicApplication(sent.body);
 assert.equal(sent.body.netFollowers,0);assert.equal(sent.body.accountsReached,null);assert.equal(sent.body.interactions,1120);
});

test('Admin shows the v2 score, indicator B and low observation base; a correction keeps provenance and history',{timeout:60000},async t=>{
 const candidate=prepareApplication({...await publicFixture(),fullName:'Synthetic Score',views:400,interactions:6,accountsReached:null},{now:NOW});
 const {page}=await pageFor(t,{admin:true,candidate,allowWrites:true});
 const row=page.locator('button.row').filter({hasText:'Synthetic Score'});
 await row.getByText('Base ridotta',{exact:false}).waitFor();
 await row.click();
 await page.getByText('Punteggio quantitativo',{exact:true}).first().waitFor();
 await page.getByText('Interazioni / account raggiunti · non disponibile',{exact:true}).waitFor();
 await page.getByText('Base di osservazione molto ridotta',{exact:false}).first().waitFor();
 for(const old of ['Social Performance Score','Fascia ','Engagement Rate','Performance numerica'])
  assert.equal(await page.getByText(old,{exact:false}).count(),0,old);
 await page.getByText('Inserito dal candidato',{exact:false}).first().waitFor();
 await page.getByRole('button',{name:'Correggi dati Insights',exact:true}).click();
 assert.equal(await page.getByLabel('Account raggiunti',{exact:true}).inputValue(),'','never prefilled with views');
 await page.getByLabel('Visualizzazioni',{exact:true}).fill('');
 await page.getByRole('button',{name:'Salva e ricalcola',exact:true}).click();
 await page.getByText('Controlla i valori evidenziati.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.testCounters.writes),0,'an empty value is not saved as zero');
 await page.getByLabel('Visualizzazioni',{exact:true}).fill('400');
 await page.getByLabel('Account raggiunti',{exact:true}).fill('300');
 await page.getByRole('button',{name:'Salva e ricalcola',exact:true}).click();
 await page.getByText(/^Dati aggiornati\. Punteggio ricalcolato: \d+\/100$/).waitFor();
 const w=await page.evaluate(()=>window.testCounters.lastWrite);
 assert.equal(w.accountsReached,300);assert.equal(w.reachEngagementRate,2);assert.equal(w.scoringVersion,3);
 assert.equal(w.insightsHistory.length,1);assert.deepEqual(w.insightsHistory[0],w.insightsCorrection);
 assert.equal(w.insightsCorrection.previousValues.accountsReached,null);
 assert.ok(!('status' in w),'the application status is never changed by scoring');
 await page.getByText('Storico correzioni (1)',{exact:true}).waitFor();
 await page.getByText('Corretto dallo staff',{exact:false}).first().waitFor();
});

test('Historical application: v2 score shown, the previous stored score is labelled and nothing is written',{timeout:60000},async t=>{
 const candidate=await frontendDocument({fullName:'Synthetic Historic'});
 assert.equal(candidate.schemaVersion,4);assert.equal(typeof candidate.perfLevel,'string');
 const {page}=await pageFor(t,{admin:true,candidate});
 await page.locator('button.row').filter({hasText:'Synthetic Historic'}).click();
 await page.getByText(`Punteggio registrato all'invio con il modello precedente: ${candidate.socialScore}/100.`,{exact:false}).waitFor();
 await page.getByText('Interazioni / account raggiunti · non incide sul punteggio',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.testCounters.writes),0);
});

/* ---------- Completamento manuale dopo letture OCR incomplete (audit PR #6) ---------- */
const notVisible={value:null,visibility:'not_visible'};
test('Two incomplete Insight readings of a valid screen: the candidate completes only the missing values by hand',{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t,{ocr:({kind,synthetic})=>kind==='insights'?synthetic(insightsRead({views:notVisible,interactions:{value:'—',visibility:'complete'}})):undefined});
 await fillPublic(page,{manual:true,beforeContinue:async()=>{
  await page.getByText('alcuni dati non sono completamente visibili',{exact:false}).first().waitFor();
  await page.getByLabel('Carica secondo screenshot Insight',{exact:true}).setInputFiles({name:'second.jpg',mimeType:'image/jpeg',buffer:await jpeg(page)});
  await page.getByText('La schermata è corretta, ma non siamo riusciti a leggere tutti i dati richiesti',{exact:false}).first().waitFor();
  assert.equal(await page.getByRole('button',{name:'Continua con la candidatura'}).isDisabled(),true);
 },step1:async()=>{
  await page.getByText('Completa i dati Insight',{exact:true}).waitFor();
  assert.equal(await page.locator('#f-views').inputValue(),'');assert.equal(await page.locator('#f-interactions').inputValue(),'');
  assert.equal(await page.locator('#f-netFollowers').inputValue(),'260','values that were read are kept');
  // Senza i dati obbligatori non si prosegue.
  await page.getByRole('button',{name:'Avanti',exact:true}).click();
  await page.getByText('Dato mancante',{exact:true}).first().waitFor();
  await page.locator('#f-views').fill('23000');await page.locator('#f-interactions').fill('900');
 }});
 await submitAndConfirm(page);
 const [sent]=sentApplication(calls);validatePublicApplication(sent.body);
 assert.deepEqual([sent.body.views,sent.body.interactions,sent.body.netFollowers,sent.body.accountsReached],[23000,900,260,18400]);
 assert.equal(sent.body.ocrInsights.merged.views,null,'the OCR evidence shows the value was not read');
 assert.ok(sent.body.ocrInsights.screenshot2,'both readings are kept');
});

test('Profile screen read without the follower count: followers entered by hand, username kept',{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t,{ocr:({kind,synthetic})=>kind==='profile'?synthetic({screen_type:'profile_ok',displayName:{value:'Synthetic Candidate',visibility:'complete',truncated:false},username:{value:'synthetic',visibility:'complete',truncated:false},followers:{value:'—',visibility:'partial'}}):undefined});
 await fillPublic(page,{manual:true,beforeContinue:async()=>{
  await page.getByText('La schermata è corretta, ma non siamo riusciti a leggere tutti i dati richiesti',{exact:false}).first().waitFor();
  assert.equal(await page.locator('.status-box strong',{hasText:'Follower'}).count()>0,true);
 },step1:async()=>{
  await page.getByText('Non siamo riusciti a leggere tutti i dati del profilo: completa username e follower come appaiono nello screenshot.',{exact:true}).waitFor();
  assert.equal(await page.locator('#f-ig').inputValue(),'@synthetic');assert.equal(await page.locator('#f-fol').inputValue(),'');
  await page.getByRole('button',{name:'Avanti',exact:true}).click();
  await page.getByText('Inserisci il numero di follower',{exact:true}).waitFor();
  await page.locator('#f-fol').fill('7300');
 }});
 await submitAndConfirm(page);
 const [sent]=sentApplication(calls);validatePublicApplication(sent.body);
 assert.equal(sent.body.followers,7300);assert.equal(sent.body.ocrProfile.result.followers.value,null);
 assert.ok(sent.body.ocrInsights,'the complete Insight reading is kept');
});

test('Manual completion is never offered for wrong or uncertain screens',{timeout:60000},async t=>{
 const {page}=await pageFor(t,{ocr:({kind,index,synthetic})=>kind!=='insights'?undefined
  :index===0?synthetic(insightsRead({screen_type:'uncertain',views:notVisible})):synthetic({...insightsRead({views:notVisible}),screen_type:'dashboard_wrong'})});
 await page.getByRole('button',{name:/Candidati|candidatura/i}).first().click();
 const file={name:'synthetic.jpg',mimeType:'image/jpeg',buffer:await jpeg(page)};
 await page.getByLabel('Carica screenshot profilo',{exact:true}).setInputFiles(file);
 await page.getByLabel('Carica primo screenshot Insight',{exact:true}).setInputFiles(file);
 await page.getByText('alcuni dati non sono completamente visibili',{exact:false}).first().waitFor();
 assert.equal(await page.getByRole('button',{name:'Prosegui inserendo i dati a mano'}).count(),0,'uncertain screen');
 await page.getByLabel('Carica secondo screenshot Insight',{exact:true}).setInputFiles(file);
 await page.getByRole('dialog').getByText('Schermata non corretta',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Ho capito',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Prosegui inserendo i dati a mano'}).count(),0,'wrong screen');
 assert.equal(await page.getByRole('button',{name:'Continua con la candidatura'}).isDisabled(),true);
});

/* ---------- Ripristino: pagina nuova aperta con un Worker precedente ---------- */
test('Legacy endpoint rejection guidance: preserves the application if the candidate can add reach (not the rollback strategy)',{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t,{applicationResponses:[{status:400,body:{ok:false,error:{code:'TYPE',path:'$.accountsReached'}}},{status:201}],
  ocr:({kind,synthetic})=>kind==='insights'?synthetic(insightsRead({accountsReached:notVisible})):undefined});
 await fillPublic(page);
 await page.getByRole('button',{name:'Invia la candidatura',exact:true}).click();
 await page.getByText('In questo momento serve anche questo dato: inseriscilo come appare nello screenshot e invia di nuovo.',{exact:true}).waitFor();
 assert.equal(await page.locator('#f-accountsReached').getAttribute('aria-invalid'),'true');
 await page.locator('#f-accountsReached').fill('15000');
 for(let i=0;i<5;i++)await page.getByRole('button',{name:'Avanti',exact:true}).click();
 await page.locator('label.check input').check();
 await submitAndConfirm(page);
 const sent=sentApplication(calls);
 assert.equal(sent.length,2);assert.equal(sent[0].body.accountsReached,null);assert.equal(sent[1].body.accountsReached,15000);
 assert.notEqual(sent[0].headers['idempotency-key'],sent[1].headers['idempotency-key'],'a definitive 400 allows the corrected payload');
});

test('Compatibility rollback: a new page already open submits unavailable reach without inventing a value',{timeout:60000},async t=>{
 const services=rollbackServices(),originalFetch=globalThis.fetch;
 globalThis.fetch=services.fetch;t.after(()=>{globalThis.fetch=originalFetch;});
 const currentWorker=(await import('../../worker/src/worker.js?browser-rollback=current')).default;
 const compatWorker=(await import('../../worker/rollback/compat/worker/src/worker.js?browser-rollback=compat')).default;
 let activeWorker=currentWorker;const pending=[];
 const {page,calls}=await pageFor(t,{
  applicationHandler:request=>activeWorker.fetch(request,services.env,{waitUntil:p=>pending.push(p)}),
  ocr:({kind,synthetic})=>kind==='insights'?synthetic(insightsRead({accountsReached:notVisible})):undefined
 });
 await fillPublic(page);
 assert.equal(sentApplication(calls).length,0,'la pagina è già aperta e compilata prima del ripristino');
 const pageState=await page.evaluate(()=>({url:location.href,started:performance.timeOrigin}));
 activeWorker=compatWorker; // Ripristino del runtime, senza ricaricare né modificare la pagina aperta.
 await submitAndConfirm(page);await Promise.all(pending);
 const sent=sentApplication(calls);assert.equal(sent.length,1);
 assert.equal(sent[0].body.accountsReached,null,'nessun valore inventato o richiesto al candidato');
 assert.deepEqual(await page.evaluate(()=>({url:location.href,started:performance.timeOrigin})),pageState,'nessun reload');
 assert.equal(services.store.size,1);
 const saved=[...services.store.values()][0];
 assert.equal(saved.accountsReached,null);assert.equal(saved.reachEngagementRate,null);
 assert.equal(saved.schemaVersion,5);assert.equal(saved.scoringVersion,3);assert.equal(saved.status,'new');
 assert.equal(services.calls.some(u=>u.includes('telegram')),false,'nessuna notifica reale');
 await assertNoFirebase(page);
});

test('Admin: zero views show the overall score as not available, the zero stays visible as data',{timeout:60000},async t=>{
 const candidate=prepareApplication({...await publicFixture(),fullName:'Synthetic Zero',views:0,interactions:0},{now:NOW});
 assert.equal(candidate.socialScore,null);assert.equal(candidate.views,0);
 const {page}=await pageFor(t,{admin:true,candidate});
 await page.locator('button.row').filter({hasText:'Synthetic Zero'}).click();
 await page.getByText('Punteggio non disponibile: con zero visualizzazioni il coinvolgimento non è calcolabile. Lo zero resta salvato come dato osservato.',{exact:true}).waitFor();
 assert.equal(await page.getByText('Punteggio non calcolabile',{exact:false}).count(),0,'not reported as missing data');
 assert.equal(await page.locator('div.kv').filter({hasText:'Visualizzazioni'}).first().locator('.kv-v').innerText().then(v=>v.split('\n')[0]),'0');
});

test('Benchmark editor linked/single controls, blocked crossing, persistence and reset draft only',{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t,{admin:true});
 await page.getByRole('button',{name:'Configurazione Scoring',exact:true}).click();await openConfigSection(page,'Formule attuali e parametri numerici (invariati)');
 const value=page.getByLabel('Valore benchmark',{exact:true});await value.waitFor();
 assert.equal(await value.inputValue(),'7');
 await page.getByLabel('Valore benchmark',{exact:true}).fill('7.5');assert.equal(await value.inputValue(),'7.5');
 await page.getByRole('button',{name:'Salva benchmark',exact:true}).click();await page.getByText('Benchmark salvati e verificati sul server. Punteggi numerici invariati.',{exact:true}).waitFor();
 let sent=calls.filter(c=>c.url.endsWith('/admin/benchmarks'));assert.deepEqual(sent[0].body.engagement[2],[7.5,14.5,26.5]);assert.equal(sent[0].headers.authorization,'Bearer synthetic-firebase-id-token');
 await page.reload();await page.getByRole('button',{name:'Configurazione Scoring',exact:true}).click();await openConfigSection(page,'Formule attuali e parametri numerici (invariati)');await value.waitFor();assert.equal(await value.inputValue(),'7.5');
 await page.getByLabel('Muovi insieme i 3 livelli').uncheck();await value.fill('15');await page.getByRole('alert').filter({hasText:'Modifica bloccata'}).waitFor();assert.equal(await value.inputValue(),'7.5');
 await value.fill('8');await page.getByRole('button',{name:'Salva benchmark',exact:true}).click();await page.getByText('Benchmark salvati e verificati sul server. Punteggi numerici invariati.',{exact:true}).waitFor();sent=calls.filter(c=>c.url.endsWith('/admin/benchmarks'));assert.deepEqual(sent.at(-1).body.engagement[2],[8,14.5,26.5]);
 await page.getByRole('button',{name:'Ripristina valori predefiniti',exact:true}).click();assert.equal(await value.inputValue(),'7');assert.equal(calls.filter(c=>c.url.endsWith('/admin/benchmarks')).length,2);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+5).slice(0,12).map(e=>[e.tagName,e.className,e.getBoundingClientRect().width]))));
 assert.equal(await page.evaluate(()=>window.testCounters.writes),0);assert.equal(calls.some(c=>/applications|notify|admin\/scoring/.test(c.url)),false);
});

for(const options of [{benchmarksReadError:true},{benchmarksSeed:{version:2}}])test('Benchmark unavailable data cannot silently overwrite configuration',{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t,{admin:true,...options});await page.getByRole('button',{name:'Configurazione Scoring',exact:true}).click();await openConfigSection(page,'Formule attuali e parametri numerici (invariati)');
 await page.getByText('Impossibile leggere i benchmark. Nessun valore è stato sostituito.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Salva benchmark',exact:true}).count(),0);assert.equal(calls.length,0);
});
for(const status of [400,401,403,503])test(`Benchmark HTTP ${status} never reports false persistence`,{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t,{admin:true,benchmarksResponse:{status}});await page.getByRole('button',{name:'Configurazione Scoring',exact:true}).click();await openConfigSection(page,'Formule attuali e parametri numerici (invariati)');
 await page.getByRole('button',{name:'Salva benchmark',exact:true}).click();
 if(status===401)await page.getByLabel('Codice di accesso',{exact:true}).waitFor();else await page.locator('.benchmark-page [role="alert"]').waitFor();
 assert.equal(await page.evaluate(()=>localStorage.getItem('syntheticBenchmarks')),null);assert.equal(calls.length,1);
});

test('Benchmark rendered curves use shared interpolation; page has no creator or candidate preview',{timeout:60000},async t=>{
 const candidate=prepareApplication({...await publicFixture(),fullName:'Synthetic Benchmark Must Stay Hidden'},{now:NOW});
 const {page,calls}=await pageFor(t,{admin:true,candidate});
 await page.getByRole('button',{name:'Configurazione Scoring',exact:true}).click();
 const panel=page.locator('.benchmark-page');await panel.getByLabel('Valore benchmark',{exact:true}).waitFor();
 const defaults=scoreLevels.benchmarks.defaults();
 async function verify(metric,config){
  const paths=await panel.locator('svg path[fill="none"]').evaluateAll(els=>els.map(el=>el.getAttribute('d')));assert.equal(paths.length,3);
  const top=scoreLevels.benchmarks.axisDefaults[metric];
  paths.forEach((path,j)=>{
   const coords=path.split(/[ML]/).filter(Boolean).map(pair=>pair.split(',').map(Number));assert.equal(coords.length,321);
   coords.forEach(([x,y],i)=>{const f=1000*Math.pow(500,i/320),v=scoreLevels.benchmarks.thresholds(config,metric,f)[j];assert.ok(Math.abs(x-(60+820*scoreLevels.benchmarks.axisPosition(f)))<1e-8);assert.ok(Math.abs(y-(300-260*v/top))<1e-8);});
  });
  assert.equal(await panel.locator('svg circle').count(),15);
 }
 for(const [metric,label,notice] of [['engagement','Engagement','soglie sperimentali non validate'],['reach','Reach','riferimenti storici provvisori'],['growth','Growth','riferimenti storici provvisori']]){
  await panel.getByRole('button',{name:label,exact:true}).click();await verify(metric,defaults);assert.ok((await panel.innerText()).includes(notice));
 }
 await panel.getByRole('button',{name:'Engagement',exact:true}).click();await panel.getByLabel('Valore benchmark',{exact:true}).fill('6.5');
 await verify('engagement',scoreLevels.benchmarks.edit(defaults,'engagement',2,0,6.5,true));
 assert.equal(await panel.locator('img,.row,[data-score-level],input[type=file]').count(),0);
 assert.equal((await panel.innerText()).includes(candidate.fullName),false);
 assert.equal((await panel.innerText()).includes('Esempio creator'),false);
 assert.equal(calls.length,0);assert.equal(await page.evaluate(()=>window.testCounters.writes),0);
});

for(const mode of ['fail','missing','mismatch'])test(`Benchmark save read-back ${mode} never confirms or overwrites the draft`,{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t,{admin:true});await page.getByRole('button',{name:'Configurazione Scoring',exact:true}).click();await page.getByLabel('Valore benchmark',{exact:true}).fill('7');
 await page.evaluate(mode=>window.testBenchmarkReadMode=mode,mode);await page.getByRole('button',{name:'Salva benchmark',exact:true}).click();await page.locator('.benchmark-page [role="alert"]').waitFor();
 assert.equal(await page.getByText('Benchmark salvati e verificati sul server. Punteggi numerici invariati.',{exact:true}).count(),0);
 assert.equal(await page.getByLabel('Valore benchmark',{exact:true}).inputValue(),'7');assert.equal(calls.length,1);assert.deepEqual(await page.evaluate(()=>window.testBenchmarkReads),['server','server']);
});
test('Benchmark extreme values persist with stable Y and identical table/graph after reopen and reload',{timeout:60000},async t=>{
 const legacy=scoreLevels.benchmarks.toDocument({...scoreLevels.benchmarks.defaults(),interpolation:'log-smoothstep-v1'});
 legacy.reach[2]={medium:33,good:77,excellent:135};
 const {page,calls}=await pageFor(t,{admin:true,benchmarksSeed:legacy});await page.getByRole('button',{name:'Configurazione Scoring',exact:true}).click();
 await page.getByText('Valori salvati conservati.',{exact:false}).waitFor();assert.equal(calls.length,0);
 const input=page.getByLabel('Valore benchmark',{exact:true}),svg=page.locator('.benchmark-page svg');
 assert.equal(await svg.getAttribute('data-axis-max'),'50');await input.fill('900');assert.equal(await svg.getAttribute('data-axis-max'),'50');await page.getByText('Valori fuori scala:',{exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:/^[+−-].*pp$/}).count(),0);
 await page.getByRole('button',{name:'Adatta scala ai valori',exact:true}).click();assert.equal(await svg.getAttribute('data-axis-max'),'2000');
 await page.getByRole('button',{name:'Salva benchmark',exact:true}).click();await page.getByText('Benchmark salvati e verificati sul server. Punteggi numerici invariati.',{exact:true}).waitFor();
 const persisted=await page.evaluate(()=>JSON.parse(localStorage.getItem('syntheticBenchmarks')));assert.deepEqual(persisted.engagement[2],{medium:900,good:907,excellent:919});assert.deepEqual(persisted.reach,legacy.reach);
 const curve=await svg.locator('path[fill="none"]').evaluateAll(els=>els.map(el=>el.getAttribute('d')));
 await page.getByRole('button',{name:'Candidature',exact:true}).click();await page.getByRole('button',{name:'Configurazione Scoring',exact:true}).click();await input.waitFor();assert.equal(await input.inputValue(),'900');assert.equal(await svg.getAttribute('data-axis-max'),'2000');assert.deepEqual(await svg.locator('path[fill="none"]').evaluateAll(els=>els.map(el=>el.getAttribute('d'))),curve);
 await page.reload();await page.getByRole('button',{name:'Configurazione Scoring',exact:true}).click();await input.waitFor();assert.equal(await input.inputValue(),'900');assert.equal(await svg.getAttribute('data-axis-max'),'2000');assert.deepEqual(await svg.locator('path[fill="none"]').evaluateAll(els=>els.map(el=>el.getAttribute('d'))),curve);
 const row=page.locator('.benchmark-table tbody tr').nth(2);assert.ok((await row.innerText()).includes('900%'));assert.equal(calls.length,1);
});
