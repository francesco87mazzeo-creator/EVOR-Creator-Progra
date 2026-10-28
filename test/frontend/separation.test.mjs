// Separazione tra pagina pubblica (index.html) e area staff (admin/index.html): regole statiche.
// La raccolta candidature non deve caricare, né poter essere bloccata da, codice dell'area staff.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {publicPage,adminPage,modules,shared,publicForm,pageModules,APP_MODULES} from './app-source.mjs';
import {PAGES,references,assetVersion} from '../../tools/asset-versions.mjs';

test('Public page loads only shared and public modules, staff page adds only its own',()=>{
 assert.deepEqual(pageModules(publicPage).map(m=>m.module),['app/shared.jsx','app/public-form.jsx','app/public-main.jsx']);
 assert.deepEqual(pageModules(adminPage).map(m=>m.module),['app/shared.jsx','app/public-form.jsx','app/admin.jsx','app/admin-main.jsx']);
});

test('Every app/ reference carries the content hash of its file (node tools/asset-versions.mjs --write)',()=>{
 const refs=PAGES.flatMap(references);
 assert.equal(refs.length,9,'4 riferimenti nella pagina pubblica, 5 nell\'area staff');
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

test('Public page has no Firebase SDK, no staff client and no staff module',()=>{
 assert.doesNotMatch(publicPage,/gstatic\.com|firebasejs|initializeApp|admin-scoring-client|app\/admin/);
 assert.match(adminPage,/firebase\.initializeApp\(firebaseConfig\)/);
 assert.match(adminPage,/<meta name="robots" content="noindex, nofollow">/);
});

test('Historical /#admin address redirects to admin/ before anything else loads',()=>{
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
 for(const page of [publicPage,adminPage])assert.ok(page.indexOf('const CollectiveModules = new Set();')<page.indexOf('const environment ='));
});
