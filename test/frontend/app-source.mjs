// Sorgenti del frontend: pagina pubblica (index.html), area staff (admin/index.html) e moduli in app/.
// Usato dai test che leggono il codice reale delle pagine, in entrambe le modalità di frontend-mode.json:
// "separated" (le pagine caricano i moduli) e "single-page" (ripristino: index.html contiene i moduli,
// admin/ rimanda a /#admin, app/ resta pubblicata per le pagine ancora in cache).
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../../',import.meta.url);
export const read=path=>readFile(new URL(path,root),'utf8');

export const MODE=JSON.parse(await read('frontend-mode.json')).mode;
assert.ok(['separated','single-page'].includes(MODE),`frontend-mode.json: modalità non valida ${MODE}`);
export const SINGLE_PAGE=MODE==='single-page';
export const publicPage=await read('index.html');
export const adminPage=await read('admin/index.html');
/** Moduli nell'ordine di caricamento: le pagine caricano un sottoinsieme di questo elenco. */
export const APP_MODULES=['app/shared.jsx','app/public-form.jsx','app/admin.jsx','app/public-main.jsx','app/admin-main.jsx'];
export const modules=Object.fromEntries(await Promise.all(APP_MODULES.map(async m=>[m,await read(m)])));
export const shared=modules['app/shared.jsx'],publicForm=modules['app/public-form.jsx'],admin=modules['app/admin.jsx'];
/** Codice effettivamente pubblicato, una sola volta, per i controlli che valgono per tutto il frontend.
 * Nella pagina unica i moduli sono già dentro index.html (identici ai file app/: lo verifica separation.test.mjs). */
export const frontendSource=SINGLE_PAGE?[publicPage,adminPage].join('\n'):[publicPage,adminPage,...APP_MODULES.map(m=>modules[m])].join('\n');

/** Testo da `start` (incluso) a `end` (escluso); `end` null indica la fine del sorgente. */
export function between(source,start,end){
 const a=source.indexOf(start),b=end===null?source.length:source.indexOf(end,a);
 assert.ok(a>=0&&b>a,`Frammento del frontend non trovato: ${start}`);
 return source.slice(a,b);
}
/** Moduli app/ caricati da una pagina, nell'ordine dei tag script. */
export function pageModules(page){
 return [...page.matchAll(/<script type="text\/babel" src="(?:\.\.\/)?(app\/[a-z-]+\.jsx)\?v=([0-9a-f]{16})"><\/script>/g)].map(m=>({module:m[1],version:m[2]}));
}
