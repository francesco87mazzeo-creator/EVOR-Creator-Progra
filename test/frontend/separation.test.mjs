// Separazione tra pagina pubblica (index.html) e area staff (admin/index.html): regole statiche.
// La raccolta candidature non deve caricare, né poter essere bloccata da, codice dell'area staff.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicPage,adminPage,modules,shared,publicForm,pageModules} from './app-source.mjs';

test('Public page loads only shared and public modules, staff page adds only its own',()=>{
 assert.deepEqual(pageModules(publicPage).map(m=>m.module),['app/shared.jsx','app/public-form.jsx','app/public-main.jsx']);
 assert.deepEqual(pageModules(adminPage).map(m=>m.module),['app/shared.jsx','app/public-form.jsx','app/admin.jsx','app/admin-main.jsx']);
});

test('Both pages request the same version of every module and of the styles',()=>{
 const versions=new Set([...pageModules(publicPage),...pageModules(adminPage)].map(m=>m.version));
 assert.equal(versions.size,1);
 const [v]=versions;
 assert.match(publicPage,new RegExp(`href="app/styles\\.css\\?v=${v}"`));
 assert.match(adminPage,new RegExp(`href="\\.\\./app/styles\\.css\\?v=${v}"`));
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
