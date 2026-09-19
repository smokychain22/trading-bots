import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareDefinedRiskStructures, computeDefinedRiskEconomics, type DefinedRiskStructureInput,
} from '../src/research/defined-risk-economics.js';

const putSpread = (overrides: Partial<DefinedRiskStructureInput> = {}): DefinedRiskStructureInput => ({
  underlying: 'AAPL', snapshotId: 'snap-1', candidateId: 'cand-1', optionType: 'PUT',
  shortExpiration: '2026-10-16', longExpiration: '2026-10-16',
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
  assert.ok(Math.abs((economics.capitalRequiredPerContract as number) - 390) < 1e-9); // maximum loss
  assert.ok(Math.abs((economics.creditToWidthRatio as number) - 0.22) < 1e-9);
  assert.ok(Math.abs((economics.creditToMaxLossRatio as number) - (110 / 390)) < 1e-9);
  assert.equal(economics.brokerAuthority, false);
});

test('a normal CALL credit spread uses the mirrored strike ordering and break-even direction', () => {
  const economics = computeDefinedRiskEconomics(putSpread({
    optionType: 'CALL', shortOptionSymbol: 'AAPL261016C00205000', longOptionSymbol: 'AAPL261016C00210000',
    shortStrike: 205, longStrike: 210, shortBid: 1.50, shortAsk: 1.60, longBid: 0.50, longAsk: 0.60,
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

test('a net credit equal to or greater than width is INVALID, an impossible zero/negative-loss payoff', () => {
  // width = 5, but shortBid(6.00) - longAsk(0.10) = 5.90 > width -- impossible for a real credit spread quote.
  const economics = computeDefinedRiskEconomics(putSpread({ shortBid: 6.00, shortAsk: 6.10, longBid: 0.05, longAsk: 0.10 }));
  assert.equal(economics.structureValidity, 'INVALID');
  assert.ok(economics.invalidReasons.includes('NET_CREDIT_NOT_LESS_THAN_WIDTH'));
  const equalWidth = computeDefinedRiskEconomics(putSpread({ shortBid: 5.10, shortAsk: 5.20, longBid: 0.05, longAsk: 0.10 }));
  assert.equal(equalWidth.structureValidity, 'INVALID');
  assert.ok(equalWidth.invalidReasons.includes('NET_CREDIT_NOT_LESS_THAN_WIDTH'));
});

test('a net-debit structure is INVALID because this contract describes credit spreads only', () => {
  const economics = computeDefinedRiskEconomics(putSpread({ shortBid: 0.50, shortAsk: 0.55, longBid: 0.95, longAsk: 1.00 }));
  assert.equal(economics.structureValidity, 'INVALID');
  assert.ok(economics.invalidReasons.includes('NON_POSITIVE_NET_CREDIT'));
});

test('non-finite required inputs are rejected as INVALID, never propagated as NaN', () => {
  const economics = computeDefinedRiskEconomics(putSpread({ shortStrike: Number.NaN }));
  assert.equal(economics.structureValidity, 'INVALID');
  assert.ok(economics.invalidReasons.includes('SHORTSTRIKE_NON_FINITE'));
  const quantity = computeDefinedRiskEconomics(putSpread({ quantity: Number.NaN }));
  assert.equal(quantity.quantity, null);
});

test('mismatched short/long multipliers (a corporate-action adjustment mismatch) are rejected as INVALID', () => {
  const economics = computeDefinedRiskEconomics(putSpread({ shortMultiplier: 100, longMultiplier: 10 }));
  assert.equal(economics.structureValidity, 'INVALID');
  assert.ok(economics.invalidReasons.includes('MISMATCHED_MULTIPLIER'));
});

test('zero, negative, and fractional multipliers fail closed while a nonstandard positive integer remains valid', () => {
  for (const multiplier of [0, -100, 12.5]) {
    const economics = computeDefinedRiskEconomics(putSpread({ shortMultiplier: multiplier, longMultiplier: multiplier }));
    assert.equal(economics.structureValidity, 'INVALID');
    assert.ok(economics.invalidReasons.includes('MULTIPLIER_NOT_POSITIVE_INTEGER'));
  }
  const mini = computeDefinedRiskEconomics(putSpread({ shortMultiplier: 10, longMultiplier: 10 }));
  assert.equal(mini.structureValidity, 'VALID');
  assert.ok(Math.abs((mini.netCreditPerContract as number) - 11) < 1e-9);
  assert.ok(Math.abs((mini.maxLossPerContract as number) - 39) < 1e-9);
});

test('mismatched expirations and missing contract identity are explicitly invalid', () => {
  const expiry = computeDefinedRiskEconomics(putSpread({ longExpiration: '2026-11-20' }));
  assert.equal(expiry.structureValidity, 'INVALID');
  assert.ok(expiry.invalidReasons.includes('MISMATCHED_EXPIRATION'));
  const missingIdentity = computeDefinedRiskEconomics(putSpread({ longOptionSymbol: '' }));
  assert.equal(missingIdentity.structureValidity, 'INVALID');
  assert.ok(missingIdentity.invalidReasons.includes('LONG_CONTRACT_IDENTITY_MISSING'));
});

test('declared leg metadata must match exact OCC contract identity', () => {
  const typeMismatch = computeDefinedRiskEconomics(putSpread({ optionType: 'CALL' }));
  assert.equal(typeMismatch.structureValidity, 'INVALID');
  assert.ok(typeMismatch.invalidReasons.includes('SHORT_CONTRACT_OPTION_TYPE_MISMATCH'));
  const strikeMismatch = computeDefinedRiskEconomics(putSpread({ shortStrike: 194 }));
  assert.equal(strikeMismatch.structureValidity, 'INVALID');
  assert.ok(strikeMismatch.invalidReasons.includes('SHORT_CONTRACT_STRIKE_MISMATCH'));
});

test('a missing quote stays UNKNOWN while a crossed quote is INVALID, never fabricated from partial evidence', () => {
  const missingLongQuote = computeDefinedRiskEconomics(putSpread({ longBid: null, longAsk: null }));
  assert.equal(missingLongQuote.structureValidity, 'VALID'); // structurally still a valid spread shape
  assert.equal(missingLongQuote.economicsState, 'UNKNOWN');
  assert.ok(missingLongQuote.unknownReasons.includes('TWO_LEG_QUOTE_INCOMPLETE'));
  assert.equal(missingLongQuote.netCreditPerShare, null);
  assert.equal(missingLongQuote.maxLossPerContract, null);

  const crossed = computeDefinedRiskEconomics(putSpread({ shortBid: 3, shortAsk: 1 })); // crossed short quote
  assert.equal(crossed.structureValidity, 'INVALID');
  assert.ok(crossed.invalidReasons.includes('SHORT_QUOTE_CROSSED'));
  assert.equal(crossed.netCreditPerShare, null);
});

test('positionNetCredit and positionMaxLoss scale correctly with quantity, never confused with the per-contract figure', () => {
  const economics = computeDefinedRiskEconomics(putSpread({ quantity: 3 }));
  assert.ok(Math.abs((economics.positionNetCredit as number) - 330) < 1e-9); // 110 * 3
  assert.ok(Math.abs((economics.positionMaxLoss as number) - 1170) < 1e-9); // 390 * 3
  assert.ok(Math.abs((economics.positionCapitalRequired as number) - 1170) < 1e-9); // max loss 390 * 3
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

test('non-finite optional monetary and volatility evidence is invalid rather than silently UNKNOWN', () => {
  const expectedMove = computeDefinedRiskEconomics(putSpread({ expectedMoveDollars: Number.NaN }));
  assert.equal(expectedMove.structureValidity, 'INVALID');
  assert.ok(expectedMove.invalidReasons.includes('EXPECTED_MOVE_NON_FINITE'));
  assert.equal(expectedMove.expectedMoveDollars, null);
  const quote = computeDefinedRiskEconomics(putSpread({ longAsk: Number.POSITIVE_INFINITY }));
  assert.equal(quote.structureValidity, 'INVALID');
  assert.ok(quote.invalidReasons.includes('LONG_ASK_NON_FINITE'));
});

test('compareDefinedRiskStructures reports only signed numeric differences, never a winner/score field', () => {
  const wide = computeDefinedRiskEconomics(putSpread({ candidateId: 'wide', shortStrike: 195, longStrike: 185,
    longOptionSymbol: 'AAPL261016P00185000' }));
  const narrow = computeDefinedRiskEconomics(putSpread({ candidateId: 'narrow', shortStrike: 195, longStrike: 190 }));
  const comparison = compareDefinedRiskStructures(wide, narrow);
  assert.equal(comparison.comparisonState, 'COMPARABLE');
  const keys = [...Object.keys(comparison), ...comparison.differences.flatMap((row) => Object.keys(row))];
  for (const forbidden of ['winner', 'better', 'preferred', 'score', 'rank']) {
    assert.ok(!keys.map((key) => key.toLowerCase()).includes(forbidden), `must not carry field: ${forbidden}`);
  }
  const capitalDiff = comparison.differences.find((row) => row.dimension === 'capitalRequiredPerContract');
  assert.ok(Math.abs((capitalDiff?.difference as number) - (890 - 390)) < 1e-9);
});

test('compareDefinedRiskStructures skips a dimension that is UNKNOWN on either side, never assuming equality', () => {
  const known = computeDefinedRiskEconomics(putSpread());
  const unknownCredit = computeDefinedRiskEconomics(putSpread({ longBid: null, longAsk: null }));
  const comparison = compareDefinedRiskStructures(known, unknownCredit);
  assert.ok(!comparison.differences.some((row) => row.dimension === 'netCreditPerContract'));
});

test('comparison refuses mismatched underlyings or option types without selecting a winner', () => {
  const put = computeDefinedRiskEconomics(putSpread());
  const otherUnderlying = computeDefinedRiskEconomics(putSpread({ underlying: 'MSFT',
    shortOptionSymbol: 'MSFT261016P00195000', longOptionSymbol: 'MSFT261016P00190000' }));
  const comparison = compareDefinedRiskStructures(put, otherUnderlying);
  assert.equal(comparison.comparisonState, 'NOT_COMPARABLE');
  assert.ok(comparison.reasons.includes('MISMATCHED_UNDERLYING'));
  assert.equal(comparison.differences.length, 0);
  assert.equal(comparison.brokerAuthority, false);
});
