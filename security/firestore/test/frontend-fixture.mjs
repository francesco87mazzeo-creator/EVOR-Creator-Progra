// The 71-field persisted-document oracle is historical; current HTTP payloads are tested in test/frontend.
import {legacySubmit} from '../../../test/frontend/legacy-submit-reference.mjs';
import {legacyScoring} from '../../../test/frontend/legacy-scoring-reference.mjs';
import {computeScore,scoreDocumentFields,DEFAULT_SCORING} from '../../../server/collective/scoring.mjs';
// Evaluate only the pure form/scoring/submit fragments, never Firebase config or JSX.
import vm from 'node:vm';
import { frontendSource as html, admin, publicForm } from '../../../test/frontend/app-source.mjs';
function fragment(start, end, from = html) {
  const a = from.indexOf(start), b = from.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`Frontend contract changed: ${start}`);
  return from.slice(a,b);
}
const empty = fragment('const EMPTY_FORM =', 'const YESNO =');
// Documenti e configurazione già presenti in produzione: scoring del modello precedente (schema 4,
// configurazione 2), congelato in legacy-scoring-reference.mjs. Esempio di prova: modulo pubblico.
const scoring = legacyScoring;
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

// Documento di schema 5 scritto dal Worker con lo scoring v2: senza i campi del modello precedente.
export async function currentSubmission(overrides = {}) {
  const data = await submission(overrides);
  for (const key of ['perfLevel','bandLabel','erRate','reachRate','growthRate']) delete data[key];
  return { ...data, schemaVersion: 5, ...scoreDocumentFields(computeScore(data)) };
}
export function currentScoring() { return structuredClone(DEFAULT_SCORING); }
