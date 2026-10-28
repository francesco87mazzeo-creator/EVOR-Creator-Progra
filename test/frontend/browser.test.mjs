import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {validatePublicApplication,prepareApplication} from '../../server/collective/application.mjs';
import {publicFixture,NOW} from '../../server/collective/test/frontend-reference.mjs';
import {SINGLE_PAGE} from './app-source.mjs';
import {buildSinglePage,buildAdminPage} from '../../tools/frontend-mode.mjs';
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
const adminScoringClient=await readFile(new URL('../../public/admin-scoring-client.js',import.meta.url),'utf8');
const js={
 'https://unpkg.com/react@18.3.1/umd/react.production.min.js':await readFile(`${assets}/node_modules/react/umd/react.production.min.js`),
 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js':await readFile(`${assets}/node_modules/react-dom/umd/react-dom.production.min.js`),
 'https://unpkg.com/@babel/standalone@8.0.9/babel.min.js':await readFile(babelRequire.resolve('@babel/standalone/babel.min.js'))
};
const firebaseStub=`(function(){
 const counters=window.testCounters=window.testCounters||{reads:0,writes:0};
 const candidate=__CANDIDATE__,allowWrites=__ALLOW_WRITES__;
 const session=window.testSession={signIns:0,signOuts:0},listeners=[];
 const user={uid:'staff-admin',getIdToken:async()=> 'synthetic-firebase-id-token',getIdTokenResult:async()=>({claims:{role:'admin'}})};
 const notify=()=>listeners.forEach(cb=>cb(auth.currentUser));
 const auth={currentUser:__SIGNED_IN__?user:null,setPersistence:async()=>{},
 onAuthStateChanged(cb){listeners.push(cb);Promise.resolve().then(()=>cb(auth.currentUser));return()=>{const i=listeners.indexOf(cb);if(i>=0)listeners.splice(i,1);};},
 async signInWithCustomToken(token){if(token!=='synthetic-custom-token')throw Error('Unexpected custom token');session.signIns++;auth.currentUser=user;notify();},
 async signOut(){session.signOuts++;auth.currentUser=null;notify();}};
 // Like the production Rules: reads without a signed-in staff user are denied.
 const read=async()=>{if(!auth.currentUser)throw Object.assign(Error('Missing or insufficient permissions.'),{code:'permission-denied'});counters.reads++;return{exists:false,docs:candidate?[{id:"synthetic-id",data:()=>candidate}]:[]};};
 const write=patch=>{counters.writes++;if(allowWrites){counters.lastWrite=patch;return Promise.resolve();}throw Error('Unexpected Firestore write');};
 const db={collection(){return{doc(){return{get:read,set:write,update:write,delete:write};},orderBy(){return{get:read};}};}};
 window.firebase={initializeApp(config){if(config.projectId!=="evora-athletes")throw Error("Production Firebase blocked by test harness");window.testFirebaseConfig=config;},firestore:()=>db,auth:Object.assign(()=>auth,{Auth:{Persistence:{LOCAL:'local'}}})};
})();`;
let browser;
before(async()=>{browser=await chromium.launch({executablePath:process.env.EVORA_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--host-resolver-rules=MAP * ~NOTFOUND']});});
after(async()=>browser?.close());
async function pageFor(t,{admin=false,applicationResponse,scoringResponse,candidate=null,allowWrites=false,configuration=workerConfig,bootFailure=false,signedIn=true,expectBlocked=false,moduleOverrides={},expectErrors=false,entry=null}={}) {
 const context=await browser.newContext({serviceWorkers:'block'});t.after(()=>context.close());
 const page=await context.newPage();t.after(()=>page.close());
 const calls=[],errors=[],blocked=[],served=[];
 page.on('pageerror',e=>errors.push(e.message));
 if(signedIn)await page.addInitScript(()=>localStorage.setItem('evora_login_at',String(Date.now())));
 await context.route('**/*',async route=>{
  const req=route.request(),url=req.url();
  const cors={'Access-Control-Allow-Origin':mockOrigin,'Access-Control-Allow-Headers':'Content-Type,Idempotency-Key,X-Turnstile-Token,Authorization','Access-Control-Allow-Methods':'POST,OPTIONS'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
  if(url===mockOrigin+'/public/worker-config.js')return route.fulfill({contentType:'text/javascript',body:configuration});
  if(url===mockOrigin+'/public/applications-client.js')return route.fulfill({contentType:'text/javascript',body:client});
  if(url===mockOrigin+'/public/admin-scoring-client.js')return route.fulfill({contentType:'text/javascript',body:adminScoringClient});
  if(url.startsWith(mockOrigin+'/')){
   const path=new URL(url).pathname,file=sitePath[path]||(path.startsWith('/app/')&&site[path.slice(1)]!==undefined?path.slice(1):null);
   if(file){served.push(file);return route.fulfill({contentType:contentType(file),body:moduleOverrides[file]??site[file]});}
  }
  // Come unpkg (CORS *): con crossorigin il browser verifica davvero gli hash integrity delle pagine.
  if(js[url])return route.fulfill({contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:js[url]});
  if(url.startsWith('https://www.gstatic.com/firebasejs/'))return route.fulfill({contentType:'text/javascript',body:firebaseStub.replace('__CANDIDATE__',JSON.stringify(candidate)).replace('__ALLOW_WRITES__',JSON.stringify(allowWrites)).replace('__SIGNED_IN__',JSON.stringify(signedIn))});
  if(url.startsWith('https://fonts.'))return route.fulfill({contentType:'text/css',body:''});
  if(req.method()==='POST') {
   assert.equal(new URL(url).origin,mockWorker,'Every POST must be intercepted at the mocked Worker origin');
   calls.push({url,body:req.postDataJSON(),headers:req.headers()});
   if(url===mockWorker+'/auth'&&req.postDataJSON()?.code==='synthetic-admin-code')return route.fulfill({status:200,headers:cors,contentType:'application/json',body:JSON.stringify({ok:true,role:'admin',token:'synthetic-custom-token'})});
   if(url===mockWorker+'/auth')return route.fulfill({status:401,headers:cors,contentType:'application/json',body:'{}'});
   if(url===mockWorker+'/notify')return route.fulfill({status:403,headers:cors,contentType:'application/json',body:'{"ok":false}'});
   if(url.endsWith('/admin/scoring'))return route.fulfill({status:scoringResponse?.status||200,headers:cors,contentType:'application/json',body:JSON.stringify(scoringResponse?.body||{ok:true})});
   if(url.endsWith('/applications'))return route.fulfill({status:applicationResponse?.status||201,headers:cors,contentType:'application/json',body:JSON.stringify(applicationResponse?.body||{ok:true,id:'synthetic-result'})});
   if(url===mockWorker+'/') {
    const prompt=req.postDataJSON().messages[0].content[1].text;
    const n=value=>({value,visibility:'complete'});
    const result=prompt.includes('displayName')?{screen_type:'profile_ok',displayName:{value:'Synthetic Candidate',visibility:'complete',truncated:false},username:{value:'synthetic',visibility:'complete',truncated:false},followers:n(8500)}:
     {screen_type:'insights_ok',views:n(24800),netFollowers:n(260),interactions:n(1120),accountsReached:n(18400)};
    return route.fulfill({headers:cors,contentType:'application/json',body:JSON.stringify({content:[{text:JSON.stringify(result)}]})});
   }
  }
  // No network escape: unexpected requests are aborted locally and fail the test.
  blocked.push(req.method()+' '+url);
  return route.abort('blockedbyclient');
 });
 // L'area staff si apre dall'indirizzo storico /#admin: reindirizza ad admin/, oppure resta sulla pagina unica nel ripristino.
 // entry: percorso di ingresso con caricamento completo (per esempio '/admin/'); navigations conta i caricamenti del documento.
 const navigations={count:0};page.on('framenavigated',f=>{if(f===page.mainFrame())navigations.count++;});
 await page.goto(`${mockOrigin}${entry??(admin?'/#admin':'/')}`);
 if(admin&&!SINGLE_PAGE)await page.waitForURL(`${mockOrigin}/admin/`);
 if(!expectBlocked)t.after(()=>assert.deepEqual(blocked,[],'No request may leave the test harness'));
 if(!expectErrors)t.after(()=>bootFailure?assert.ok(errors.some(e=>e.includes('Invalid production configuration'))):assert.deepEqual(errors,[],'No uncaught browser errors'));
 return{page,calls,blocked,served,errors,navigations};
}
/** Pagina pubblica: nessun SDK Firebase caricato, quindi nessuna lettura o scrittura possibile.
 * Nella pagina unica (ripristino) Firebase si carica come prima della separazione: nessuna lettura o scrittura. */
async function assertNoFirebase(page){
 if(SINGLE_PAGE)return assert.deepEqual(await page.evaluate(()=>window.testCounters),{reads:0,writes:0});
 assert.deepEqual(await page.evaluate(()=>({firebase:typeof window.firebase,counters:typeof window.testCounters})),{firebase:'undefined',counters:'undefined'});
}
async function jpeg(page){return Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=30;c.height=30;c.getContext('2d').fillRect(0,0,30,30);return c.toDataURL('image/jpeg').split(',')[1];}),'base64');}
async function fillPublic(page,{age='27',profileOnly=false}={}) {
 await page.getByRole('button',{name:/Candidati|candidatura/i}).first().click();
 await page.getByRole('heading',{name:'Prepara i tuoi dati Instagram'}).waitFor();
 const buffer=await jpeg(page),file={name:'synthetic.jpg',mimeType:'image/jpeg',buffer};
 await page.getByLabel('Carica screenshot profilo',{exact:true}).setInputFiles(file);
 await page.getByLabel('Carica primo screenshot Insight',{exact:true}).setInputFiles(file);
 await page.getByRole('button',{name:'Continua con la candidatura'}).click();
 await page.locator('#f-age').fill(age);await page.locator('#f-email').fill('synthetic@example.test');await page.locator('#f-city').fill('Synthetic City');
 await page.getByLabel('Coach / Personal trainer',{exact:true}).check();
 await page.locator('label.check input').check();
 if(profileOnly)return;
 const next=()=>page.getByRole('button',{name:'Avanti',exact:true}).click();
 await next();await next();
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
 await page.getByRole('button',{name:'Scoring',exact:true}).click();
 const weight=page.locator('input[type="number"]').first();await weight.fill('12');
 await page.getByRole('button',{name:'Ripristina valori iniziali',exact:true}).click();
 assert.equal(await weight.inputValue(),'45');assert.equal(calls.length,0);
 const reads=await page.evaluate(()=>window.testCounters.reads);
 await page.getByRole('button',{name:'Salva configurazione',exact:true}).click();
 await page.getByText('Configurazione salvata',{exact:true}).waitFor();
 const sent=calls.filter(c=>c.url.endsWith('/admin/scoring'));assert.equal(sent.length,1);
 assert.equal(sent[0].headers.authorization,'Bearer synthetic-firebase-id-token');
 assert.equal(sent[0].body.version,2);assert.equal(sent[0].body.weights.er,45);assert.equal(sent[0].body.bands[4].max,null);
 assert.deepEqual(await page.evaluate(()=>window.testCounters),{reads,writes:0});
});
for(const [status,message] of [[400,'Configurazione non valida. Controlla pesi, soglie e fasce.'],[403,'Non sei autorizzato a modificare lo scoring. È richiesto il ruolo admin.']]) {
 test(`Admin scoring HTTP ${status} shows error without saving or logging out`,{timeout:60000},async t=>{
  const {page,calls}=await pageFor(t,{admin:true,scoringResponse:{status,body:{error:'server internal detail'}}});
  await page.getByRole('button',{name:'Scoring',exact:true}).click();
  const weight=page.locator('input[type="number"]').first();await weight.fill('12');
  await page.getByRole('button',{name:'Salva configurazione',exact:true}).click();
  await page.getByText(message,{exact:true}).waitFor();
  assert.equal(await weight.inputValue(),'12');assert.equal(await page.getByText('Configurazione salvata',{exact:true}).count(),0);
  assert.equal(calls.filter(c=>c.url.endsWith('/admin/scoring')).length,1);assert.equal(await page.evaluate(()=>window.testCounters.writes),0);
 });
}
test('Admin scoring HTTP 401 ends local session and requests a new login',{timeout:60000},async t=>{
 const {page,calls}=await pageFor(t,{admin:true,scoringResponse:{status:401}});
 await page.getByRole('button',{name:'Scoring',exact:true}).click();
 await page.getByRole('button',{name:'Salva configurazione',exact:true}).click();
 await page.getByRole('heading',{name:'Accesso riservato',exact:true}).waitFor();
 await page.getByText('Sessione scaduta. Accedi nuovamente all’area riservata.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>localStorage.getItem('evora_login_at')),null);
 assert.equal(calls.filter(c=>c.url.endsWith('/admin/scoring')).length,1);assert.equal(await page.evaluate(()=>window.testCounters.writes),0);
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
 await page.getByRole('button',{name:'Scoring',exact:true}).waitFor();
 await page.getByRole('button',{name:'Form di prova',exact:true}).waitFor();
 assert.equal(page.url(),`${mockOrigin}/admin/`);
 await page.goto(`${mockOrigin}/#admin`);
 await page.getByRole('button',{name:'Scoring',exact:true}).waitFor();
 assert.equal(page.url(),`${mockOrigin}/#admin`);
});

// Pagine in cache durante le transizioni: ogni combinazione di index.html e admin/index.html di versioni diverse
// (separata S, ripristino R), con ingresso da /#admin o da /admin/, deve arrivare all'area staff senza rimbalzi.
for(const [entry,expected] of [['/#admin',{S:'/admin/',R:'/#admin'}],['/admin/',{S:'/admin/',R:'/admin/'}]])
 for(const idx of ['S','R'])for(const adm of ['S','R'])
  test(`Mixed cached pages: index ${idx} + admin ${adm}, entry ${entry} reaches the staff area without redirect loops`,{timeout:60000,skip:SINGLE_PAGE&&'frontend-mode.json = single-page: le pagine separate S non sono sul disco; matrice verificata in modalità separata'},async t=>{
   const overrides={...(idx==='R'?{'index.html':buildSinglePage()}:{}),...(adm==='R'?{'admin/index.html':buildAdminPage()}:{})};
   // Ingresso con caricamento completo, come da segnalibro o barra degli indirizzi (non un cambio di sola #).
   const {page,navigations:navs}=await pageFor(t,{moduleOverrides:overrides,entry});
   await page.getByRole('button',{name:'Scoring',exact:true}).waitFor({timeout:20000});
   await page.waitForTimeout(1500);
   assert.ok(navs.count<=2,`${navs.count} navigazioni: possibile reindirizzamento circolare`);
   const url=new URL(page.url());const landed=entry==='/#admin'?expected[idx]:expected[adm];
   assert.equal(url.pathname+url.hash,landed==='/#admin'?'/#admin':'/admin/');
   await page.getByRole('button',{name:'Scoring',exact:true}).waitFor();
  });

test('Staff page opens from admin/ and from the historical /#admin address',{skip:SINGLE_PAGE&&'frontend-mode.json = single-page: /#admin e /admin/ sono verificati dal test «Single-page rollback»'},async t=>{
 const {page,served}=await pageFor(t,{admin:true});
 assert.equal(page.url(),`${mockOrigin}/admin/`);
 await page.getByRole('button',{name:'Scoring',exact:true}).waitFor();
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
