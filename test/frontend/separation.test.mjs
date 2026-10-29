// Separazione tra pagina pubblica (index.html) e area staff (admin/index.html): regole statiche.
// La raccolta candidature non deve caricare, né poter essere bloccata da, codice dell'area staff.
// Con frontend-mode.json = "single-page" (ripristino) valgono invece le regole della pagina unica: i test
// della separazione sono saltati con il motivo esplicito, mai rimossi.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {publicPage,adminPage,modules,shared,publicForm,pageModules,APP_MODULES,SINGLE_PAGE} from './app-source.mjs';
import {PAGES,references,assetVersion,bootReferences} from '../../tools/asset-versions.mjs';
import {buildSinglePage,buildAdminPage,SINGLE_PAGE_MODULES,HEAD_META,CDN_SCRIPTS,FIREBASE_SCRIPTS,FIREBASE_BOOTSTRAP,REGISTRY_SCRIPT,SINGLE_PAGE_ROUTER} from '../../tools/frontend-mode.mjs';

const separatedOnly={skip:SINGLE_PAGE&&'frontend-mode.json = single-page: regola della separazione non applicabile durante il ripristino'};
const singlePageOnly={skip:!SINGLE_PAGE&&'frontend-mode.json = separated: regola del solo ripristino'};

test('Lazy staff dependencies are content-versioned for old cached HTML',()=>{
 const refs=bootReferences();assert.equal(refs.length,2);
 for(const r of refs)assert.equal(r.version,r.expected,r.file);
});

test('Public page loads only shared and public modules, staff page adds only its own',separatedOnly,()=>{
 assert.deepEqual(pageModules(publicPage).map(m=>m.module),['app/shared.jsx','app/public-form.jsx','app/public-main.jsx']);
 assert.deepEqual(pageModules(adminPage).map(m=>m.module),['app/shared.jsx','app/public-form.jsx','app/admin.jsx','app/admin-main.jsx']);
});

test('Every app/ reference carries the content hash of its file (node tools/asset-versions.mjs --write)',separatedOnly,()=>{
 const refs=PAGES.flatMap(references);
 assert.equal(refs.length,11,'4 riferimenti nella pagina pubblica, 7 nell\'area staff');
 const wrong=refs.filter(r=>r.version!==r.expected).map(r=>`${r.page}: ${r.file}?v=${r.version}, atteso ${r.expected}`);
 assert.deepEqual(wrong,[],'Un file app/ è cambiato senza aggiornare le pagine: eseguire node tools/asset-versions.mjs --write');
 // Ogni file app/ è usato da almeno una pagina; nessun riferimento senza versione.
 const used=new Set(refs.map(r=>r.file));
 for(const file of [...APP_MODULES,'app/styles.css'])assert.ok(used.has(file),`${file} non è referenziato`);
 for(const page of [publicPage,adminPage])assert.doesNotMatch(page,/(?:src|href)="(?:\.\.\/)?app\/[^"?]+"/);
});

test('A changed module produces a different version identifier',()=>{
 const hash=text=>createHash('sha256').update(text).digest('hex').slice(0,16);
 const source=modules['app/public-form.jsx'];
 assert.equal(hash(source),assetVersion('app/public-form.jsx'));
 assert.notEqual(hash(source+'\n'),assetVersion('app/public-form.jsx'));
});

test('Public page has no Firebase SDK, no staff client and no staff module',separatedOnly,()=>{
 assert.doesNotMatch(publicPage,/gstatic\.com|firebasejs|initializeApp|admin-scoring-client|app\/admin/);
 assert.match(adminPage,/firebase\.initializeApp\(firebaseConfig\)/);
 assert.match(adminPage,/<meta name="robots" content="noindex, nofollow">/);
});

test('Historical /#admin address redirects to admin/ before anything else loads',separatedOnly,()=>{
 const redirect=publicPage.indexOf('location.replace("admin/")');
 assert.ok(redirect>0&&redirect<publicPage.indexOf('<script src='),'il reindirizzamento precede ogni altro script');
});

