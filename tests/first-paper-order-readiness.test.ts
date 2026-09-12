import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFirstPaperOrderReadinessReceipt, type Evidence, type FirstPaperOrderReadinessInput,
} from '../src/theta/first-paper-order-readiness.js';

const now = '2026-09-12T14:30:00.000Z';
const good = <T>(value: T, source = 'ALPACA'): Evidence<T> => ({ state: 'GOOD', value, source, asOf: now });
const validInput = (): FirstPaperOrderReadinessInput => ({
  asOf: now,
  broker: {
    role: good('MASTER_THETA_PAPER', 'DATABASE'), host: good('https://paper-api.alpaca.markets'),
    accountStatus: good('ACTIVE'), identityVerified: good(true), optionsApprovalLevel: good(3),
    optionsTradingLevel: good(3), equity: good(100_000), cash: good(100_000), buyingPower: good(400_000),
    optionsBuyingPower: good(100_000), positionCount: good(0), openOrderCount: good(0),
  },
  market: { clockOpen: good(true), calendarSessionConfirmed: good(true) },
  selection: {
    strategyBranch: good('THETA_Q', 'THETA'), strategyVersion:good('theta-q-v1','THETA'),
    candidateSetId:good('candidate-set-1','DATABASE'),candidateId:good('candidate-1','DATABASE'),
    symbol: good('AAPL'), occContract: good('AAPL261016P00150000'),
    optionType: good('PUT'), strike: good(150), expiration: good('2026-10-16'), dte: good(34),
    multiplier: good(100), positionIntent: good('SELL_TO_OPEN', 'THETA'), quantity: good(1, 'AEGIS'),
    quantityDerivation:good('min(allocation,collateral,assignment,tail,concentration)=1','AEGIS'),
    collateral: good(15_000, 'THETA'),userAllocation:good(20_000,'CUSTOMER_POLICY'), assignmentCapacity: good(true, 'AEGIS'),
    ownershipQuality: good('ACCEPTABLE', 'THETA'), eventState: good('CLEAR', 'OPTIONOMICS'),
  },
  quote: {
    bid: good(1.20), ask: good(1.30), midpoint: good(1.25), proposedLimit: good(1.24, 'EXECUTION_POLICY'),
    pricingPolicy:good('PASSIVE_LIMIT_V1','EXECUTION_POLICY'),
    ageSeconds: good(2), maximumAgeSeconds: 10, spreadProtectionPassed: good(true, 'EXECUTION_POLICY'),
  },
  economics: {
    empiricalState: good('EMPIRICALLY_READY', 'RESEARCH_REGISTRY'),empiricalModelVersion:good('ev-v1','RESEARCH_REGISTRY'),
    expectedAfterCost: good(18, 'THETA_Q'),downsideTailEvidence: good('VALIDATED', 'RESEARCH_REGISTRY'),
    returnPerCapitalDay: good(0.0004, 'THETA_Q'),uncertainty:good(0.1,'THETA_Q'),
    calibrationCohort:good('oos-c1','RESEARCH_REGISTRY'),promotionEvidence:good('READY','RESEARCH_REGISTRY'),
  },
  aegis: { result: good('ALLOW_FULL', 'AEGIS'), finalQuantity: good(1, 'AEGIS') },
  identity: {
    fusionSnapshotId: good('fusion-1', 'DATABASE'), fusionSnapshotHash: good('abc123', 'DATABASE'),
    decisionId: good('decision-1', 'DATABASE'), orderIntentId: good('intent-1', 'DATABASE'),
    clientOrderId: good('theta-client-1', 'DATABASE'),
  },
  operations: {
    idempotencyReserved: good(true, 'DATABASE'), persistenceDurable: good(true, 'DATABASE'),
    schedulerHealthy: good(true, 'WORKER'), reconciliationHealthy: good(true, 'WORKER'),workerOnline:good(true,'WORKER'),
    workerBuildSha:good('abc123','WORKER'),marketSession:good('OPEN','WORKER'),leaseHealthy:good(true,'DATABASE'),
    providerHealth:good('GOOD','WORKER'),executionBoundary: good('LOCKED_BEFORE_FIRST_POST', 'EXECUTION_CONTROL'),
    workerMode:'LOCAL_LAPTOP',ownerAuthorization:'NOT_GRANTED',
  },
});

