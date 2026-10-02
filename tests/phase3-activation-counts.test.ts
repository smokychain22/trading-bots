import assert from 'node:assert/strict';
import test from 'node:test';
import { exactNonNegativeInteger } from '../src/execution/paper-execution-authorization.js';

test('an activation aggregate is a count only when it is a finite non-negative integer; everything else is UNKNOWN, never zero', () => {
  for (const value of [0, 1, 7, '0', '12', ' 3 ']) assert.notEqual(exactNonNegativeInteger(value), null, String(value));
  assert.equal(exactNonNegativeInteger('12'), 12);
  for (const value of [null, undefined, '', ' ', 'abc', Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, '1.5', {}, [], true]) {
    assert.equal(exactNonNegativeInteger(value), null, String(value));
  }
});
