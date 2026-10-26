import {record,text,number,enumeration,url,iso,freeze,fail,array,ValidationError} from './validation.mjs';
import {validateOcrInsights,validateOcrProfile} from './ocr.mjs';
import {computeSocial} from './scoring.mjs';
export {ValidationError};
export const MAX_JSON_BYTES=1048576;
const CATEGORIES=['creator','coach','agonista','non_agonista','lifestyle','palestra','professionista','altro'];
const TEXT_FIELDS={
 fullName:[199,true],email:[199,true],city:[200,true],country:[200,true],
 otherProfileCategory:[200,false],instagram:[200,true],tiktok:[200,false],
 screenshotName:[255,false],screenshotName2:[255,false],threeWords:[120,true],
 contentType:[600,true],whatToTransmit:[600,true],whyFollow:[600,true],brandCollabDetails:[600,false],
 motivation:[900,true],brandLike:[600,true],contentIntegration:[900,true],
 athleteImage:[900,false],valueBeyondContent:[900,false],howWouldTell:[900,false],
 scenarioBrandContent:[900,false],badContentReaction:[900,false],analysisElements:[900,false],
 brandMeaning:[900,true],boughtProducts:[120,false],improvements:[600,false],extra:[600,false]
};
const ENUMS={
 hasBrandCollabs:['yes','no'],buildWithoutEarnings:['yes','yes_conditions','depends','paid_only'],
 contentPerMonth:['lt1','1-2','3-4','5+','depends'],hasRoutine:['yes','building','no'],
 followsGuidelines:['yes','mostly','no'],availEvents:['yes','no','maybe'],
 availShooting:['yes','no','maybe'],availUgc:['yes','no','maybe'],availRawFiles:['yes','no','maybe']
};
const COUNTS=['followers','tiktokFollowers','views','netFollowers','interactions','accountsReached'];
const LINKS=['contentUrl1','contentUrl2','contentUrl3'];
const IMAGES=['screenshotData','screenshotData2','profileScreenshotData'];
const OTHER=['age','isAdult','privacyConsent','profileCategories','ocrInsights','ocrProfile'];
export const PUBLIC_FIELDS=freeze([...Object.keys(TEXT_FIELDS),...Object.keys(ENUMS),...COUNTS,...LINKS,...IMAGES,...OTHER]);
export const SERVER_FIELDS=freeze(['id','schemaVersion','date','updatedAt','status','notes','creatorCode','evaluation',
 'socialScore','perfLevel','bandLabel','erRate','reachRate','growthRate',
 'instagramHandle','instagramUrl','tiktokHandle','tiktokUrl','insightsCorrection']);
