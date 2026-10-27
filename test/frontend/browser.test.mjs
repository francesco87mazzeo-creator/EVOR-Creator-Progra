import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {validatePublicApplication} from '../../server/collective/application.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const assets=process.env.EVORA_BROWSER_ASSETS;
assert.ok(assets,'Set EVORA_BROWSER_ASSETS to the directory containing test-only node_modules (@babel/standalone, react@18, react-dom@18).');
const assetRequire=createRequire(`${assets}/package.json`);
const html=await readFile(new URL('../../index.html',import.meta.url),'utf8');
const client=await readFile(new URL('../../public/applications-client.js',import.meta.url),'utf8');
const adminScoringClient=await readFile(new URL('../../public/admin-scoring-client.js',import.meta.url),'utf8');
const js={
 'https://unpkg.com/react@18/umd/react.production.min.js':await readFile(`${assets}/node_modules/react/umd/react.production.min.js`,'utf8'),
 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js':await readFile(`${assets}/node_modules/react-dom/umd/react-dom.production.min.js`,'utf8'),
 'https://unpkg.com/@babel/standalone/babel.min.js':await readFile(assetRequire.resolve('@babel/standalone'),'utf8')
};
const firebaseStub=`(function(){
 const counters=window.testCounters=window.testCounters||{reads:0,writes:0};
 const auth={currentUser:{getIdToken:async()=> 'synthetic-firebase-id-token',getIdTokenResult:async()=>({claims:{role:'admin'}})},
 setPersistence:async()=>{},onAuthStateChanged(cb){Promise.resolve().then(cb);return()=>{};},signOut:async()=>{}};
 const read=async()=>{counters.reads++;return{exists:false,docs:[]};};
 const write=()=>{counters.writes++;throw Error('Unexpected Firestore write');};
 const db={collection(){return{doc(){return{get:read,set:write,update:write,delete:write};},orderBy(){return{get:read};}};}};
 window.firebase={initializeApp(){},firestore:()=>db,auth:Object.assign(()=>auth,{Auth:{Persistence:{LOCAL:'local'}}})};
})();`;
let browser;
before(async()=>{browser=await chromium.launch({executablePath:process.env.EVORA_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});});
after(async()=>browser?.close());
async function pageFor(t,{admin=false,applicationResponse,scoringResponse}={}) {
 const page=await browser.newPage();t.after(()=>page.close());
 const calls=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('evora_login_at',String(Date.now())));
 await page.route('**/*',async route=>{
  const req=route.request(),url=req.url();
  const cors={'Access-Control-Allow-Origin':'http://localhost:8043','Access-Control-Allow-Headers':'Content-Type,Idempotency-Key,X-Turnstile-Token,Authorization','Access-Control-Allow-Methods':'POST,OPTIONS'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
  if(url==='http://localhost:8043/public/applications-client.js')return route.fulfill({contentType:'text/javascript',body:client});
  if(url==='http://localhost:8043/public/admin-scoring-client.js')return route.fulfill({contentType:'text/javascript',body:adminScoringClient});
  if(url.startsWith('http://localhost:8043/'))return route.fulfill({contentType:'text/html',body:html});
  if(js[url])return route.fulfill({contentType:'text/javascript',body:js[url]});
  if(url.startsWith('https://www.gstatic.com/firebasejs/'))return route.fulfill({contentType:'text/javascript',body:firebaseStub});
  if(url.startsWith('https://fonts.'))return route.fulfill({contentType:'text/css',body:''});
  if(req.method()==='POST') {
   calls.push({url,body:req.postDataJSON(),headers:req.headers()});
   if(url.endsWith('/admin/scoring'))return route.fulfill({status:scoringResponse?.status||200,headers:cors,contentType:'application/json',body:JSON.stringify(scoringResponse?.body||{ok:true})});
   if(url.endsWith('/applications'))return route.fulfill({status:applicationResponse?.status||201,headers:cors,contentType:'application/json',body:JSON.stringify(applicationResponse?.body||{ok:true,id:'synthetic-result'})});
   if(url==='https://throbbing-feather-957f.francesco87-mazzeo.workers.dev/') {
    const prompt=req.postDataJSON().messages[0].content[1].text;
    const n=value=>({value,visibility:'complete'});
    const result=prompt.includes('displayName')?{screen_type:'profile_ok',displayName:{value:'Synthetic Candidate',visibility:'complete',truncated:false},username:{value:'synthetic',visibility:'complete',truncated:false},followers:n(8500)}:
     {screen_type:'insights_ok',views:n(24800),netFollowers:n(260),interactions:n(1120),accountsReached:n(18400)};
    return route.fulfill({headers:cors,contentType:'application/json',body:JSON.stringify({content:[{text:JSON.stringify(result)}]})});
   }
  }
  // No network escape: even unexpected requests are answered locally.
  return route.fulfill({status:403,body:'Blocked by test harness'});
 });
 await page.goto(`http://localhost:8043/${admin?'#admin':''}`);
 t.after(()=>assert.deepEqual(errors,[],'No uncaught browser errors'));
 return{page,calls};
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
 assert.deepEqual(await page.evaluate(()=>window.testCounters),{reads:0,writes:0});
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
 assert.deepEqual(await page.evaluate(()=>window.testCounters),{reads:0,writes:0});
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
