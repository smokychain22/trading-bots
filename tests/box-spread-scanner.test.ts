import assert from 'node:assert/strict';
import test from 'node:test';
import { scanBoxSpread, type BoxLegQuote, type BoxSpreadScanInput } from '../src/research/source-replication/box-spread.js';

const leg = (symbol: string, optionType: 'CALL' | 'PUT', side: 'BUY' | 'SELL', strike: number,
  bid: number, ask: number): BoxLegQuote => ({ symbol, optionType, side, strike, expiration: '2027-10-07',
  multiplier: 100, bid, ask, exerciseStyle: 'AMERICAN' });
const input = (overrides: Partial<BoxSpreadScanInput> = {}): BoxSpreadScanInput => ({
  candidateId: 'BOX-100-110', observedAt: '2026-10-07T15:00:00.000Z', providerKnownAt: '2026-10-07T15:00:00.000Z',
  daysToExpiry: 365, annualRiskFreeRate: 0.05, modeledCommissionsAndFeesUsd: 4, modeledSlippageUsd: 4,
  nativeAtomicMultiLegSupported: false, dividendOrEarlyExerciseRiskKnown: false, brokerCapitalRequirementUsd: null,
  legs: [leg('C100', 'CALL', 'BUY', 100, 9.9, 10), leg('C110', 'CALL', 'SELL', 110, 4.9, 5),
    leg('P110', 'PUT', 'BUY', 110, 9.8, 10), leg('P100', 'PUT', 'SELL', 100, 4.9, 5)], ...overrides,
});

test('scanner prices exact executable long-box geometry against discounted terminal value', () => {
  const receipt = scanBoxSpread(input());
  assert.equal(receipt.state, 'SCANNED');
  assert.equal(receipt.strikeWidth, 10);
  assert.equal(receipt.terminalPayoffUsd, 1_000);
  assert.equal(receipt.executableDebitUsd, 1_020);
  assert.equal(receipt.scannerVerdict, 'NO_POSITIVE_EDGE');
  assert.ok(receipt.practicalRisks.includes('ATOMIC_MULTI_LEG_EXECUTION_UNAVAILABLE'));
  assert.equal(receipt.executionAuthorized, false);
  assert.equal(receipt.riskFreeClaimAllowed, false);
});

test('positive theoretical edge stays scanner-only and carries practical risks', () => {
  const cheap = input({ legs: [leg('C100', 'CALL', 'BUY', 100, 8.9, 9), leg('C110', 'CALL', 'SELL', 110, 4.9, 5),
    leg('P110', 'PUT', 'BUY', 110, 8.8, 9), leg('P100', 'PUT', 'SELL', 100, 4.9, 5)] });
  const receipt = scanBoxSpread(cheap);
  assert.equal(receipt.scannerVerdict, 'POSITIVE_AFTER_MODELED_COSTS');
  assert.ok((receipt.edgeVsFairValueUsd ?? 0) > 0);
  assert.equal(receipt.authority, 'SCANNER_ONLY_RESEARCH');
});

test('unknown costs and PIT-unsafe evidence never become a positive edge claim', () => {
  assert.equal(scanBoxSpread(input({ modeledSlippageUsd: null })).scannerVerdict, 'COSTS_UNKNOWN');
  const unsafe = scanBoxSpread(input({ providerKnownAt: '2026-10-07T16:00:00.000Z' }));
  assert.equal(unsafe.state, 'PIT_UNSAFE');
  assert.equal(unsafe.edgeVsFairValueUsd, null);
});

test('wrong leg geometry fails closed', () => {
  const wrong = input({ legs: [leg('C100', 'CALL', 'SELL', 100, 9.9, 10), leg('C110', 'CALL', 'BUY', 110, 4.9, 5),
    leg('P110', 'PUT', 'BUY', 110, 9.8, 10), leg('P100', 'PUT', 'SELL', 100, 4.9, 5)] });
  assert.equal(scanBoxSpread(wrong).state, 'INVALID');
});
