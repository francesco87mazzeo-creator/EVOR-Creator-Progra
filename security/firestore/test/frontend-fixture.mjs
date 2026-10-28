// The 71-field persisted-document oracle is historical; current HTTP payloads are tested in test/frontend.
import {legacySubmit} from '../../../test/frontend/legacy-submit-reference.mjs';
// Evaluate only the pure form/scoring/submit fragments, never Firebase config or JSX.
import vm from 'node:vm';
import { frontendSource as html, admin, publicForm } from '../../../test/frontend/app-source.mjs';
function fragment(start, end, from = html) {
  const a = from.indexOf(start), b = from.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`Frontend contract changed: ${start}`);
  return from.slice(a,b);
}
const empty = fragment('const EMPTY_FORM =', 'const YESNO =');
// Scoring: area staff (app/admin.jsx). Esempio di prova: modulo pubblico (app/public-form.jsx).
const scoring = fragment('const SCORING_VERSION =', '/* ============================================================================\n   10. EXPORT CSV', admin);
const social = fragment('const parseSocial =', '/** Sfugge');
const submit = legacySubmit;
const example = fragment('const TEST_FORM =', '/* ---------- fine di app/public-form.jsx', publicForm);
export const stamp = '2026-01-01T12:00:00.000Z';
export const jpeg = 'data:image/jpeg;base64,/9j/2Q==';
export async function submission(overrides = {}) {
  let captured;
  const sandbox = { console, window:{scrollTo(){}}, overrides,
    FB:{getScoring: async()=>null,saveApp:async d=>{captured=d;}},
    saving:false, validate:()=>({}), setErrors(){},scrollTop(){},setSaving(){},setSaveErr(){},setDone(){},
    notifyTelegram:async()=>{} };
  vm.createContext(sandbox);
  await vm.runInContext(`${empty}\n${scoring}\n${social}\n${example}\nconst form={...TEST_FORM,screenshotData:${JSON.stringify(jpeg)},...overrides};\n${submit}\nsubmit();`,sandbox);
  if (!captured) throw new Error('Actual frontend submit did not save');
  // Match browser JSON-compatible data across VM realms.
  const {id, ...data} = JSON.parse(JSON.stringify(captured));
  return data;
}
export function defaultScoring() {
  return JSON.parse(vm.runInNewContext(`${scoring}\nJSON.stringify(DEFAULT_SCORING)`));
}
export function completeOcr() {
  const n = value=>({value,visibility:'complete'});
  const screen={screenType:'insights_ok',views:n(24800),netFollowers:n(260),interactions:n(1120),accountsReached:n(18400)};
  return {
    profileScreenshotData:jpeg,screenshotData2:jpeg,
    ocrInsights:{screenshot1:screen,screenshot2:structuredClone(screen),merged:{views:24800,netFollowers:260,interactions:1120,accountsReached:18400},conflicts:[],readAt:stamp},
    ocrProfile:{result:{screenType:'profile_ok',displayName:{value:'Synthetic Candidate',visibility:'complete',truncated:false},username:{value:'synthetic_profile',visibility:'partial',truncated:true},followers:n(8500)},readAt:stamp}
  };
}
