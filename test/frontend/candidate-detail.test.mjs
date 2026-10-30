import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import levels from '../../public/score-levels.js';
const source=readFileSync(new URL('../../app/admin.jsx',import.meta.url),'utf8');
const helpers=source.split('/* candidate-display:start')[1].split('/* candidate-display:end */')[0];
const pure=helpers.slice(helpers.indexOf('const candidateScoreValue'));
const {value,text}=vm.runInNewContext(pure+'\n({value:candidateScoreValue,text:candidateScoreText});');
for(const invalid of [null,undefined,NaN,Infinity,-Infinity,-1,100.01,'50',{},[]])test(`candidate display never coerces invalid score ${String(invalid)}`,()=>{
 assert.equal(value(invalid),null);assert.equal(text(invalid),'—');
});
for(const valid of [0,.01,24.99,25,35,50,55,75,99.99,100])test(`candidate display preserves real numeric score ${valid}`,()=>{
 assert.equal(value(valid),valid);assert.equal(text(valid),valid.toLocaleString('it-IT',{maximumFractionDigits:2}));
});
test('display classification consumes the saved levels without inventing thresholds',()=>{
 const config=levels.defaults();config.social[1].color='#A658F0';config.social[1].label='Etichetta personalizzata';const result=levels.classify(value(40),config.social);assert.equal(result.color,'#A658F0');assert.equal(result.label,'Etichetta personalizzata');assert.equal(levels.classify(value(null),config.social),null);
});
test('candidate display components contain no database, transport or scoring calculations',()=>{
 const components=source.slice(source.indexOf('function CandidateScoreRing('),source.indexOf('function CandidateDetail('));
 assert.doesNotMatch(components,/\b(?:db|FB|AUTH)\.|\bfetch\s*\(|computeScore\s*\(|setTimeout\s*\(|setInterval\s*\(/);
 assert.match(components,/IntersectionObserver/);assert.match(components,/prefers-reduced-motion/);assert.match(components,/cancelAnimationFrame/);assert.match(components,/1200/);
});
