import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareDefinedRiskStructures, computeDefinedRiskEconomics, type DefinedRiskStructureInput,
} from '../src/research/defined-risk-economics.js';

const putSpread = (overrides: Partial<DefinedRiskStructureInput> = {}): DefinedRiskStructureInput => ({
  underlying: 'AAPL', snapshotId: 'snap-1', candidateId: 'cand-1', optionType: 'PUT', expiration: '2026-10-16',
  shortOptionSymbol: 'AAPL261016P00195000', longOptionSymbol: 'AAPL261016P00190000',
  shortStrike: 195, longStrike: 190, shortBid: 2.00, shortAsk: 2.10, longBid: 0.80, longAsk: 0.90,
  shortMultiplier: 100, longMultiplier: 100, quantity: 1, shortDelta: -0.30, longDelta: -0.18,
  shortImpliedVolatility: 0.32, longImpliedVolatility: 0.29, underlyingPrice: 200, expectedMoveDollars: 6,
  eventContextKnown: true, liquidityEvidenceKnown: true, ...overrides,
});

test('a normal PUT credit spread computes correct width/credit/max-loss/break-even in explicit units', () => {
  const economics = computeDefinedRiskEconomics(putSpread());
  assert.equal(economics.structureValidity, 'VALID');
  assert.equal(economics.widthPerShare, 5);
  assert.ok(Math.abs((economics.netCreditPerShare as number) - 1.10) < 1e-9); // 2.00 - 0.90
  assert.ok(Math.abs((economics.netCreditPerContract as number) - 110) < 1e-9);
  assert.ok(Math.abs((economics.positionNetCredit as number) - 110) < 1e-9); // quantity 1
  assert.ok(Math.abs((economics.maxProfitPerContract as number) - 110) < 1e-9);
  assert.ok(Math.abs((economics.maxLossPerContract as number) - 390) < 1e-9); // (5-1.10)*100
  assert.ok(Math.abs((economics.breakEven as number) - 193.90) < 1e-9); // 195 - 1.10
  assert.equal(economics.capitalRequiredPerContract, 500); // width*multiplier
  assert.ok(Math.abs((economics.creditToWidthRatio as number) - 0.22) < 1e-9);
  assert.ok(Math.abs((economics.creditToMaxLossRatio as number) - (110 / 390)) < 1e-9);
  assert.equal(economics.brokerAuthority, false);
});

test('a normal CALL credit spread uses the mirrored strike ordering and break-even direction', () => {
  const economics = computeDefinedRiskEconomics(putSpread({
    optionType: 'CALL', shortStrike: 205, longStrike: 210, shortBid: 1.50, shortAsk: 1.60, longBid: 0.50, longAsk: 0.60,
  }));
  assert.equal(economics.structureValidity, 'VALID');
  assert.equal(economics.widthPerShare, 5); // longStrike(210) - shortStrike(205)
  assert.ok(Math.abs((economics.netCreditPerShare as number) - 0.90) < 1e-9); // 1.50 - 0.60
  assert.ok(Math.abs((economics.breakEven as number) - 205.90) < 1e-9); // shortStrike + netCredit
});

test('zero/negative width (strikes equal or on the wrong side) reports INVALID with a named reason, never a fabricated payoff', () => {
  const zeroWidth = computeDefinedRiskEconomics(putSpread({ shortStrike: 190, longStrike: 190 }));
  assert.equal(zeroWidth.structureValidity, 'INVALID');
  assert.ok(zeroWidth.invalidReasons.some((reason) => reason.startsWith('WIDTH_NOT_POSITIVE')));
  assert.equal(zeroWidth.maxLossPerContract, null);

  const wrongSide = computeDefinedRiskEconomics(putSpread({ shortStrike: 190, longStrike: 195 })); // long strike above short strike for a PUT spread
  assert.equal(wrongSide.structureValidity, 'INVALID');
  assert.ok(wrongSide.invalidReasons.some((reason) => reason.includes('MISORDERED')));
});

test('a net credit that would make max loss negative (net credit exceeds width) is INVALID, an impossible payoff', () => {
  // width = 5, but shortBid(6.00) - longAsk(0.10) = 5.90 > width -- impossible for a real credit spread quote.
  const economics = computeDefinedRiskEconomics(putSpread({ shortBid: 6.00, shortAsk: 6.10, longBid: 0.05, longAsk: 0.10 }));
  assert.equal(economics.structureValidity, 'INVALID');
  assert.ok(economics.invalidReasons.includes('NET_CREDIT_EXCEEDS_WIDTH_IMPOSSIBLE_MAX_LOSS'));
});

