import assert from 'node:assert/strict';
import test from 'node:test';
import { computeDefinedRiskEconomics, type DefinedRiskStructureInput } from '../src/research/defined-risk-economics.js';
import {
  compareDefinedRiskToConventionalCsp, computeConventionalCspEconomics, type ConventionalCspStructureInput,
} from '../src/research/defined-risk-vs-csp-economics.js';

const putSpread = (overrides: Partial<DefinedRiskStructureInput> = {}): DefinedRiskStructureInput => ({
  underlying: 'AAPL', snapshotId: 'snap-1', candidateId: 'cand-1', optionType: 'PUT',
  shortExpiration: '2026-10-16', longExpiration: '2026-10-16',
  shortOptionSymbol: 'AAPL261016P00195000', longOptionSymbol: 'AAPL261016P00190000',
  shortStrike: 195, longStrike: 190, shortBid: 2.00, shortAsk: 2.10, longBid: 0.80, longAsk: 0.90,
  shortMultiplier: 100, longMultiplier: 100, quantity: 1, shortDelta: -0.30, longDelta: -0.18,
  shortImpliedVolatility: 0.32, longImpliedVolatility: 0.29, underlyingPrice: 200, expectedMoveDollars: 6,
  eventContextKnown: true, liquidityEvidenceKnown: true, ...overrides,
});

const csp = (overrides: Partial<ConventionalCspStructureInput> = {}): ConventionalCspStructureInput => ({
  underlying: 'AAPL', snapshotId: 'snap-1', candidateId: 'csp-1', expiration: '2026-10-16',
  optionSymbol: 'AAPL261016P00195000', strike: 195, bid: 2.00, ask: 2.10, multiplier: 100, quantity: 1,
  delta: -0.30, impliedVolatility: 0.32, underlyingPrice: 200, expectedMoveDollars: 6, ...overrides,
});

test('a normal CSP computes correct premium/collateral/max-loss/break-even in explicit per-share/per-contract/position units', () => {
  const economics = computeConventionalCspEconomics(csp());
  assert.equal(economics.structureValidity, 'VALID');
  assert.equal(economics.premiumPerShare, 2.00);
  assert.equal(economics.premiumPerContract, 200);
  assert.equal(economics.positionPremium, 200);
  assert.equal(economics.collateralPerContract, 19500); // 195 * 100
  assert.equal(economics.positionCollateral, 19500);
  assert.equal(economics.maxLossPerContract, 19300); // 19500 - 200
  assert.equal(economics.breakEven, 193); // 195 - 2.00
  assert.ok(Math.abs((economics.creditToCollateralRatio as number) - (200 / 19500)) < 1e-9);
  assert.equal(economics.brokerAuthority, false);
});

test('quantity scaling multiplies position figures correctly, never confused with the per-contract figure', () => {
  const economics = computeConventionalCspEconomics(csp({ quantity: 3 }));
  assert.equal(economics.positionPremium, 600);
  assert.equal(economics.positionCollateral, 58500);
  assert.equal(economics.positionMaxLoss, 57900);
});

test('an OCC symbol that is not a PUT is rejected as INVALID for a CSP structure', () => {
  const economics = computeConventionalCspEconomics(csp({ optionSymbol: 'AAPL261016C00195000' }));
  assert.equal(economics.structureValidity, 'INVALID');
  assert.ok(economics.invalidReasons.includes('CONTRACT_NOT_PUT'));
});

test('a strike mismatch between the claimed field and the OCC symbol is rejected', () => {
  const economics = computeConventionalCspEconomics(csp({ strike: 200 })); // symbol still encodes 195
  assert.equal(economics.structureValidity, 'INVALID');
  assert.ok(economics.invalidReasons.includes('CONTRACT_STRIKE_MISMATCH'));
});