const DEFAULTS=freeze({
 ...Object.fromEntries(Object.entries(TEXT_FIELDS).filter(([,v])=>!v[1]).map(([k])=>[k,''])),
 tiktokFollowers:0,contentUrl1:'',contentUrl2:'',contentUrl3:'',screenshotData2:'',profileScreenshotData:'',
 ocrInsights:null,ocrProfile:null
});
const REQUIRED=PUBLIC_FIELDS.filter(key=>!Object.hasOwn(DEFAULTS,key));
function image(value,path) {
 text(value,700000,path);
 if (value!=='' && !/^data:image\/jpeg;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail('FORMAT',path);
 if (value==='data:image/jpeg;base64,') fail('FORMAT',path);
 return value;
}
function social(value,network,path,required) {
 let handle=value.trim().replace(/^@+/,'');
 if (!handle) { if (required) fail('REQUIRED',path); return {handle:'',url:''}; }
 if (/^https?:\/\//i.test(handle) || /^(www\.)?(instagram|tiktok)\.com/i.test(handle)) {
  let parsed;
  try { parsed=new URL(/^https?:\/\//i.test(handle)?handle:`https://${handle}`); } catch { fail('FORMAT',path); }
  if (!['https:','http:'].includes(parsed.protocol) || parsed.username || parsed.password || ![`${network}.com`,`www.${network}.com`].includes(parsed.hostname)) fail('FORMAT',path);
  handle=(parsed.pathname.split('/').filter(Boolean)[0]||'').replace(/^@+/,'');
 }
 if (!/^[A-Za-z0-9._]+$/.test(handle)) fail('FORMAT',path);
 return {handle,url:network==='instagram'?`https://www.instagram.com/${handle}/`:`https://www.tiktok.com/@${handle}`};
}
export function validatePublicApplication(input) {
 // Reserved keys are rejected even if the submitted value equals a safe default.
 if (input && typeof input==='object') {
  const keys=Reflect.ownKeys(input);
  if (keys.some(key=>SERVER_FIELDS.includes(key))) fail('SERVER_CONTROLLED_FIELD','$');
 }
 record(input,PUBLIC_FIELDS,REQUIRED);
 const data={...DEFAULTS,...input};
 for (const [key,[limit,required]] of Object.entries(TEXT_FIELDS)) text(data[key],limit,`$.${key}`,required);
 if (data.fullName.length<2) fail('RANGE','$.fullName');
 for (const [key,options] of Object.entries(ENUMS)) enumeration(data[key],options,`$.${key}`);
 for (const key of COUNTS) number(data[key],key==='netFollowers'?-1e12:0,1e12,`$.${key}`,true);
 number(data.age,18,99,'$.age',true);
 enumeration(data.isAdult,[true],'$.isAdult');enumeration(data.privacyConsent,[true],'$.privacyConsent');
 array(data.profileCategories,1,8,'$.profileCategories');
 data.profileCategories.forEach(v=>enumeration(v,CATEGORIES,'$.profileCategories'));
 if (new Set(data.profileCategories).size!==data.profileCategories.length) fail('DUPLICATE','$.profileCategories');
 if (data.profileCategories.includes('altro')&&!data.otherProfileCategory.trim()) fail('CONDITION','$.otherProfileCategory');
 if (data.hasBrandCollabs==='yes'&&!data.brandCollabDetails.trim()) fail('CONDITION','$.brandCollabDetails');
 data.email=data.email.trim();
 if (!/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(data.email)) fail('FORMAT','$.email');
 for (const key of LINKS) url(data[key],`$.${key}`);
 for (const key of IMAGES) image(data[key],`$.${key}`);
 if (!data.screenshotData) fail('REQUIRED','$.screenshotData');
 if (IMAGES.reduce((sum,key)=>sum+data[key].length,0)>900000) fail('LENGTH','$.screenshots');
 const ig=social(data.instagram,'instagram','$.instagram',true),tt=social(data.tiktok,'tiktok','$.tiktok',false);
 data.instagram=ig.handle?`@${ig.handle}`:'';data.tiktok=tt.handle?`@${tt.handle}`:'';
 data.otherProfileCategory=data.otherProfileCategory.trim();
 data.ocrInsights=validateOcrInsights(data.ocrInsights);data.ocrProfile=validateOcrProfile(data.ocrProfile);
 return structuredClone(data);
}
export function parsePublicApplicationJson(raw) {
 if (typeof raw!=='string') fail('TYPE','$');
 if (new TextEncoder().encode(raw).byteLength>MAX_JSON_BYTES) fail('BODY_TOO_LARGE','$');
 let input;try { input=JSON.parse(raw); } catch { fail('INVALID_JSON','$'); }
 return validatePublicApplication(input);
}
// Called only with trusted clock and server-loaded config. Does not persist or authenticate.
export function prepareApplication(input,{now,scoring=null}={}) {
 const data=validatePublicApplication(input);
 const date=iso(now,'$server.now');
 const score=computeSocial(data,scoring);
 const ig=social(data.instagram,'instagram','$.instagram',true),tt=social(data.tiktok,'tiktok','$.tiktok',false);
 const document={...data,
  instagramHandle:ig.handle,instagramUrl:ig.url,tiktokHandle:tt.handle,tiktokUrl:tt.url,
  schemaVersion:4,date,updatedAt:date,status:'new',notes:'',creatorCode:'',evaluation:{},
  socialScore:score.socialScore,perfLevel:score.perfLevel,bandLabel:score.bandLabel,
  erRate:+score.er.toFixed(2),reachRate:+score.reach.toFixed(2),growthRate:+score.growth.toFixed(2)
 };
 if (new TextEncoder().encode(JSON.stringify(document)).byteLength>MAX_JSON_BYTES) fail('DOCUMENT_TOO_LARGE','$');
 return document;
}