test('Shared and public modules never call staff-only code',()=>{
 const staffCalls=/\b(?:FB|AUTH)\.\w+\(|\bsendTelegram\(|\bdb\.collection\(|\bauth\.(?:currentUser|signIn|signOut|onAuthStateChanged)|CollectiveAdminScoring\./;
 for(const [name,source] of [['app/shared.jsx',shared],['app/public-form.jsx',publicForm],['app/public-main.jsx',modules['app/public-main.jsx']]])
  assert.doesNotMatch(source,staffCalls,name);
});

test('Every module registers itself on its last line; routers render only with all modules',()=>{
 for(const name of ['app/shared.jsx','app/public-form.jsx','app/admin.jsx']){
  const last=modules[name].trimEnd().split('\n').at(-1);
  assert.equal(last,`CollectiveModules.add("${name}");`,name);
 }
 assert.match(modules['app/public-main.jsx'],/const REQUIRED_MODULES = \["app\/shared\.jsx","app\/public-form\.jsx"\];\nif \(REQUIRED_MODULES\.every\(m => CollectiveModules\.has\(m\)\)\) ReactDOM\.createRoot/);
 assert.match(modules['app/admin-main.jsx'],/const REQUIRED_MODULES = \["app\/shared\.jsx","app\/public-form\.jsx","app\/admin\.jsx"\];\nif \(REQUIRED_MODULES\.every\(m => CollectiveModules\.has\(m\)\)\) ReactDOM\.createRoot/);
 for(const page of [publicPage,adminPage].filter(p=>p.includes('const environment =')))
  assert.ok(page.indexOf('const CollectiveModules = new Set();')<page.indexOf('const environment ='));
});

/* ---------- Ripristino della pagina unica (tools/frontend-mode.mjs) ---------- */

test('The single-page rollback can always be generated from the current modules',()=>{
 const page=buildSinglePage();
 for(const m of SINGLE_PAGE_MODULES)assert.ok(page.includes(modules[m].trimEnd()),`${m} incluso senza modifiche`);
 assert.ok(page.includes(SINGLE_PAGE_ROUTER));
 assert.equal((page.match(/<script type="text\/babel">/g)||[]).length,1,'un solo script Babel: tutto o niente come prima della separazione');
 assert.ok(page.indexOf('const CollectiveModules = new Set();')<page.indexOf('const environment = CollectiveEnvironment.current;'));
 assert.ok(page.indexOf('firebase.initializeApp(firebaseConfig)')<page.indexOf('<script type="text/babel">'));
 assert.doesNotMatch(page,/(?:src|href)="(?:\.\.\/)?app\//,'nessuna dipendenza dai file app/');
 assert.ok(page.includes(CDN_SCRIPTS)&&page.includes(FIREBASE_SCRIPTS));
 // admin/: la stessa pagina unica con percorsi relativi alla cartella, noindex e area staff aperta dal percorso.
 const staff=buildAdminPage();
 assert.match(staff,/<meta name="robots" content="noindex, nofollow">/);
 for(const s of ['worker-config','applications-client'])assert.ok(staff.includes(`<script src="../public/${s}.js"></script>`));
 assert.ok(staff.includes(`public/admin-scoring-client.js?v=${assetVersion('public/admin-scoring-client.js')}`));
 assert.ok(staff.includes(`public/score-levels.js?v=${assetVersion('public/score-levels.js')}`));
 for(const m of SINGLE_PAGE_MODULES)assert.ok(staff.includes(modules[m].trimEnd()));
 assert.ok(staff.includes(SINGLE_PAGE_ROUTER));assert.match(SINGLE_PAGE_ROUTER,/const onAdminPath = /);
});

test('No page of the rollback redirects: /#admin and /admin/ cannot bounce between versions',()=>{
 for(const page of [buildSinglePage(),buildAdminPage()]){
  assert.doesNotMatch(page,/location\.(?:replace|assign)\(|location\.href\s*=\s*["']\.\.?\/?#admin|http-equiv="refresh"/i);
 }
 // L'unico reindirizzamento resta quello della pagina pubblica separata (/#admin → admin/), verso una pagina che non reindirizza.
 assert.doesNotMatch(SINGLE_PAGE_ROUTER,/location\.replace|#admin"\s*;?\s*\}/);
});

test('Rollback template matches the separated pages it replaces',separatedOnly,()=>{
 for(const page of [publicPage,adminPage])assert.ok(page.includes(HEAD_META)&&page.includes(CDN_SCRIPTS),'meta e librerie identiche');
 assert.ok(adminPage.includes(FIREBASE_SCRIPTS)&&adminPage.includes(FIREBASE_BOOTSTRAP)&&adminPage.includes(REGISTRY_SCRIPT));
 assert.ok(publicPage.includes(REGISTRY_SCRIPT));
});

test('During the rollback the pages are exactly the generated ones and app/ stays published',singlePageOnly,()=>{
 assert.equal(publicPage,buildSinglePage(),'index.html non allineata ai moduli app/: rieseguire node tools/frontend-mode.mjs single-page');
 assert.equal(adminPage,buildAdminPage(),'admin/index.html non allineata: rieseguire node tools/frontend-mode.mjs single-page');
 assert.deepEqual(PAGES.flatMap(references).filter(r=>r.file.startsWith('app/')),[],'nessun riferimento app/ nelle pagine del ripristino');
 // Le pagine separate ancora in cache (circa 10 minuti) richiedono questi file.
 for(const file of [...APP_MODULES,'app/styles.css'])assert.ok(existsSync(new URL(`../../${file}`,import.meta.url)),`${file} deve restare pubblicato`);
});