test('a missing quote leaves premium/collateral-derived fields UNKNOWN, never fabricated', () => {
  const economics = computeConventionalCspEconomics(csp({ bid: null, ask: null }));
  assert.equal(economics.structureValidity, 'VALID'); // structurally still a valid contract
  assert.equal(economics.premiumPerShare, null);
  assert.equal(economics.maxLossPerContract, null);
  assert.equal(economics.collateralPerContract, 19500); // collateral depends only on strike*multiplier, not the quote
});

test('compareDefinedRiskToConventionalCsp requires the same underlying and snapshot before comparing', () => {
  const definedRisk = computeDefinedRiskEconomics(putSpread());
  const differentUnderlying = computeConventionalCspEconomics(csp({ underlying: 'MSFT', optionSymbol: 'MSFT261016P00195000' }));
  const mismatch = compareDefinedRiskToConventionalCsp(definedRisk, differentUnderlying, 0.90);
  assert.equal(mismatch.pairable, false);
  assert.equal(mismatch.unpairableReason, 'UNDERLYING_MISMATCH');

  const differentSnapshot = computeConventionalCspEconomics(csp({ snapshotId: 'snap-2' }));
  const snapshotMismatch = compareDefinedRiskToConventionalCsp(definedRisk, differentSnapshot, 0.90);
  assert.equal(snapshotMismatch.unpairableReason, 'SNAPSHOT_MISMATCH');
});

test('a valid pairing reports only signed dimensional differences, no winner, and the long-leg cost is reported separately as a defined-risk-only fact', () => {
  const definedRisk = computeDefinedRiskEconomics(putSpread());
  const cspEconomics = computeConventionalCspEconomics(csp());
  const comparison = compareDefinedRiskToConventionalCsp(definedRisk, cspEconomics, 0.90);
  assert.equal(comparison.pairable, true);
  assert.equal(comparison.definedRiskLongLegCostPerContract, 90); // 0.90 * 100

  const netCreditDiff = comparison.differences.find((row) => row.dimension === 'netCreditPerContract');
  assert.equal(netCreditDiff?.definedRiskValue, definedRisk.netCreditPerContract);
  assert.equal(netCreditDiff?.cspValue, cspEconomics.premiumPerContract);
  assert.ok(Math.abs((netCreditDiff?.difference as number) - ((definedRisk.netCreditPerContract as number) - (cspEconomics.premiumPerContract as number))) < 1e-9);

  const capitalDiff = comparison.differences.find((row) => row.dimension === 'capitalRequiredPerContract');
  assert.equal(capitalDiff?.definedRiskValue, 390); // canonical capitalRequiredPerContract === maxLossPerContract for defined-risk
  assert.equal(capitalDiff?.cspValue, 19500); // strike * multiplier -- defined risk uses vastly less capital

  const keys = comparison.differences.flatMap((row) => Object.keys(row));
  for (const forbidden of ['winner', 'better', 'preferred', 'definedriskisbetter', 'score']) {
    assert.ok(!keys.map((key) => key.toLowerCase()).includes(forbidden));
  }
  assert.equal(comparison.brokerAuthority, false);
});

test('a dimension that is UNKNOWN on either side is skipped, never assumed equal', () => {
  const definedRisk = computeDefinedRiskEconomics(putSpread({ longBid: null, longAsk: null })); // makes credit UNKNOWN
  const cspEconomics = computeConventionalCspEconomics(csp());
  const comparison = compareDefinedRiskToConventionalCsp(definedRisk, cspEconomics, 0.90);
  assert.ok(!comparison.differences.some((row) => row.dimension === 'netCreditPerContract'));
});

test('an unknown long-leg ask leaves definedRiskLongLegCostPerContract null, never fabricated', () => {
  const definedRisk = computeDefinedRiskEconomics(putSpread());
  const cspEconomics = computeConventionalCspEconomics(csp());
  const comparison = compareDefinedRiskToConventionalCsp(definedRisk, cspEconomics, null);
  assert.equal(comparison.definedRiskLongLegCostPerContract, null);
});