test('complete evidence produces a deterministic YES receipt while every order count stays zero', () => {
  const input = validInput();
  const first = buildFirstPaperOrderReadinessReceipt(input);
  const second = buildFirstPaperOrderReadinessReceipt(input);
  assert.equal(first.readyForFirstPaperOrder, 'YES');
  assert.deepEqual(first.blockers, []);
  assert.equal(first.receiptHash, second.receiptHash);
  assert.match(first.receiptHash, /^[0-9a-f]{64}$/);
  assert.equal(first.operations.workerMode, 'LOCAL_LAPTOP');
  assert.deepEqual([first.masterPaperOrders, first.followerPaperOrders, first.liveOrders], [0, 0, 0]);
});

test('UNKNOWN inputs remain explicit blockers and never become zero', () => {
  const input = validInput();
  const receipt = buildFirstPaperOrderReadinessReceipt({
    ...input,
    selection: { ...input.selection, multiplier: { state: 'UNKNOWN', value: null, source: 'ALPACA', asOf: null } },
    economics: { ...input.economics, expectedAfterCost: { state: 'UNKNOWN', value: null, source: 'MODEL', asOf: now } },
  });
  assert.equal(receipt.readyForFirstPaperOrder, 'NO');
  assert.ok(receipt.blockers.includes('CONTRACT_MULTIPLIER_UNKNOWN'));
  assert.ok(receipt.blockers.includes('EXPECTED_AFTER_COST_UNKNOWN'));
  assert.equal(receipt.selection.multiplier.value, null);
  assert.equal(receipt.economics.expectedAfterCost.value, null);
});

test('premium and collateral units use the provider multiplier rather than assuming 100', () => {
  const input = validInput();
  const receipt = buildFirstPaperOrderReadinessReceipt({
    ...input,
    selection: { ...input.selection, multiplier: good(10), collateral: good(15_000, 'THETA') },
  });
  assert.equal(receipt.readyForFirstPaperOrder, 'NO');
  assert.ok(receipt.blockers.includes('COLLATERAL_FORMULA_MISMATCH'));
});

test('stale quote, non-positive EV, AEGIS veto, and unlocked boundary all fail closed', () => {
  const input = validInput();
  const receipt = buildFirstPaperOrderReadinessReceipt({
    ...input,
    quote: { ...input.quote, ageSeconds: good(11) },
    economics: { ...input.economics, empiricalState: good('EV_MODEL_NOT_EMPIRICALLY_READY'), expectedAfterCost: good(-1) },
    aegis: { ...input.aegis, result: good('HARD_VETO') },
    operations: { ...input.operations, executionBoundary: good('UNLOCKED') },
  });
  assert.equal(receipt.readyForFirstPaperOrder, 'NO');
  assert.ok(receipt.blockers.includes('QUOTE_STALE'));
  assert.ok(receipt.blockers.includes('EV_MODEL_NOT_EMPIRICALLY_READY'));
  assert.ok(receipt.blockers.includes('EXPECTED_AFTER_COST_NOT_POSITIVE'));
  assert.ok(receipt.blockers.includes('AEGIS_BLOCKS_NEW_RISK'));
  assert.ok(receipt.blockers.includes('FIRST_POST_BOUNDARY_NOT_LOCKED'));
});

test('the first THETA order can only be a SELL_TO_OPEN put on the Paper master', () => {
  const input = validInput();
  const receipt = buildFirstPaperOrderReadinessReceipt({
    ...input,
    broker: { ...input.broker, role: good('FOLLOWER_THETA_PAPER'), host: good('https://api.alpaca.markets') },
    selection: { ...input.selection, optionType: good('CALL'), positionIntent: good('BUY_TO_OPEN') },
  });
  assert.equal(receipt.readyForFirstPaperOrder, 'NO');
  assert.ok(receipt.blockers.includes('BROKER_ROLE_NOT_MASTER_THETA_PAPER'));
  assert.ok(receipt.blockers.includes('BROKER_HOST_NOT_EXACT_PAPER_HOST'));
  assert.ok(receipt.blockers.includes('FIRST_THETA_ORDER_MUST_BE_CSP_PUT'));
  assert.ok(receipt.blockers.includes('FIRST_THETA_INTENT_NOT_SELL_TO_OPEN'));
});
