import assert from 'node:assert/strict';
import test from 'node:test';

import { modelAffordableContracts } from '../src/theta/q-entry-funnel.js';
import { securedContractCapacity, wholeContractsAffordable } from '../src/theta/secured-contract-capacity.js';

// SIZE-FLOAT-01: whole-contract affordability is computed on integer cents; one cent below / exact / one cent above.
const STRIKES = [1.09, 1.1, 1.15, 2.3, 4.35, 7.07, 12.55, 19.99, 33.33, 57.14, 190.05, 706.01];

test('integer-cents affordability: exact fit gives k, one cent below gives k-1, one cent above gives k', () => {
  for (const strike of STRIKES) {
    const collateral = strike * 100; // deliberately the noisy float product, as production computes it
    const unitCents = Math.round(strike * 10_000);
    for (const k of [1, 2, 3, 7]) {
      const exact = (unitCents * k) / 100;
      assert.equal(wholeContractsAffordable(exact, collateral), k, `exact ${k}x strike ${strike}`);
      assert.equal(wholeContractsAffordable((unitCents * k - 1) / 100, collateral), k - 1, `one cent below ${k}x strike ${strike}`);
      assert.equal(wholeContractsAffordable((unitCents * k + 1) / 100, collateral), k, `one cent above ${k}x strike ${strike}`);
      assert.equal(modelAffordableContracts(exact, collateral), k);
      assert.equal(securedContractCapacity(exact, collateral), k);
    }
  }
});

test('the plain float formula really is wrong for these strikes (guards that the helper is load-bearing)', () => {
  assert.equal(Math.floor(109 / (1.09 * 100)), 0);
  assert.equal(wholeContractsAffordable(109, 1.09 * 100), 1);
});

test('affordability never over-sizes sub-cent collateral and treats invalid input as UNKNOWN', () => {
  assert.equal(wholeContractsAffordable(100, 100.005), 0, 'collateral rounds up at sub-cent precision');
  assert.equal(wholeContractsAffordable(null, 100), null);
  assert.equal(wholeContractsAffordable(100, null), null);
  assert.equal(wholeContractsAffordable(-1, 100), null);
  assert.equal(wholeContractsAffordable(100, 0), null);
  assert.equal(wholeContractsAffordable(Number.NaN, 100), null);
  assert.equal(wholeContractsAffordable(0, 100), 0, 'zero is a valid outcome');
  assert.equal(securedContractCapacity(250, 100, 2), 4, 'already-secured lots are added, not floored');
});
