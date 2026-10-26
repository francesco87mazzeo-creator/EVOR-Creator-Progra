import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {submission,defaultScoring,completeOcr} from './frontend-fixture.mjs';
const rules=await readFile(new URL('../firestore.rules',import.meta.url),'utf8');
const frontend=await readFile(new URL('../../../index.html',import.meta.url),'utf8');
// Contract checks do not replace emulator compilation or authorization tests.
test('Rules key set exactly matches actual frontend submission (71 fields)',async()=>{
 const match=rules.match(/function applicationKeys\(d\) \{ return exact\(d, (\[[^\n]+\])/);
 assert.ok(match,'Explicit field schema missing');
 const fields=JSON.parse(match[1]);
 const d=await submission(completeOcr());
 assert.deepEqual(Object.keys(d).sort(),fields.sort());
 assert.equal(fields.length,71);
 for(const name of fields) assert.match(rules,new RegExp(`(?:d\\.${name}\\b|['"]${name}['"])`));
});
test('Frontend converts optional counts, persists initial management state and OCR evidence',async()=>{
 const d=await submission({...completeOcr(),tiktokFollowers:'',netFollowers:'-2'});
 assert.equal(d.tiktokFollowers,0);assert.equal(d.netFollowers,-2);
 assert.equal(d.status,'new');assert.equal(d.notes,'');assert.equal(d.creatorCode,'');
 assert.deepEqual(d.evaluation,{});assert.equal(d.schemaVersion,4);
 assert.equal(d.updatedAt,d.date);assert.ok(d.ocrProfile.result.username.truncated);
 assert.ok(d.profileScreenshotData.startsWith('data:image/jpeg;base64,'));
 assert.ok(!('id' in d));
});
test('Default scoring serializes final unlimited band as null and retains schema v2',()=>{
 const d=defaultScoring();assert.equal(d.version,2);assert.equal(d.bands.length,5);
 assert.equal(d.bands[4].max,null);assert.equal(d.levels.length,4);
 for(const b of d.bands) for(const metric of ['er','reach','growth']) {
  assert.ok(b[metric].avg < b[metric].good && b[metric].good < b[metric].excellent);
 }
});
test('Every top-level public payload field has a value-validation reference',async()=>{
 const d=await submission();
 // Exclude the key whitelist itself, otherwise this test would be tautological.
 const validation=rules.replace(/function applicationKeys[^\n]+\n/,'');
 for(const k of Object.keys(d)) assert.match(validation,new RegExp(`\\bd\\.${k}\\b`),k);
});
test('Current frontend Firestore operations are fully inventoried',()=>{
 const operations=[...frontend.matchAll(/db\.collection\("([^\"]+)"\)([^;]+);/g)].map(m=>[m[1],m[2].includes('.delete(')?'delete':m[2].includes('.update(')?'update':m[2].includes('.set(')?'set':'get']);
 assert.deepEqual(operations,[['candidature','get'],['candidature','set'],['candidature','update'],['candidature','delete'],['settings','get'],['settings','set'],['settings','get'],['settings','set']]);
});
test('Schema review document inventories every submitted field exactly once',async()=>{
 const schema=await readFile(new URL('../SCHEMA.md',import.meta.url),'utf8');
 const fields=[...schema.matchAll(/^\| `([^`]+)` \|/gm)].map(m=>m[1]);
 assert.deepEqual(fields.sort(),Object.keys(await submission()).sort());
});
