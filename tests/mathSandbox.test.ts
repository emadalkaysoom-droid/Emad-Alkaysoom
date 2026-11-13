import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMathExpression } from '../shared/mathSandbox';

test('evaluates arithmetic, operator precedence, and parentheses', () => {
  const res = evaluateMathExpression('2 + 3 * (4 ^ 2 - 6)');
  assert.equal(res.value, 32);
  assert.equal(res.formatted, '32');
});

test('evaluates mathematical functions and constants', () => {
  const res = evaluateMathExpression('sqrt(144) + round(pi)');
  assert.equal(res.value, 15);
});

test('rejects division by zero and arbitrary code injection attempts', () => {
  assert.throws(() => evaluateMathExpression('10 / (5 - 5)'), /Division by zero/);
  assert.throws(() => evaluateMathExpression('process.exit(1)'), /Disallowed|Unknown|Invalid/);
  assert.throws(() => evaluateMathExpression('require("fs")'), /Disallowed|Unknown|Invalid/);
});
