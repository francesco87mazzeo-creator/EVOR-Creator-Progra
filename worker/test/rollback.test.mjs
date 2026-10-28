import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {publicFixture} from '../../server/collective/test/frontend-reference.mjs';
import {post} from './helpers.mjs';
import {rollbackServices} from './rollback-services.mjs';
let instance=0;
const load=async()=> (await import(`../rollback/compat/worker/src/worker.js?rollback=${++instance}`)).default;
test('Rollback runtime: tutti gli otto moduli corrispondono al manifest congelato',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../rollback/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.sourceCommit,'c29d05b5d75f176906288c5bc16be0b7fe9f7bbc');
  assert.equal(Object.keys(manifest.files).length,8);
  const compatRoot=new URL('../rollback/compat/',import.meta.url);
  for(const [file,hash]of Object.entries(manifest.files)){
    const bytes=await readFile(new URL(`../rollback/compat/${file}`,import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),hash,file);
    for(const match of bytes.toString('utf8').matchAll(/from\s+["']([^"']+)["']/g)){
      const target=new URL(match[1],new URL(file,compatRoot));
      assert.ok(target.href.startsWith(compatRoot.href),`Import esterno allo snapshot: ${file}`);
      assert.ok(Object.hasOwn(manifest.files,target.href.slice(compatRoot.href.length)),`Modulo non incluso: ${file}`);
    }
  }
});
for(const [name,reach]of [['payload precedente',18400],['pagina nuova: reach nulla',null],['zero reale',0]]){
  test(`Rollback compatibile: ${name}, salvataggio e replay senza duplicati`,async()=>{
    const worker=await load(),services=rollbackServices(),original=globalThis.fetch;
    globalThis.fetch=services.fetch;
    try{
      const payload=await publicFixture({accountsReached:reach});
      const opts={origin:services.env.ALLOWED_ORIGIN,headers:{'Idempotency-Key':'rollback-synthetic-key-0001'}};
      const pending=[];const ctx={waitUntil:p=>pending.push(p)};
      const res=await worker.fetch(post('/applications',payload,opts),services.env,ctx);
      assert.equal(res.status,201);const created=await res.json();await Promise.all(pending);
      const replay=await worker.fetch(post('/applications',payload,opts),services.env,ctx);
      assert.equal(replay.status,200);const again=await replay.json();
      assert.equal(again.id,created.id);assert.equal(again.duplicate,true);assert.equal(services.store.size,1);
      const doc=services.store.get(created.id);assert.equal(doc.accountsReached,reach);assert.equal(doc.scoringVersion,3);assert.equal(doc.schemaVersion,5);
      assert.equal(doc.status,'new');assert.equal(services.calls.some(u=>u.includes('telegram')),false);
    }finally{globalThis.fetch=original;}
  });
}
test('Rollback compatibile: campi amministrativi restano vietati e origine non autorizzata respinta',async()=>{
  const worker=await load(),services=rollbackServices(),original=globalThis.fetch;globalThis.fetch=services.fetch;
  try{
    const payload=await publicFixture({accountsReached:null});
    const bad=await worker.fetch(post('/applications',{...payload,status:'approved'},{origin:services.env.ALLOWED_ORIGIN}),services.env,{});
    assert.equal(bad.status,400);
    const foreign=await worker.fetch(post('/applications',payload,{origin:'https://untrusted.example'}),services.env,{});
    assert.equal(foreign.status,403);assert.equal(services.store.size,0);
  }finally{globalThis.fetch=original;}
});
test('Rollback dopo un esito incerto: la chiave V2 già salvata viene riconosciuta dallo snapshot',async()=>{
  const current=(await import('../src/worker.js?rollback-cross-version')).default;
  const compat=await load(),services=rollbackServices(),original=globalThis.fetch;globalThis.fetch=services.fetch;
  try{
    const payload=await publicFixture({accountsReached:null});
    const opts={origin:services.env.ALLOWED_ORIGIN,headers:{'Idempotency-Key':'rollback-cross-version-0001'}};
    const pending=[];const ctx={waitUntil:p=>pending.push(p)};
    const first=await current.fetch(post('/applications',payload,opts),services.env,ctx);
    assert.equal(first.status,201);const created=await first.json();await Promise.all(pending);
    // La risposta può perdersi sulla rete: il browser ritenta la stessa chiave dopo il cambio di runtime.
    const retry=await compat.fetch(post('/applications',payload,opts),services.env,ctx);
    assert.equal(retry.status,200);const replay=await retry.json();
    assert.equal(replay.id,created.id);assert.equal(replay.duplicate,true);assert.equal(services.store.size,1);
    assert.equal(services.store.get(created.id).accountsReached,null);
  }finally{globalThis.fetch=original;}
});
