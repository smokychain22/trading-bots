import assert from 'node:assert/strict';
import test from 'node:test';
import { optionomicsFamiliesFor } from '../src/theta/optionomics-feature-destinations.js';

test('routes Optionomics families by strategy rather than feeding every family everywhere', () => {
  assert.equal(optionomicsFamiliesFor('THETA_CONVENTIONAL').includes('CROWD'), false);
  assert.equal(optionomicsFamiliesFor('THETA_HOLD_STRIKE').includes('TERM'), false);
  assert.equal(optionomicsFamiliesFor('THETA_RECOVERY').includes('GREEKS'), false);
  assert.equal(optionomicsFamiliesFor('THETA_CC').includes('STRUCTURAL_ECONOMICS'), true);
  assert.equal(optionomicsFamiliesFor('R6_RESEARCH').includes('CROWD'), true);
});
