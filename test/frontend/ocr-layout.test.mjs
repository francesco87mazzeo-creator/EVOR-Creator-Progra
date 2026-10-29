// Deterministic contracts/parser tests. These do NOT measure vision accuracy on images.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {shared, publicForm, between} from './app-source.mjs';
import {prompts} from '../../worker/tools/frontend-prompts.mjs';
import {validateOcrInsights} from '../../server/collective/ocr.mjs';

const complete=value=>({value,visibility:'complete'});
const absent={value:null,visibility:'not_visible'};
const reading=(over={})=>({screen_type:'insights_ok',views:complete('1,206'),
  netFollowers:complete('-1'),interactions:complete('54'),accountsReached:complete('250'),...over});
const plain=value=>JSON.parse(JSON.stringify(value));
function harness(raw){
  const calls=[];
  const context={OCR_MODEL:'synthetic',ocrRequest:async body=>{calls.push(JSON.parse(body));return JSON.stringify(raw);}};
  vm.createContext(context);
  vm.runInContext(between(shared,'const toNum =','/**\n * Unisce')+
    between(shared,'const mergeInsights =','const readFileAsDataURL')+
    between(publicForm,'const extractInsights =','/* ============================================================================\n   3bis.')+
    between(publicForm,'const verifyFieldValue =','/* ============================================================================\n   8.')+
    '\nglobalThis.extract=extractInsights;globalThis.merge=mergeInsights;globalThis.verify=verifyFieldValue;',context);
  return {context,calls};
}
const image='data:image/jpeg;base64,synthetic';

test('OCR prompt: verified layout is contextual, reach and total views have separate sources',()=>{
  for(const prompt of [prompts.insights,prompts.verify('Account raggiunti')]){
    for(const label of ['Account raggiunti','Account che hanno visualizzato','Generale','Tutti i contenuti',
      'Visualizzazioni per tipo di contenuto','icona informativa','riga riepilogativa','prima','Follower/Non follower','Storie/Reel/Post'])
      assert.ok(prompt.toLowerCase().includes(label.toLowerCase()),label);
    assert.match(prompt,/card superiore/);
    assert.match(prompt,/ambigua/);
    assert.match(prompt,/null/);
    assert.match(prompt,/definizione/);
    assert.ok(prompt.length<=8000);
    assert.doesNotMatch(prompt,/1206|1[.,]206|\b250\b/,'no special casing of the reported values');
  }
  assert.match(prompts.insights,/Non sommare, sottrarre o dedurre/);
  assert.match(prompts.insights,/etichette esplicite restano valide anche in layout diversi/);
  assert.match(prompts.insights,/basato sul layout SENZA etichetta esplicita/);
  assert.match(prompts.insights,/verifiche DISTINTE/,'digit visibility cannot establish metric identity');
});

test('OCR parsing: 1206 views and 250 distinct accounts remain separate; net -1 preserved',async()=>{
  const {context,calls}=harness(reading());
  const result=plain(await context.extract(image));
  assert.deepEqual(Object.fromEntries(['views','netFollowers','interactions','accountsReached'].map(k=>[k,result[k].value])),
    {views:1206,netFollowers:-1,interactions:54,accountsReached:250});
  assert.equal(calls[0].messages[0].content[1].text,prompts.insights);
  assert.equal(calls[0].max_tokens,200);
  const merged=Object.fromEntries(Object.entries(plain(context.merge(result,null)).merged).map(([k,v])=>[k,v.value]));
  validateOcrInsights({screenshot1:result,screenshot2:null,merged,conflicts:[],readAt:'2026-10-29T10:00:00.000Z'});
});

for(const [label,value] of [['missing',absent],['ambiguous digits',{value:'250',visibility:'not_visible'}],
  ['missing number',{value:null,visibility:'complete'}],['dash',complete('—')]]){
  test(`OCR ${label}: no reach is invented from views or other numbers`,async()=>{
    const {context}=harness(reading({accountsReached:value}));
    const result=await context.extract(image);
    assert.equal(result.accountsReached.value,null);
    assert.equal(result.accountsReached.visibility,'not_visible');
    assert.equal(result.views.value,1206);
  });
}
test('OCR: actual zero and partial reach stay distinct from missing',async()=>{
  const zero=await harness(reading({accountsReached:complete('0')})).context.extract(image);
  assert.equal(zero.accountsReached.value,0);assert.equal(zero.accountsReached.visibility,'complete');
  const partial=await harness(reading({accountsReached:{value:'25',visibility:'partial'}})).context.extract(image);
  assert.equal(partial.accountsReached.value,25);assert.equal(partial.accountsReached.visibility,'partial');
});

test('Two screenshots: recover reach, never erase it, never sum; conflicting complete values are flagged',async()=>{
  const {context}=harness(reading());const full=plain(await context.extract(image));
  const missing={...full,accountsReached:absent};
  for(const [a,b] of [[missing,full],[full,missing],[full,full]]){
    const {merged,conflicts}=context.merge(a,b);
    assert.equal(merged.accountsReached.value,250);assert.equal(merged.views.value,1206);assert.equal(conflicts.length,0);
  }
  const other={...full,accountsReached:complete(251)};
  const {merged,conflicts}=context.merge(full,other);
  assert.equal(merged.accountsReached.value,250);
  assert.deepEqual(plain(conflicts),[{key:'accountsReached',valueA:250,valueB:251}]);
});
test('Single-field verification uses the updated prompt, preserves match/mismatch/unreadable outcomes',async()=>{
  for(const [raw,expected] of [[{readable:true,value:'250'},'match'],[{readable:true,value:'251'},'mismatch'],
    [{readable:false,value:null},'unreadable']]){
    const {context,calls}=harness(raw);
    const result=await context.verify(image,'Account raggiunti',250);
    assert.equal(result.outcome,expected);
    assert.equal(calls[0].messages[0].content[1].text,prompts.verify('Account raggiunti'));
  }
});
