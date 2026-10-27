import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePublicApplication,prepareApplication,parsePublicApplicationJson,PUBLIC_FIELDS,SERVER_FIELDS,ValidationError,MAX_JSON_BYTES} from '../application.mjs';
import {publicFixture,frontendDocument,fullOcr,NOW,JPEG} from './frontend-reference.mjs';
const fixture=await publicFixture();
const full=await publicFixture(fullOcr());
const copy=()=>structuredClone(full);
function denied(data,code,path) {
 assert.throws(()=>validatePublicApplication(data),error=>error instanceof ValidationError&&error.code===code&&(!path||error.path===path));
}
test('Server document matches all 71 fields of the historical frontend document',async()=>{
 const actual=prepareApplication(fixture,{now:NOW});
 assert.deepEqual(actual,await frontendDocument());assert.equal(Object.keys(actual).length,71);
});
test('Complete OCR candidate retains the same stored contract',async()=>{
 assert.deepEqual(prepareApplication(full,{now:NOW}),await frontendDocument(fullOcr()));
});
test('Missing optional fields get frontend-compatible defaults',()=>{
 const d=copy();for(const key of ['tiktok','tiktokFollowers','contentUrl1','contentUrl2','contentUrl3','screenshotName','screenshotName2','ocrInsights','ocrProfile','screenshotData2','profileScreenshotData','extra']) delete d[key];
 const result=prepareApplication(d,{now:NOW});
 assert.equal(result.tiktokFollowers,0);assert.equal(result.ocrInsights,null);assert.equal(result.extra,'');assert.equal(result.screenshotData2,'');
});
test('Every server field is rejected even with an apparently safe value',()=>{
 for(const key of SERVER_FIELDS) denied({...fixture,[key]:null},'SERVER_CONTROLLED_FIELD','$');
});
for(const key of PUBLIC_FIELDS) test(`Wrong object type/shape rejected for ${key}`,()=>denied({...full,[key]:{unexpected:true}},['ocrInsights','ocrProfile'].includes(key)?'UNKNOWN_FIELD':'TYPE',`$.${key}`));
// Error codes distinguish invalid types, unknown nested keys and invalid enum values.
for(const [name,patch,code,path] of [
 ['unknown key',{unknown:1},'UNKNOWN_FIELD','$'],['minor',{age:17},'RANGE','$.age'],
 ['fraction age',{age:18.5},'TYPE','$.age'],['false adult',{isAdult:false},'ENUM','$.isAdult'],
 ['false consent',{privacyConsent:false},'ENUM','$.privacyConsent'],['email',{email:'not-email'},'FORMAT','$.email'],
 ['blank required',{motivation:' \n '},'REQUIRED','$.motivation'],['text too long',{contentType:'a'.repeat(601)},'LENGTH','$.contentType'],
 ['negative views',{views:-1},'RANGE','$.views'],['NaN',{views:NaN},'TYPE','$.views'],['Infinity',{netFollowers:Infinity},'TYPE','$.netFollowers'],
 ['string count',{followers:'8500'},'TYPE','$.followers'],['fraction count',{followers:1.5},'TYPE','$.followers'],
 ['duplicate categories',{profileCategories:['coach','coach']},'DUPLICATE','$.profileCategories'],
 ['unknown category',{profileCategories:['unknown']},'ENUM','$.profileCategories'],
 ['empty categories',{profileCategories:[]},'LENGTH','$.profileCategories'],
 ['other detail',{profileCategories:['altro'],otherProfileCategory:''},'CONDITION','$.otherProfileCategory'],
 ['collab detail',{hasBrandCollabs:'yes',brandCollabDetails:''},'CONDITION','$.brandCollabDetails'],
 ['bad enum',{hasRoutine:'bogus'},'ENUM','$.hasRoutine'],
 ['script url',{contentUrl1:'javascript:alert(1)'},'FORMAT','$.contentUrl1'],
 ['URL credentials',{contentUrl1:'https://name:password@example.test/'},'FORMAT','$.contentUrl1'],
 ['wrong social host',{instagram:'https://example.test/name'},'FORMAT','$.instagram'],
 ['invalid handle',{instagram:'bad handle'},'FORMAT','$.instagram'],
 ['missing screenshot',{screenshotData:''},'REQUIRED','$.screenshotData'],
 ['bad image',{screenshotData:'data:image/png;base64,AAAA'},'FORMAT','$.screenshotData'],
 ['empty base64',{screenshotData:'data:image/jpeg;base64,'},'FORMAT','$.screenshotData'],
 ['bad padding',{screenshotData:'data:image/jpeg;base64,A='},'FORMAT','$.screenshotData'],
 ['large image',{screenshotData:'data:image/jpeg;base64,'+'A'.repeat(700000)},'LENGTH','$.screenshotData']
]) test(`Reject ${name}`,()=>denied({...fixture,...patch},code,path));
test('Required missing field has a structured error with no input value',()=>{
 const d=copy();delete d.email;denied(d,'MISSING_FIELD','$.email');
 try{validatePublicApplication({...fixture,email:'sensitive-value'});}catch(error){assert.ok(!error.message.includes('sensitive-value'));}
});
test('Image budget covers all three images',()=>{
 const d=copy();d.screenshotData='data:image/jpeg;base64,'+'A'.repeat(450000);d.screenshotData2=d.screenshotData;
 denied(d,'LENGTH','$.screenshots');
});
test('Zero counts and negative net followers are allowed',()=>{
 const d=validatePublicApplication({...fixture,followers:0,views:0,interactions:0,accountsReached:0,netFollowers:-1e12});
 assert.equal(d.netFollowers,-1e12);
});
test('Boundary lengths are accepted and overflow is rejected',()=>{
 const d={...fixture,fullName:'x'.repeat(199),threeWords:'x'.repeat(120),motivation:'x'.repeat(900)};
 validatePublicApplication(d);denied({...d,fullName:'x'.repeat(200)},'LENGTH','$.fullName');
});
test('Social links normalize as the frontend does, Unicode answers survive',()=>{
 const d=prepareApplication({...fixture,instagram:'https://www.instagram.com/synthetic/',tiktok:'https://www.tiktok.com/@synthetic',extra:'Città — EVORΛ 💪'},{now:NOW});
 assert.equal(d.instagram,'@synthetic');assert.equal(d.tiktok,'@synthetic');assert.equal(d.extra,'Città — EVORΛ 💪');
});
test('Input and output do not share mutable arrays or OCR objects',()=>{
 const d=copy(),before=structuredClone(d),result=validatePublicApplication(d);
 assert.deepEqual(d,before);result.profileCategories.push('altro');result.ocrInsights.merged.views=1;
 assert.deepEqual(d,before);
});
test('Root null, arrays, classes and reserved prototype keys are rejected',()=>{
 for(const value of [null,[],new Date()]) denied(value,'TYPE','$');
 denied(JSON.parse('{"__proto__":{"admin":true}}'),'UNKNOWN_FIELD','$');
});
test('Accessors, symbol keys and sparse lists cannot bypass the object schema',()=>{
 const d=copy();Object.defineProperty(d,'email',{enumerable:true,get(){throw new Error('Must not execute getter');}});denied(d,'TYPE','$');
 const s=copy();s[Symbol('private')]=true;denied(s,'UNKNOWN_FIELD','$');
 const a=copy();a.profileCategories=new Array(1);denied(a,'TYPE','$.profileCategories');
});
test('Trusted server clock is mandatory and calendar-valid',()=>{
 assert.throws(()=>prepareApplication(fixture),ValidationError);
 assert.throws(()=>prepareApplication(fixture,{now:'2026-02-30T12:00:00.000Z'}),e=>e.code==='FORMAT');
});
test('JSON parsing checks raw UTF-8 bytes, syntax and schema',()=>{
 assert.deepEqual(parsePublicApplicationJson(JSON.stringify(fixture)),validatePublicApplication(fixture));
 assert.throws(()=>parsePublicApplicationJson('{'),e=>e.code==='INVALID_JSON');
 assert.throws(()=>parsePublicApplicationJson('💪'.repeat(MAX_JSON_BYTES/4+1)),e=>e.code==='BODY_TOO_LARGE');
 assert.throws(()=>parsePublicApplicationJson(JSON.stringify({...fixture,role:'owner'})),e=>e.code==='UNKNOWN_FIELD');
});
const optionalFields=new Set(['otherProfileCategory','tiktok','tiktokFollowers','screenshotName','screenshotName2',
 'brandCollabDetails','athleteImage','valueBeyondContent','howWouldTell','scenarioBrandContent','badContentReaction',
 'analysisElements','boughtProducts','improvements','extra','contentUrl1','contentUrl2','contentUrl3','screenshotData2',
 'profileScreenshotData','ocrInsights','ocrProfile']);
for(const key of PUBLIC_FIELDS) test(`Missing-field contract for ${key}`,()=>{
 const d=structuredClone(fixture);delete d[key];
 if(key==='brandCollabDetails') denied(d,'CONDITION','$.brandCollabDetails');
 else if(optionalFields.has(key)) assert.doesNotThrow(()=>validatePublicApplication(d));
 else denied(d,'MISSING_FIELD',`$.${key}`);
});
test('All eight categories, age boundaries and maximum integer counts are accepted',()=>{
 for(const age of [18,99]) validatePublicApplication({...fixture,age,
  profileCategories:['creator','coach','agonista','non_agonista','lifestyle','palestra','professionista','altro'],otherProfileCategory:'Synthetic',
  followers:1e12,tiktokFollowers:1e12,views:1e12,netFollowers:1e12,interactions:1e12,accountsReached:1e12});
 denied({...fixture,age:100},'RANGE','$.age');denied({...fixture,fullName:'x'},'RANGE','$.fullName');
});
test('Additional properties on arrays are rejected',()=>{
 const d=copy();d.profileCategories.extra=true;denied(d,'TYPE','$.profileCategories');
});
