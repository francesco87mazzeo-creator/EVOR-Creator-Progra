import {exact, text, number, enumeration, iso, array} from './validation.mjs';
const METRICS=['views','netFollowers','interactions','accountsReached'];
const VISIBILITY=['complete','partial','not_visible'];
function nullable(value,path) { if (value!==null) number(value,-1e12,1e12,path); }
function numericField(value,path) {
  exact(value,['value','visibility'],path);
  nullable(value.value,`${path}.value`);
  enumeration(value.visibility,VISIBILITY,`${path}.visibility`);
}
function textField(value,path) {
  exact(value,['value','visibility','truncated'],path);
  if (value.value!==null) text(value.value,200,`${path}.value`);
  enumeration(value.visibility,VISIBILITY,`${path}.visibility`);
  enumeration(value.truncated,[true,false],`${path}.truncated`);
}
function screenshot(value,path) {
  if (value===null) return;
  exact(value,['screenType',...METRICS],path);
  enumeration(value.screenType,['insights_ok','dashboard_wrong','uncertain'],`${path}.screenType`);
  for (const key of METRICS) numericField(value[key],`${path}.${key}`);
}
export function validateOcrInsights(value,path='$.ocrInsights') {
  if (value===null) return null;
  exact(value,['screenshot1','screenshot2','merged','conflicts','readAt'],path);
  screenshot(value.screenshot1,`${path}.screenshot1`);
  screenshot(value.screenshot2,`${path}.screenshot2`);
  exact(value.merged,METRICS,`${path}.merged`);
  for (const key of METRICS) nullable(value.merged[key],`${path}.merged.${key}`);
  array(value.conflicts,0,4,`${path}.conflicts`);
  value.conflicts.forEach((conflict,i)=>{
    const p=`${path}.conflicts[${i}]`;
    exact(conflict,['key','valueA','valueB'],p);
    enumeration(conflict.key,METRICS,`${p}.key`);
    nullable(conflict.valueA,`${p}.valueA`);nullable(conflict.valueB,`${p}.valueB`);
  });
  iso(value.readAt,`${path}.readAt`);
  return structuredClone(value);
}
export function validateOcrProfile(value,path='$.ocrProfile') {
  if (value===null) return null;
  exact(value,['result','readAt'],path);
  iso(value.readAt,`${path}.readAt`);
  exact(value.result,['screenType','displayName','username','followers'],`${path}.result`);
  enumeration(value.result.screenType,['profile_ok','wrong_screen','uncertain'],`${path}.result.screenType`);
  textField(value.result.displayName,`${path}.result.displayName`);
  textField(value.result.username,`${path}.result.username`);
  numericField(value.result.followers,`${path}.result.followers`);
  return structuredClone(value);
}
