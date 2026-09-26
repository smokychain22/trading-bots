import assert from 'node:assert/strict';
import test from 'node:test';
import { assertEligibleForSlippage, buildSlippageRow, type FillProbabilityRow } from '../src/research/execution-dataset-contract.js';

const QUOTE = { bid: 1.0, ask: 1.1, mid: 1.05, spread: 0.1, observedAt: '2026-09-25T00:00:00Z' };

test('CORE CLAIM: slippage sign is direction-normalized -- a worse fill is positive for both BUY and SELL', () => {
  const buyWorse = buildSlippageRow({ orderIntentId: 'o1', side: 'BUY', fillPrice: 1.15, decisionQuote: QUOTE }); // paid more than mid -> worse
  const sellWorse = buildSlippageRow({ orderIntentId: 'o2', side: 'SELL', fillPrice: 0.95, decisionQuote: QUOTE }); // received less than mid -> worse
  assert.ok(buyWorse.directionNormalizedSlippage > 0);
  assert.ok(sellWorse.directionNormalizedSlippage > 0);
});

test('a better-than-mid fill is negative slippage regardless of side', () => {
  const buyBetter = buildSlippageRow({ orderIntentId: 'o3', side: 'BUY', fillPrice: 0.95, decisionQuote: QUOTE });
  const sellBetter = buildSlippageRow({ orderIntentId: 'o4', side: 'SELL', fillPrice: 1.15, decisionQuote: QUOTE });
  assert.ok(buyBetter.directionNormalizedSlippage < 0);
  assert.ok(sellBetter.directionNormalizedSlippage < 0);
});

test('CORE CLAIM: an unfilled order is ineligible for a slippage label', () => {
  const unfilled: FillProbabilityRow = {
    contractVersion: 'theta-execution-dataset-contract-v1', orderIntentId: 'o5', side: 'BUY', size: 1,
    limitOffsetFromMid: 0, quoteAgeSeconds: null, underlyingLiquidity: null, optionOpenInterest: null,
    optionVolume: null, timeOfDayBucket: null, filled: false, terminalStatus: 'CANCELLED',
  };
  assert.throws(() => assertEligibleForSlippage(unfilled), /UNFILLED_ORDER_INELIGIBLE_FOR_SLIPPAGE_LABEL/);
});
