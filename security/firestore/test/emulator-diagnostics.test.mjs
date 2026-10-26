import {test} from 'node:test';
import assert from 'node:assert/strict';
import {expressionBudgetExceeded, currentLogText} from '../scripts/emulator-diagnostics.mjs';
for (const [index, text] of [
 'evaluation error: maximum of 1000 expressions to evaluate has been reached',
 'Maximum number of expressions evaluated exceeds limit',
 'exceeded the maximum of 1,000 expressions',
 'Too many expressions evaluated',
 'Expression evaluation limit exceeded',
 'permission-denied: expression limit of 1000 reached'
].entries()) test(`Budget diagnostic sample ${index + 1} is detected`,()=>assert.equal(expressionBudgetExceeded(text),true));
for (const text of ['PERMISSION_DENIED: false for create at L205','191 tests; 179 passed','Failed to download emulator','permission-denied: insufficient permissions']) {
 test(`Non-budget diagnostic stays distinct: ${text}`,()=>assert.equal(expressionBudgetExceeded(text),false));
}
test('An appended log excludes the previous run',()=>assert.equal(currentLogText('old\n','old\nnew\n'),'new\n'));
test('A truncated log belongs entirely to the new run',()=>assert.equal(currentLogText('old long log','new'),'new'));
test('An unchanged log is not fresh evidence',()=>assert.equal(currentLogText('old','old'),''));
