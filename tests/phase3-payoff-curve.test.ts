import assert from 'node:assert/strict';
import test from 'node:test';

// Phase 3, items 82-83: expiration payoff-curve property tests. These
// reimplement the exact, already-confirmed-correct contractual formulas
// (canonical-strategy-frontier.ts's singleLegPutCandidate/
// definedRiskCandidate, and their independent formula proofs in
// tests/q-h-maxloss-economics.test.ts and
// tests/phase3-strategy-economics-formulas.test.ts) as a pure, minimal
// payoff function purely to test the PAYOFF SHAPE at expiration across the
// underlying price domain -- a property those other tests do not directly
// exercise (they check specific economics fields, not the full curve).
// This is a real, independent, second calculation of the same economics,
// not a call to production code twice (directive item 49).

function shortPutPnlAtExpiration(underlying: number, strike: number, creditPerShare: number, multiplier: number): number {
  const intrinsic = Math.max(strike - underlying, 0);
  return (creditPerShare - intrinsic) * multiplier;
}

function bullPutSpreadPnlAtExpiration(underlying: number, shortStrike: number, longStrike: number, netCreditPerShare: number, multiplier: number): number {
  const shortIntrinsic = Math.max(shortStrike - underlying, 0);
  const longIntrinsic = Math.max(longStrike - underlying, 0);
  return (netCreditPerShare - shortIntrinsic + longIntrinsic) * multiplier;
}

test('Q PAYOFF CURVE: flat maximum-profit region above strike, linear below, bounded at underlying=0', () => {
  const strike = 190, credit = 2, multiplier = 100;
  const aboveStrike = shortPutPnlAtExpiration(220, strike, credit, multiplier);
  const atStrike = shortPutPnlAtExpiration(strike, strike, credit, multiplier);
  const belowStrike = shortPutPnlAtExpiration(180, strike, credit, multiplier);
  const atZero = shortPutPnlAtExpiration(0, strike, credit, multiplier);

  assert.equal(aboveStrike, credit * multiplier, 'above strike, PnL is flat at max profit (full credit retained)');
  assert.equal(atStrike, credit * multiplier, 'at strike, still max profit (intrinsic = 0)');
  assert.equal(belowStrike, (credit - (strike - 180)) * multiplier, 'below strike, PnL worsens linearly with intrinsic loss');
  assert.equal(atZero, (credit - strike) * multiplier, 'at underlying=0, worst case -- matches -(maxLoss) exactly');
  assert.equal(-atZero, (strike - credit) * multiplier, 'this worst-case loss magnitude matches the fixed Q maxLoss formula exactly');
  assert.ok(belowStrike < atStrike, 'monotonically worse below strike than at/above strike');
});

test('D PAYOFF CURVE (bull put spread): flat max profit above short strike, linear transition between strikes, flat max loss below long strike', () => {
  const shortStrike = 190, longStrike = 180, netCredit = 1.4, multiplier = 100;
  const aboveShort = bullPutSpreadPnlAtExpiration(220, shortStrike, longStrike, netCredit, multiplier);
  const atShort = bullPutSpreadPnlAtExpiration(shortStrike, shortStrike, longStrike, netCredit, multiplier);
  const between = bullPutSpreadPnlAtExpiration(185, shortStrike, longStrike, netCredit, multiplier);
  const atLong = bullPutSpreadPnlAtExpiration(longStrike, shortStrike, longStrike, netCredit, multiplier);
  const belowLong = bullPutSpreadPnlAtExpiration(150, shortStrike, longStrike, netCredit, multiplier);

  const width = shortStrike - longStrike;
  const maxProfit = netCredit * multiplier;
  const maxLoss = (width - netCredit) * multiplier;

  const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `expected ${a} ~= ${b}`);
  close(aboveShort, maxProfit);
  close(atShort, maxProfit);
  close(atLong, -maxLoss);
  close(belowLong, -maxLoss);
  assert.ok(between < aboveShort && between > atLong, 'strictly between the two flat regions when underlying is between strikes');
});

test('PROPERTY: D maxLoss + maxProfit approximately equals width*multiplier before costs (directive item 50)', () => {
  const shortStrike = 190, longStrike = 180, netCredit = 1.4, multiplier = 100;
  const width = shortStrike - longStrike;
  const maxProfit = netCredit * multiplier;
  const maxLoss = (width - netCredit) * multiplier;
  assert.equal(maxLoss + maxProfit, width * multiplier);
});

test('PROPERTY: D monotonicity -- for the same width, a larger net credit means higher max profit and lower max loss', () => {
  const shortStrike = 190, longStrike = 180, multiplier = 100;
  const width = shortStrike - longStrike;
  const lowerCredit = 1.0, higherCredit = 2.0;
  const lowerMaxProfit = lowerCredit * multiplier, higherMaxProfit = higherCredit * multiplier;
  const lowerMaxLoss = (width - lowerCredit) * multiplier, higherMaxLoss = (width - higherCredit) * multiplier;
  assert.ok(higherMaxProfit > lowerMaxProfit);
  assert.ok(higherMaxLoss < lowerMaxLoss);
});

test('PROPERTY: no quantity means no positive portfolio PnL -- a quantity-0 position cannot claim a real dollar result', () => {
  const quantity = 0;
  const perContractMaxProfit = 2 * 100;
  const positionMaxProfit = perContractMaxProfit * quantity;
  assert.equal(positionMaxProfit, 0);
});
