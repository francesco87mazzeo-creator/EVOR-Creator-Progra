// Librerie esterne a versione esatta: una nuova release su unpkg non deve poter cambiare (o bloccare) il sito.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
const pages=[];
for(const page of ['index.html','admin/index.html']){
 try{await access(new URL(`../../${page}`,import.meta.url));pages.push(page);}catch{}
}
const scripts=async page=>[...(await readFile(new URL(`../../${page}`,import.meta.url),'utf8')).matchAll(/<script\b[^>]*\bsrc="(https?:[^"]+)"[^>]*>/g)].map(m=>({tag:m[0],src:m[1]}));

test('Every page loads external scripts only at exact versions',async()=>{
 assert.ok(pages.includes('index.html'));
 for(const page of pages)for(const {src} of await scripts(page)){
  const url=new URL(src);
  assert.ok(['unpkg.com','www.gstatic.com'].includes(url.host),`${page}: host non previsto ${url.host}`);
  if(url.host==='unpkg.com')assert.match(url.pathname,/^\/(?:@[a-z0-9-]+\/)?[a-z0-9.-]+@\d+\.\d+\.\d+\//,`${page}: versione non esatta ${src}`);
  else assert.match(url.pathname,/^\/firebasejs\/\d+\.\d+\.\d+\//,`${page}: versione non esatta ${src}`);
 }
});

test('unpkg scripts carry SRI integrity and anonymous CORS',async()=>{
 for(const page of pages)for(const {tag,src} of await scripts(page))if(src.startsWith('https://unpkg.com/')){
  assert.match(tag,/\bintegrity="sha384-[A-Za-z0-9+/]{64}"/,`${page}: integrity mancante ${src}`);
  assert.match(tag,/\bcrossorigin="anonymous"/,`${page}: crossorigin mancante ${src}`);
 }
});

test('All pages use the same pinned library versions',async()=>{
 // Una pagina senza librerie (il reindirizzamento di admin/ durante il ripristino) non entra nel confronto.
 const sets=(await Promise.all(pages.map(async p=>(await scripts(p)).filter(s=>s.src.startsWith('https://unpkg.com/')).map(s=>s.tag).join('\n')))).filter(Boolean);
 assert.ok(sets.length>=1);
 for(const s of sets)assert.equal(s,sets[0]);
});
