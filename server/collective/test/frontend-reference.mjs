// The 71-field persisted-document oracle is historical; current HTTP payloads are tested in test/frontend.
import {legacySubmit} from '../../../test/frontend/legacy-submit-reference.mjs';
// Evaluate only pure fragments from the checked-out frontend; no Firebase config,
// no JSX, no Worker calls and no production credentials are evaluated.
import vm from 'node:vm';
import {PUBLIC_FIELDS} from '../application.mjs';
import {frontendSource as source,admin,publicForm} from '../../../test/frontend/app-source.mjs';
function extract(start,end,from=source) {
 const a=from.indexOf(start),b=from.indexOf(end,a);
 if(a<0||b<0)throw new Error(`Frontend contract changed: ${start}`);
 return from.slice(a,b);
}
// Scoring: area staff (app/admin.jsx). Esempio di prova: modulo pubblico (app/public-form.jsx).
const scoring=extract('const SCORING_VERSION =','/* ============================================================================\n   10. EXPORT CSV',admin);
const form=extract('const EMPTY_FORM =','const YESNO =');
const example=extract('const TEST_FORM =','/* ---------- fine di app/public-form.jsx',publicForm);
const social=extract('const parseSocial =','/** Sfugge');
const submit=legacySubmit;
export const NOW='2026-01-01T12:00:00.000Z';
export const JPEG='data:image/jpeg;base64,/9j/2Q==';
export async function frontendDocument(overrides={}) {
 let saved;
 const sandbox={overrides,console,window:{scrollTo(){}},saving:false,validate:()=>({}),
  setErrors(){},scrollTop(){},setSaving(){},setSaveErr(){},setDone(){},notifyTelegram:async()=>{},
  FB:{getScoring:async()=>null,saveApp:async value=>{saved=value;}}};
 vm.createContext(sandbox);
 await vm.runInContext(`${scoring}\n${form}\n${example}\n${social}\nconst form={...TEST_FORM,screenshotData:${JSON.stringify(JPEG)},...overrides};\n${submit}\nsubmit();`,sandbox);
 if(!saved) throw new Error('Frontend submit did not produce a document');
 const {id,...document}=JSON.parse(JSON.stringify(saved));
 document.date=NOW;document.updatedAt=NOW;
 return document;
}
export async function publicFixture(overrides={}) {
 const document=await frontendDocument();
 return {...Object.fromEntries(PUBLIC_FIELDS.map(key=>[key,document[key]])),...overrides};
}
export function frontendScore(data,config=null) {
 return JSON.parse(vm.runInNewContext(`${scoring}\nJSON.stringify(computeSocial(data, normalizeScoring(config)))`,{data,config}));
}
export function frontendDefault() {return JSON.parse(vm.runInNewContext(`${scoring}\nJSON.stringify(DEFAULT_SCORING)`));}
export function fullOcr() {
 const n=value=>({value,visibility:'complete'});
 const s={screenType:'insights_ok',views:n(24800),netFollowers:n(260),interactions:n(1120),accountsReached:n(18400)};
 return {profileScreenshotData:JPEG,screenshotData2:JPEG,
  ocrInsights:{screenshot1:s,screenshot2:structuredClone(s),merged:{views:24800,netFollowers:260,interactions:1120,accountsReached:18400},conflicts:[],readAt:NOW},
  ocrProfile:{result:{screenType:'profile_ok',displayName:{value:'Synthetic Candidate',visibility:'complete',truncated:false},username:{value:'synthetic',visibility:'partial',truncated:true},followers:n(8500)},readAt:NOW}}
}