test('a genuine net-debit structure (net credit is negative) is still a VALID, if unattractive, structure -- never itself INVALID', () => {
  // netCreditPerShare = 0.50 - 1.00 = -0.50 (a net debit); width=5, so maxLoss = (5-(-0.5))*100=550, still non-negative -- structurally valid.
  const economics = computeDefinedRiskEconomics(putSpread({ shortBid: 0.50, shortAsk: 0.55, longBid: 0.95, longAsk: 1.00 }));
  assert.equal(economics.structureValidity, 'VALID');
  assert.ok((economics.netCreditPerShare as number) < 0);
  assert.ok(Math.abs((economics.maxLossPerContract as number) - 550) < 1e-9);
});

test('non-finite required inputs are rejected as INVALID, never propagated as NaN', () => {
  const economics = computeDefinedRiskEconomics(putSpread({ shortStrike: Number.NaN }));
  assert.equal(economics.structureValidity, 'INVALID');
  assert.ok(economics.invalidReasons.includes('SHORTSTRIKE_NON_FINITE'));
});

test('mismatched short/long multipliers (a corporate-action adjustment mismatch) are rejected as INVALID', () => {
  const economics = computeDefinedRiskEconomics(putSpread({ shortMultiplier: 100, longMultiplier: 10 }));
  assert.equal(economics.structureValidity, 'INVALID');
  assert.ok(economics.invalidReasons.includes('MISMATCHED_MULTIPLIER'));
});

test('a crossed or missing quote on either leg makes the credit/payoff UNKNOWN, never fabricated from a partial quote', () => {
  const missingLongQuote = computeDefinedRiskEconomics(putSpread({ longBid: null, longAsk: null }));
  assert.equal(missingLongQuote.structureValidity, 'VALID'); // structurally still a valid spread shape
  assert.equal(missingLongQuote.netCreditPerShare, null);
  assert.equal(missingLongQuote.maxLossPerContract, null);

  const crossed = computeDefinedRiskEconomics(putSpread({ shortBid: 3, shortAsk: 1 })); // crossed short quote
  assert.equal(crossed.netCreditPerShare, null);
});

test('positionNetCredit and positionMaxLoss scale correctly with quantity, never confused with the per-contract figure', () => {
  const economics = computeDefinedRiskEconomics(putSpread({ quantity: 3 }));
  assert.ok(Math.abs((economics.positionNetCredit as number) - 330) < 1e-9); // 110 * 3
  assert.ok(Math.abs((economics.positionMaxLoss as number) - 1170) < 1e-9); // 390 * 3
  assert.ok(Math.abs((economics.positionCapitalRequired as number) - 1500) < 1e-9); // 500 * 3
});

test('distanceFromSpotToBreakEvenDollars is a signed plain fact, computed only when both breakEven and underlyingPrice are known', () => {
  const economics = computeDefinedRiskEconomics(putSpread({ underlyingPrice: 200 }));
  assert.ok(Math.abs((economics.distanceFromSpotToBreakEvenDollars as number) - (193.90 - 200)) < 1e-9);
  const unknownSpot = computeDefinedRiskEconomics(putSpread({ underlyingPrice: null }));
  assert.equal(unknownSpot.distanceFromSpotToBreakEvenDollars, null);
});

test('shortMinusLongImpliedVolatility is reported as a plain fact, never a ranking signal', () => {
  const economics = computeDefinedRiskEconomics(putSpread({ shortImpliedVolatility: 0.35, longImpliedVolatility: 0.28 }));
  assert.ok(Math.abs((economics.shortMinusLongImpliedVolatility as number) - 0.07) < 1e-9);
});

test('compareDefinedRiskStructures reports only signed numeric differences, never a winner/score field', () => {
  const wide = computeDefinedRiskEconomics(putSpread({ candidateId: 'wide', shortStrike: 195, longStrike: 185 }));
  const narrow = computeDefinedRiskEconomics(putSpread({ candidateId: 'narrow', shortStrike: 195, longStrike: 190 }));
  const differences = compareDefinedRiskStructures(wide, narrow);
  const keys = differences.flatMap((row) => Object.keys(row));
  for (const forbidden of ['winner', 'better', 'preferred', 'score', 'rank']) {
    assert.ok(!keys.map((key) => key.toLowerCase()).includes(forbidden), `must not carry field: ${forbidden}`);
  }
  const capitalDiff = differences.find((row) => row.dimension === 'capitalRequiredPerContract');
  assert.ok(Math.abs((capitalDiff?.difference as number) - (1000 - 500)) < 1e-9); // wide width=10 -> capital=1000; narrow width=5 -> capital=500
});

test('compareDefinedRiskStructures skips a dimension that is UNKNOWN on either side, never assuming equality', () => {
  const known = computeDefinedRiskEconomics(putSpread());
  const unknownCredit = computeDefinedRiskEconomics(putSpread({ longBid: null, longAsk: null }));
  const differences = compareDefinedRiskStructures(known, unknownCredit);
  assert.ok(!differences.some((row) => row.dimension === 'netCreditPerContract'));
});
