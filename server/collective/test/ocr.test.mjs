import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePublicApplication,ValidationError} from '../application.mjs';
import {publicFixture,fullOcr,NOW} from './frontend-reference.mjs';
const base=await publicFixture(fullOcr());
function check(mutate,code,path) {
 const valid=structuredClone(base);assert.doesNotThrow(()=>validatePublicApplication(valid));
 const d=structuredClone(valid);mutate(d);
 assert.throws(()=>validatePublicApplication(d),e=>e instanceof ValidationError&&e.code===code&&e.path===path);
 assert.doesNotThrow(()=>validatePublicApplication(valid));
}
for(const [name,mutate,code,path] of [
 ['extra OCR key',d=>{d.ocrInsights.extra=1;},'UNKNOWN_FIELD','$.ocrInsights'],
 ['missing screenshot',d=>{delete d.ocrInsights.screenshot1;},'MISSING_FIELD','$.ocrInsights.screenshot1'],
 ['missing numeric value',d=>{delete d.ocrInsights.screenshot1.views.value;},'MISSING_FIELD','$.ocrInsights.screenshot1.views.value'],
 ['nested object numeric',d=>{d.ocrInsights.screenshot1.views.value={x:1};},'TYPE','$.ocrInsights.screenshot1.views.value'],
 ['NaN OCR',d=>{d.ocrInsights.merged.views=NaN;},'TYPE','$.ocrInsights.merged.views'],
 ['infinite OCR',d=>{d.ocrInsights.merged.views=Infinity;},'TYPE','$.ocrInsights.merged.views'],
 ['large OCR count',d=>{d.ocrInsights.merged.views=1e12+1;},'RANGE','$.ocrInsights.merged.views'],
 ['unknown visibility',d=>{d.ocrInsights.screenshot1.views.visibility='verified';},'ENUM','$.ocrInsights.screenshot1.views.visibility'],
 ['unknown screen',d=>{d.ocrInsights.screenshot1.screenType='fake';},'ENUM','$.ocrInsights.screenshot1.screenType'],
 ['profile type',d=>{d.ocrProfile.result.screenType='insights_ok';},'ENUM','$.ocrProfile.result.screenType'],
 ['truncated type',d=>{d.ocrProfile.result.username.truncated='true';},'TYPE','$.ocrProfile.result.username.truncated'],
 ['profile name length',d=>{d.ocrProfile.result.displayName.value='a'.repeat(201);},'LENGTH','$.ocrProfile.result.displayName.value'],
 ['profile extra field',d=>{d.ocrProfile.result.followers.extra=true;},'UNKNOWN_FIELD','$.ocrProfile.result.followers'],
 ['readAt format',d=>{d.ocrProfile.readAt='yesterday';},'FORMAT','$.ocrProfile.readAt'],
 ['readAt calendar',d=>{d.ocrProfile.readAt='2026-02-30T12:00:00.000Z';},'FORMAT','$.ocrProfile.readAt'],
 ['conflicts type',d=>{d.ocrInsights.conflicts={};},'TYPE','$.ocrInsights.conflicts'],
 ['conflicts size',d=>{d.ocrInsights.conflicts=Array.from({length:5},()=>({key:'views',valueA:1,valueB:2}));},'LENGTH','$.ocrInsights.conflicts'],
 ['conflict key',d=>{d.ocrInsights.conflicts=[{key:'fake',valueA:1,valueB:2}];},'ENUM','$.ocrInsights.conflicts[0].key'],
 ['conflict value',d=>{d.ocrInsights.conflicts=[{key:'views',valueA:'1',valueB:2}];},'TYPE','$.ocrInsights.conflicts[0].valueA'],
 ['conflict extra',d=>{d.ocrInsights.conflicts=[{key:'views',valueA:1,valueB:2,extra:true}];},'UNKNOWN_FIELD','$.ocrInsights.conflicts[0]'],
 ['sparse conflicts',d=>{d.ocrInsights.conflicts=new Array(1);},'TYPE','$.ocrInsights.conflicts']
]) test(`OCR rejects ${name} for the expected reason`,()=>check(mutate,code,path));
test('Null OCR, partial values, truncated names, uncertain screenshots remain compatible',()=>{
 for(const variant of [
  {ocrInsights:null,ocrProfile:null},
  (()=>{const d=fullOcr();d.ocrInsights.screenshot2=null;d.ocrInsights.screenshot1.screenType='uncertain';d.ocrInsights.screenshot1.views.visibility='partial';d.ocrProfile.result.displayName.value=null;return d;})(),
  (()=>{const d=fullOcr();d.ocrInsights.conflicts=['views','netFollowers','interactions','accountsReached'].map(key=>({key,valueA:null,valueB:-1}));return d;})()
 ]) assert.doesNotThrow(()=>validatePublicApplication({...base,...variant}));
});
test('Every OCR numeric field rejects wrong types across both screenshots and merged data',()=>{
 for(const slot of ['screenshot1','screenshot2'])for(const key of ['views','netFollowers','interactions','accountsReached']) {
  check(d=>{d.ocrInsights[slot][key].value='bad';},'TYPE',`$.ocrInsights.${slot}.${key}.value`);
 }
 for(const key of ['views','netFollowers','interactions','accountsReached']) check(d=>{d.ocrInsights.merged[key]={};},'TYPE',`$.ocrInsights.merged.${key}`);
});
