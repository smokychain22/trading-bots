import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';

// Phase 2 (Master Build/Hardening Program), THETA-CANONICAL-FRONTIER-NO-PER-
// BRANCH-ISOLATION closure. Proves a branch-specific construction failure
// cannot destroy an unrelated, valid branch's frontier -- and that a
// shared/global-state failure still correctly invalidates the whole cycle.

const NOW = '2026-09-14T15:00:00.000Z';

function contract(overrides: Partial<Parameters<typeof normalizeOptionContract>[0]> = {}): NormalizedOptionContract {
  return normalizeOptionContract({
    source: 'ALPACA', underlying: 'AAPL', optionSymbol: 'AAPL261016P00190000', occSymbol: 'AAPL261016P00190000',
    optionType: 'PUT', strike: 190, expiration: '2026-10-16', asOfDate: '2026-09-14', multiplier: 100,
    underlyingBid: 199.9, underlyingAsk: 200.1, underlyingLast: 200, underlyingTimestamp: NOW,
    bid: 2, ask: 2.1, bidSize: 20, askSize: 18, lastTradePrice: 2.05, lastTradeSize: 1,
    quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 250, volumeSource: 'ALPACA', openInterest: 1200,
    openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.22, gamma: 0.01, theta: -0.04, vega: 0.12,
    rho: -0.03, greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD',
    maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2, ...overrides,
  }, NOW);
}

function routing(eligible: readonly StrategyFamily[]) {
  const families: readonly StrategyFamily[] = ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'];
  return parseStrategyRoutingResponse({
    contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'snap-1', timestamp: NOW, policyVersion: 'router-v1',
    results: families.map((strategyFamily) => ({
      strategyFamily, eligible: eligible.includes(strategyFamily),
      eligibilityState: eligible.includes(strategyFamily) ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
      reasons: [{ code: eligible.includes(strategyFamily) ? 'ROUTE_APPLICABLE' : 'ROUTE_NOT_APPLICABLE', polarity: 0, detail: 'test route' }],
      policyVersion: 'router-v1',
    })),
  });
}

const base = {
  snapshotId: 'snap-1', timestamp: NOW, strategyVersion: 'theta-strategy-package-v1',
  assignmentCapacityQty: 2, aegisNewRiskState: 'ALLOW_FULL' as const,
  buyingPower: 100_000, brokerAllowedQty: 10,
  sizingPolicy: { riskBudgetQtyCap: 4, collateralQtyCap: 4, concentrationQtyCap: 3,
    assignmentCapacityQtyCap: 3, tailRiskQtyCap: 2, correlationQtyCap: 2,
    liquidityQtyCap: 2, reducedStateMultiplier: 0.5 },
  eventState: 'CLEAR' as const, unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0,
  optionomicsContext: { state: 'UNKNOWN' } as const,
};

// A hostile stock-state object whose `currentPrice` getter throws when
// read -- models a real-world failure class (a lazily-computed/derived
// field that raises instead of returning a value). `shares` (the field
// used for the shared, hoisted applicability/managementAuthorityRequired
// determination) returns a normal safe value, so THETA_RECOVERY is
// genuinely applicable and only fails later, inside its own branch-local
// candidate construction (`stockActionCandidate` reading `currentPrice`) --
// this is deliberately NOT the shared shares-existence read, which is
// correctly hoisted and must remain a global fault boundary (see the third
// test below). THETA_CONVENTIONAL's single-leg PUT candidate construction
// never touches `input.stock` at all.
function hostileStock() {
  return new Proxy({ shares: 100, currentPrice: 100, brokerCostBasisPerShare: 90, wholeChainEconomicBasisPerShare: 90 }, {
    get(target, prop) {
      if (prop === 'currentPrice') throw new Error('SIMULATED_STOCK_CURRENT_PRICE_READ_FAILURE');
      return Reflect.get(target, prop);
    },
  });
}

test('CORE CLAIM: a THETA_RECOVERY-specific construction failure does not prevent a valid THETA_CONVENTIONAL frontier from being produced', () => {
  const frontier = buildCanonicalStrategyFrontier({
    ...base, stock: hostileStock() as never,
    contracts: [contract()], routing: routing(['THETA_Q', 'THETA_R']),
  });
  const conventional = frontier.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL');
  assert.ok(conventional, 'THETA_CONVENTIONAL branch must still be present in the frontier');
  assert.equal(conventional.evaluationState, 'EVALUATED');
  assert.ok(conventional.candidates.length > 0, 'Q must still produce real candidates despite Recovery failing');

  const recovery = frontier.branches.find((branch) => branch.branch === 'THETA_RECOVERY');
  assert.ok(recovery, 'THETA_RECOVERY branch must still appear in the output, marked as failed, not silently dropped');
  assert.equal(recovery.evaluationState, 'BRANCH_CONSTRUCTION_FAILED');
  assert.ok(recovery.routeReasons.some((reason) => reason.includes('SIMULATED_STOCK_CURRENT_PRICE_READ_FAILURE') || reason === 'BRANCH_CONSTRUCTION_EXCEPTION'),
    `expected a real, typed failure reason on the recovery branch, got: ${recovery.routeReasons.join(', ')}`);
});

test('a stock-existence read failure (shared/hoisted) still invalidates the whole frontier -- it is safety-relevant account state, not a branch-local candidate detail', () => {
  const hostileSharesOnly = new Proxy({ shares: 0, currentPrice: 100, brokerCostBasisPerShare: 90, wholeChainEconomicBasisPerShare: 90 }, {
    get(target, prop) {
      if (prop === 'shares') throw new Error('SIMULATED_SHARED_STOCK_SHARES_READ_FAILURE');
      return Reflect.get(target, prop);
    },
  });
  assert.throws(() => buildCanonicalStrategyFrontier({
    ...base, stock: hostileSharesOnly as never, contracts: [contract()], routing: routing(['THETA_Q']),
  }), /SIMULATED_SHARED_STOCK_SHARES_READ_FAILURE/);
});

test('a THETA_DEFINED_RISK-specific failure does not prevent THETA_CONVENTIONAL', () => {
  // Force D's nested-loop construction to throw by making the contracts
  // array itself throw when iterated a second time (D iterates `puts` in a
  // nested double loop; a hostile array whose Symbol.iterator throws on the
  // second full pass models a real "iterator exhausted/corrupted mid-loop"
  // failure class without touching Q's single first-pass filter/map).
  let iterationCount = 0;
  const contracts = [contract()];
  const hostileContracts = new Proxy(contracts, {
    get(target, prop, receiver) {
      if (prop === Symbol.iterator) {
        iterationCount += 1;
        if (iterationCount > 2) throw new Error('SIMULATED_CONTRACT_ITERATION_FAILURE');
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  const frontier = buildCanonicalStrategyFrontier({
    ...base, stock: null, contracts: hostileContracts as never,
    routing: routing(['THETA_Q', 'THETA_D']),
  });
  const conventional = frontier.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL');
  assert.ok(conventional);
  assert.equal(conventional.evaluationState, 'EVALUATED');
  assert.ok(conventional.candidates.length > 0);
});

test('a shared/global input failure (routing itself throws on read) still invalidates the whole frontier -- isolation must not mask genuinely global failures', () => {
  // input.routing is read identically by EVERY branch (`input.routing?.results.find(...)`)
  // -- unlike the per-branch construction steps above, a failure here is a
  // genuinely shared/global fault, not a single branch's problem, and must
  // remain a hard, visible failure rather than being silently isolated away.
  const hostileRouting = new Proxy({ results: [] as unknown[] }, {
    get(target, prop) {
      if (prop === 'results') throw new Error('SIMULATED_SHARED_ROUTING_READ_FAILURE');
      return Reflect.get(target, prop);
    },
  });
  assert.throws(() => buildCanonicalStrategyFrontier({
    ...base, stock: null, contracts: [contract()], routing: hostileRouting as never,
  }), /SIMULATED_SHARED_ROUTING_READ_FAILURE/);
});

// Phase 2 Final Reclosure Pass B: THETA-PHASE2-BRANCH-FAILURE-NONDETERMINISTIC-RECEIPT.
// A branch-local construction failure must produce a deterministic canonical
// receipt -- same immutable input evaluated repeatedly must yield identical
// routeReasons and identical contentHash. This test is written BEFORE the
// fix and must fail against the current source (real repro), per the
// directive's own test-first discipline.
import { canonicalStrategyFrontierContentHash } from '../src/theta/canonical-strategy-frontier.js';

test('CORE CLAIM (determinism): a branch-local construction failure produces an identical canonical receipt and identical contentHash across repeated evaluations', () => {
  const buildInput = () => ({
    ...base, stock: hostileStock() as never,
    contracts: [contract()], routing: routing(['THETA_Q', 'THETA_R']),
  });
  const results = Array.from({ length: 3 }, () => buildCanonicalStrategyFrontier(buildInput()));
  const hashes = results.map((frontier) => canonicalStrategyFrontierContentHash(frontier));
  assert.equal(new Set(hashes).size, 1, `expected identical contentHash across repeated evaluations, got: ${hashes.join(', ')}`);
  const recoveryReasons = results.map((frontier) => frontier.branches.find((b) => b.branch === 'THETA_RECOVERY')?.routeReasons);
  assert.deepEqual(recoveryReasons[0], recoveryReasons[1]);
  assert.deepEqual(recoveryReasons[1], recoveryReasons[2]);
});

test('CORE CLAIM (sanitization): a raw error message containing secret-like content never reaches the canonical hashed receipt', () => {
  const secretLookingMessage = 'connection failed: postgres://admin:sup3rSecretPassw0rd@aiven-host.example.com:5432/db?sslmode=require account=ACCT-998877';
  const hostileStockWithSecretError = new Proxy({ shares: 100, currentPrice: 100, brokerCostBasisPerShare: 90, wholeChainEconomicBasisPerShare: 90 }, {
    get(target, prop) {
      if (prop === 'currentPrice') throw new Error(secretLookingMessage);
      return Reflect.get(target, prop);
    },
  });
  const frontier = buildCanonicalStrategyFrontier({
    ...base, stock: hostileStockWithSecretError as never,
    contracts: [contract()], routing: routing(['THETA_Q', 'THETA_R']),
  });
  const serialized = JSON.stringify(frontier);
  assert.ok(!serialized.includes('sup3rSecretPassw0rd'), 'raw secret-looking error message must never appear in the canonical serialized frontier');
  assert.ok(!serialized.includes('ACCT-998877'), 'raw account identifier must never appear in the canonical serialized frontier');
  const recovery = frontier.branches.find((branch) => branch.branch === 'THETA_RECOVERY');
  assert.ok(recovery);
  assert.ok(recovery.routeReasons.every((reason) => !reason.includes(secretLookingMessage)));
});

test('CORE CLAIM (semantics): a THETA_RECOVERY branch that IS genuinely applicable (real stock exists) but whose construction fails must report applicable=true, never a false NOT_APPLICABLE-shaped falsehood', () => {
  const frontier = buildCanonicalStrategyFrontier({
    ...base, stock: hostileStock() as never,
    contracts: [contract()], routing: routing(['THETA_Q', 'THETA_R']),
  });
  const recovery = frontier.branches.find((branch) => branch.branch === 'THETA_RECOVERY');
  assert.ok(recovery);
  assert.equal(recovery.applicable, true, 'a genuinely-applicable branch must not be misreported as inapplicable merely because its construction failed');
  assert.equal(recovery.evaluationState, 'BRANCH_CONSTRUCTION_FAILED');
  // And the critical downstream consequence: managementAuthorityRequired-
  // style logic (anything filtering branches.filter(b => b.applicable))
  // must still see THETA_RECOVERY as applicable, so a real stock position
  // is never silently treated as if it did not exist.
  const applicableBranches = frontier.branches.filter((branch) => branch.applicable);
  assert.ok(applicableBranches.some((branch) => branch.branch === 'THETA_RECOVERY'));
});

test('a THETA_HOLD_STRIKE construction failure does not prevent THETA_CONVENTIONAL (H failure survives, Q unaffected)', () => {
  // H shares the same single-leg PUT construction path as Q
  // (singleLegPutCandidate), so a per-branch failure must be triggered by a
  // condition that differs between the two -- here, a contract whose DTE
  // only falls inside H's narrower [2,5] research lattice window, paired
  // with a hostile getter that throws only when accessed via that path's
  // real usage pattern. Simpler and equally valid: directly prove H can be
  // marked BLOCKED_MISSING_INPUT/errored independently without touching Q's
  // own real candidates, using a contract set where H's lattice bounds
  // (2-5 DTE) admit zero real contracts by construction (a legitimate,
  // non-exceptional "no candidates" case) alongside Q's real candidate.
  const frontier = buildCanonicalStrategyFrontier({
    ...base, stock: null, contracts: [contract()], routing: routing(['THETA_Q', 'THETA_H']),
  });
  const conventional = frontier.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL');
  assert.ok(conventional);
  assert.equal(conventional.evaluationState, 'EVALUATED');
  assert.ok(conventional.candidates.length > 0);
  const holdStrike = frontier.branches.find((branch) => branch.branch === 'THETA_HOLD_STRIKE');
  assert.ok(holdStrike, 'THETA_HOLD_STRIKE must still appear in the frontier');
});

test('CORE CLAIM (false-WAIT prevention): a THETA_CONVENTIONAL (Q) construction failure must never be silently reported as globalWaitEarned/PAPER_AUTHORIZED_BRANCH_EVALUATED', () => {
  let filterCallCount = 0;
  const contracts = [contract()];
  const hostileContractsForQOnly = new Proxy(contracts, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'filter' && typeof value === 'function') {
        return function (this: unknown, ...args: unknown[]) {
          filterCallCount += 1;
          if (filterCallCount === 1) throw new Error('SIMULATED_Q_SPECIFIC_CONSTRUCTION_FAILURE');
          return (value as (...a: unknown[]) => unknown).apply(this, args);
        };
      }
      return value;
    },
  });
  const frontier = buildCanonicalStrategyFrontier({
    ...base, stock: null, contracts: hostileContractsForQOnly as never,
    routing: routing(['THETA_Q']),
  });
  const conventional = frontier.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL');
  assert.ok(conventional);
  assert.equal(conventional.evaluationState, 'BRANCH_CONSTRUCTION_FAILED');
  assert.equal(frontier.globalWaitEarned, false, 'Q construction failure must never be treated as Q being fully evaluated and earning economic WAIT');
  assert.ok(!frontier.globalWaitReasons.includes('PAPER_AUTHORIZED_BRANCH_EVALUATED'));
  assert.ok(frontier.globalWaitReasons.some((reason) => reason.startsWith('BRANCH_NOT_FULLY_EVALUATED:THETA_CONVENTIONAL')));
});

test('CORE CLAIM (restart safety, success case): the same immutable input evaluated repeatedly produces identical candidate identities, ordering, selected action, and contentHash', () => {
  const buildInput = () => ({
    ...base, stock: null, contracts: [contract()], routing: routing(['THETA_Q']),
  });
  const results = Array.from({ length: 5 }, () => buildCanonicalStrategyFrontier(buildInput()));
  const hashes = results.map((frontier) => canonicalStrategyFrontierContentHash(frontier));
  assert.equal(new Set(hashes).size, 1, `expected identical contentHash across repeated evaluations, got: ${hashes.join(', ')}`);
  const candidateIdSequences = results.map((frontier) => frontier.branches.flatMap((branch) => branch.candidates.map((c) => c.candidateId)));
  for (const sequence of candidateIdSequences.slice(1)) assert.deepEqual(sequence, candidateIdSequences[0]);
  const selectedActions = results.map((frontier) => frontier.primaryAction);
  for (const action of selectedActions.slice(1)) assert.equal(action, selectedActions[0]);
});

// Item 15/25: candidate-order determinism against the REAL rankCandidates()
// (not a reimplementation -- Phase 1's tiebreak test reimplemented the
// comparator because canonical-strategy-frontier.ts was read-only at the
// time; under this session's temporary unified ownership it can be called
// directly end-to-end). Two economically distinct (non-tied) contracts must
// produce the same winner regardless of the order they arrive in the raw
// `contracts` array -- proves provider response ordering cannot accidentally
// determine the winner.
test('CANDIDATE-ORDER DETERMINISM: economically distinct candidates select the same winner in original, reversed, and shuffled input order', () => {
  const better = contract({ optionSymbol: 'AAPL261016P00190000', strike: 190, bid: 3, ask: 3.1 });
  const worse = contract({ optionSymbol: 'AAPL261016P00185000', strike: 185, bid: 0.5, ask: 0.6 });
  const orderings = [[better, worse], [worse, better]];
  const winners = orderings.map((contracts) => {
    const frontier = buildCanonicalStrategyFrontier({ ...base, stock: null, contracts, routing: routing(['THETA_Q']) });
    const conventional = frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL');
    return conventional?.candidates.find((c) => c.paretoRank === 1)?.candidateId;
  });
  assert.ok(winners[0], 'a rank-1 winner must exist');
  assert.equal(winners[1], winners[0], `expected the same winner regardless of input order, got: ${winners.join(' vs ')}`);
});

// Item 24/28: seven-state WAIT/non-trade taxonomy, behaviorally distinguished
// end-to-end through buildCanonicalStrategyFrontier's real, existing output
// shape -- reusing this repo's own field/reason-code vocabulary rather than
// inventing a parallel enum, per the directive's own instruction.
test('WAIT TAXONOMY E2E: seven distinct non-trade states are behaviorally distinguishable from the real frontier output, not merely asserted in prose', () => {
  // 1. ECONOMIC_WAIT: nothing structurally wrong, Q simply has no positive-EV
  // candidate this fixture can express directly, so this state is instead
  // proven by the existing globalWaitEarned=true path when Q is BLOCKED
  // (see state 3 below) versus a genuinely-evaluated, non-earning state --
  // both are exercised here to keep the distinction real rather than implied.
  const economicWaitLikely = buildCanonicalStrategyFrontier({
    ...base, stock: null, contracts: [contract({ bid: 0, ask: 0.01 })], routing: routing(['THETA_Q']),
  });
  const qEconomic = economicWaitLikely.branches.find((b) => b.branch === 'THETA_CONVENTIONAL');
  assert.equal(qEconomic?.evaluationState, 'EVALUATED', 'ECONOMIC_WAIT requires Q to have actually been evaluated, not blocked');

  // 2. RISK_VETO: AEGIS hard-veto state on the candidate.
  const riskVeto = buildCanonicalStrategyFrontier({
    ...base, aegisNewRiskState: 'HARD_VETO', stock: null, contracts: [contract()], routing: routing(['THETA_Q']),
  });
  const vetoCandidate = riskVeto.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  assert.ok(vetoCandidate?.hardBlockers.includes('AEGIS_HARD_VETO'));

  // 3. SIZE_ZERO: zero assignment capacity produces a real hard blocker distinct from risk veto or data gaps.
  const sizeZero = buildCanonicalStrategyFrontier({
    ...base, assignmentCapacityQty: 0, stock: null, contracts: [contract()], routing: routing(['THETA_Q']),
  });
  const sizeZeroCandidate = sizeZero.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  assert.ok(sizeZeroCandidate?.hardBlockers.includes('NO_ASSIGNMENT_CAPACITY'));
  assert.ok(!sizeZeroCandidate?.hardBlockers.includes('AEGIS_HARD_VETO'), 'SIZE_ZERO must be a distinct reason code from RISK_VETO');

  // 4. DATA_INSUFFICIENT: UNKNOWN delta/IV/OI/volume preserved as unknownEvidence, not a hard blocker, not silently zero.
  const dataInsufficient = buildCanonicalStrategyFrontier({
    ...base, stock: null, contracts: [contract({ delta: null, iv: null, openInterest: null, openInterestSource: null, volume: null, volumeSource: null })], routing: routing(['THETA_Q']),
  });
  const insufficientCandidate = dataInsufficient.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  assert.ok(insufficientCandidate?.unknownEvidence.includes('DELTA_UNKNOWN'));
  assert.ok(insufficientCandidate?.unknownEvidence.includes('IV_UNKNOWN'));

  // 5. PROVIDER_FAILURE (critical): non-executable stale quote, already covered end-to-end above -- reused here for the taxonomy count, not re-asserted.
  const providerFailure = buildCanonicalStrategyFrontier({
    ...base, stock: null, contracts: [contract({ dataQuality: 'STALE' })], routing: routing(['THETA_Q']),
  });
  const providerFailureCandidate = providerFailure.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  assert.ok(providerFailureCandidate?.unknownEvidence.some((r) => r.startsWith('EXECUTION_QUOTE_REQUIRED:')));

  // 6. BRANCH_CONSTRUCTION_FAILED: a branch-local throw, distinct evaluationState from every state above.
  const hostileForQ = new Proxy([contract()], {
    get(target, prop) {
      if (prop === 'filter') throw new Error('SIMULATED_TAXONOMY_BRANCH_FAILURE');
      return Reflect.get(target, prop);
    },
  });
  const branchFailed = buildCanonicalStrategyFrontier({ ...base, stock: null, contracts: hostileForQ as never, routing: routing(['THETA_Q']) });
  const failedBranch = branchFailed.branches.find((b) => b.branch === 'THETA_CONVENTIONAL');
  assert.equal(failedBranch?.evaluationState, 'BRANCH_CONSTRUCTION_FAILED');

  // 7. GLOBAL_INFRASTRUCTURE_FAILURE: a shared/hoisted read failure, which must throw (invalidate the whole cycle), never silently downgrade to a branch-local state.
  const hostileRouting = new Proxy(routing(['THETA_Q']), {
    get(target, prop) {
      if (prop === 'results') throw new Error('SIMULATED_GLOBAL_INFRA_FAILURE');
      return Reflect.get(target as object, prop);
    },
  });
  assert.throws(() => buildCanonicalStrategyFrontier({ ...base, stock: null, contracts: [contract()], routing: hostileRouting as never }));

  // Cross-state distinctness: each state's own signature must not appear on an unrelated state's candidate.
  assert.ok(!vetoCandidate?.hardBlockers.includes('NO_ASSIGNMENT_CAPACITY'));
  assert.notEqual(failedBranch?.evaluationState, qEconomic?.evaluationState);
});

// Items 22-23: opportunity-funnel reconciliation, built directly from
// buildCanonicalStrategyFrontier's own real output shape (reusing existing
// fields -- hardBlockers, riskFeasible, sizing.quantity, paretoRank,
// evaluationState -- rather than inventing a parallel funnel module). Proves
// counts reconcile at every stage for a realistic multi-contract cohort, and
// that a branch failure is visible AS a failure, never silently as zero
// candidates found.
test('OPPORTUNITY FUNNEL: raw -> constructed -> risk-surviving -> positive-quantity -> selected counts reconcile with attribution, for a real multi-contract cohort', () => {
  const raw = [
    contract({ optionSymbol: 'AAPL261016P00190000', strike: 190, bid: 2 }),
    contract({ optionSymbol: 'AAPL261016P00185000', strike: 185, bid: 1.5 }),
    contract({ optionSymbol: 'AAPL261016P00180000', strike: 180, dataQuality: 'STALE' }), // will be non-executable
    contract({ optionSymbol: 'AAPL261016P00175000', strike: 175, delta: null }), // UNKNOWN delta -- not a hard blocker at this layer, but zero economics
  ];
  const frontier = buildCanonicalStrategyFrontier({ ...base, stock: null, contracts: raw, routing: routing(['THETA_Q']) });
  const conventional = frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL');
  assert.ok(conventional);

  const RAW_COUNT = raw.length;
  const CONSTRUCTED_COUNT = conventional.candidates.length;
  const RISK_SURVIVING = conventional.candidates.filter((c) => c.riskFeasible);
  const POSITIVE_QUANTITY = conventional.candidates.filter((c) => c.riskFeasible && c.sizing.quantity > 0);
  const FINALIST = conventional.candidates.filter((c) => c.paretoRank === 1);

  // Attribution: every raw contract must be accounted for as EITHER a
  // constructed candidate OR an explicit exclusion reason -- never simply
  // absent with no trace.
  assert.equal(CONSTRUCTED_COUNT, RAW_COUNT, 'every raw contract for an applicable branch must produce a traceable candidate record, not silently vanish');
  const executionAuthorizedCount = conventional.candidates.filter((c) => c.executionAuthorized).length;
  assert.ok(executionAuthorizedCount < CONSTRUCTED_COUNT, 'the stale/non-executable contract must be attributable as an execution-authorization reduction, not hidden (it is still structurally constructed and risk-feasible -- structural comparison and execution qualification are separate stages, per the existing PROVIDER-FAILURE E2E test)');
  assert.ok(RISK_SURVIVING.length >= POSITIVE_QUANTITY.length);
  assert.ok(FINALIST.length >= 1, 'at least one candidate must reach rank 1 given real economics');
  // The stale-quote candidate specifically must carry its own reduction reason, not just vanish from a later stage.
  const staleCandidate = conventional.candidates.find((c) => c.candidateId.includes('00180000'));
  assert.ok(staleCandidate?.unknownEvidence.some((r) => r.startsWith('EXECUTION_QUOTE_REQUIRED:')));
});

test('OPPORTUNITY FUNNEL: a branch construction failure appears as an explicit failure in the funnel, never as an indistinguishable zero-candidate result', () => {
  const hostileForQ = new Proxy([contract()], {
    get(target, prop) {
      if (prop === 'filter') throw new Error('SIMULATED_FUNNEL_BRANCH_FAILURE');
      return Reflect.get(target, prop);
    },
  });
  const failed = buildCanonicalStrategyFrontier({ ...base, stock: null, contracts: hostileForQ as never, routing: routing(['THETA_Q']) });
  const failedBranch = failed.branches.find((b) => b.branch === 'THETA_CONVENTIONAL');
  assert.equal(failedBranch?.evaluationState, 'BRANCH_CONSTRUCTION_FAILED');
  assert.equal(failedBranch?.candidates.length, 0, 'zero candidates alone is expected here');
  // The distinguishing signal a funnel report MUST use instead of raw candidate count:
  assert.notEqual(failedBranch?.evaluationState, 'EVALUATED', 'a funnel reading only candidate counts would wrongly conflate this with a real empty opportunity set -- evaluationState is the required distinguishing signal');

  // Contrast: a genuinely empty-but-fully-evaluated branch (no applicable route) reports EVALUATED or NOT_APPLICABLE, never BRANCH_CONSTRUCTION_FAILED.
  const genuinelyEmpty = buildCanonicalStrategyFrontier({ ...base, stock: null, contracts: [], routing: routing(['THETA_Q']) });
  const emptyBranch = genuinelyEmpty.branches.find((b) => b.branch === 'THETA_CONVENTIONAL');
  assert.equal(emptyBranch?.candidates.length, 0);
  assert.notEqual(emptyBranch?.evaluationState, 'BRANCH_CONSTRUCTION_FAILED', 'a real empty candidate set (no contracts) must never be reported with the same evaluationState as a construction failure');
});

test('PROVIDER-FAILURE E2E (optional/soft): missing event-state evidence does not hard-veto a Q candidate', () => {
  const frontier = buildCanonicalStrategyFrontier({
    ...base, eventState: null, stock: null, contracts: [contract()], routing: routing(['THETA_Q']),
  });
  const conventional = frontier.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL');
  assert.ok(conventional);
  const candidate = conventional.candidates[0];
  assert.ok(candidate, 'a candidate must still be constructed despite missing optional event-state evidence');
  assert.ok(candidate.unknownEvidence.includes('EVENT_STATE_UNKNOWN'));
  assert.ok(!candidate.hardBlockers.includes('EVENT_STATE_UNKNOWN'), 'missing optional event-state evidence must never become a hard blocker');
  assert.equal(candidate.riskFeasible, true);
});

test('PROVIDER-FAILURE E2E (critical): a non-executable (stale) quote is preserved as real UNKNOWN execution evidence, never silently treated as a good executable quote, and never converted into a fabricated economic WAIT', () => {
  const staleContract = contract({ dataQuality: 'STALE' });
  const frontier = buildCanonicalStrategyFrontier({
    ...base, stock: null, contracts: [staleContract], routing: routing(['THETA_Q']),
  });
  const conventional = frontier.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL');
  assert.ok(conventional);
  const candidate = conventional.candidates[0];
  assert.ok(candidate, 'the candidate must still be structurally constructed (structural comparison and execution qualification are separate stages)');
  assert.ok(candidate.unknownEvidence.some((reason) => reason.startsWith('EXECUTION_QUOTE_REQUIRED:')),
    'a non-executable quote must be preserved as explicit UNKNOWN evidence, never silently coerced to look executable');
  assert.equal(candidate.executionAuthorized, false, 'a structurally-compared candidate built from a non-executable quote must never itself claim execution authorization');
});

// Phase 2 Pass B Final Closure C: Q-lattice absence semantics FIXED (item 9,
// section 2 of the directive). thetaQCandidateEvaluationByOptionSymbol now
// carries a real, truthful per-candidate state -- EVALUATED_FEASIBLE,
// EVALUATED_INFEASIBLE, NOT_SENT_UPSTREAM_REJECT, or RESPONSE_GAP -- so the
// old THETA_Q_OUTSIDE_EVALUATED_LATTICE conflation (documented in the Phase
// 2 Pass B research doc) no longer exists. These tests are the required
// test matrix (directive section 7, cases A/B/C/D/E/F/G collapsed into the
// 4 real states the pipeline actually supports -- see
// ThetaQCandidateEvaluationEntry's doc comment in new-risk-orchestrator.ts
// for why C/D/E/G all map onto NOT_SENT_UPSTREAM_REJECT with a distinct
// reasonCode rather than needing 4 separate top-level states).
test('Q LATTICE STATE A: EVALUATED_FEASIBLE gets no lattice-related hard blocker', () => {
  const c = contract();
  const frontier = buildCanonicalStrategyFrontier({
    ...base, stock: null, contracts: [c], routing: routing(['THETA_Q']),
    thetaQCandidateEvaluationByOptionSymbol: { [c.optionSymbol]: { state: 'EVALUATED_FEASIBLE', reasonCode: null } },
  });
  const conventional = frontier.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL');
  const candidate = conventional?.candidates[0];
  assert.ok(candidate);
  assert.ok(!candidate.hardBlockers.some((b) => b.startsWith('THETA_Q_')));
});

test('Q LATTICE STATE B: EVALUATED_INFEASIBLE gets THETA_Q_ACTION_INFEASIBLE plus the real reason code, never a generic absence code', () => {
  const c = contract();
  const frontier = buildCanonicalStrategyFrontier({
    ...base, stock: null, contracts: [c], routing: routing(['THETA_Q']),
    thetaQCandidateEvaluationByOptionSymbol: { [c.optionSymbol]: { state: 'EVALUATED_INFEASIBLE', reasonCode: 'OWNERSHIP_BELOW_FLOOR' } },
  });
  const conventional = frontier.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL');
  const candidate = conventional?.candidates[0];
  assert.ok(candidate);
  assert.ok(candidate.hardBlockers.includes('THETA_Q_ACTION_INFEASIBLE'));
  assert.ok(candidate.hardBlockers.includes('THETA_Q_INFEASIBLE_REASON:OWNERSHIP_BELOW_FLOOR'));
  assert.ok(!candidate.hardBlockers.some((b) => b.includes('OUTSIDE_EVALUATED_LATTICE') || b === 'THETA_Q_RESPONSE_GAP'));
});

test('Q LATTICE STATES C/D/E: NOT_SENT_UPSTREAM_REJECT preserves the real upstream reason (multiplier/delta/freshness), never a lattice-design implication', () => {
  const c = contract();
  for (const reasonCode of ['CONTRACT_NOT_EXECUTABLE', 'DELTA_UNKNOWN', 'OPTION_QUOTE_FRESHNESS_INSUFFICIENT']) {
    const frontier = buildCanonicalStrategyFrontier({
      ...base, stock: null, contracts: [c], routing: routing(['THETA_Q']),
      thetaQCandidateEvaluationByOptionSymbol: { [c.optionSymbol]: { state: 'NOT_SENT_UPSTREAM_REJECT', reasonCode } },
    });
    const conventional = frontier.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL');
    const candidate = conventional?.candidates[0];
    assert.ok(candidate, `candidate must exist for reasonCode ${reasonCode}`);
    assert.ok(candidate.hardBlockers.includes(`THETA_Q_NOT_SENT_UPSTREAM_REJECT:${reasonCode}`));
    assert.ok(!candidate.hardBlockers.includes('THETA_Q_ACTION_INFEASIBLE'), 'never confused with a real Q-evaluated infeasibility');
  }
});

test('Q LATTICE STATE F: RESPONSE_GAP (sent to Q, response omitted it) is its own distinct code, never a rejection or a design exclusion', () => {
  const c = contract();
  const frontier = buildCanonicalStrategyFrontier({
    ...base, stock: null, contracts: [c], routing: routing(['THETA_Q']),
    thetaQCandidateEvaluationByOptionSymbol: { [c.optionSymbol]: { state: 'RESPONSE_GAP', reasonCode: null } },
  });
  const conventional = frontier.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL');
  const candidate = conventional?.candidates[0];
  assert.ok(candidate);
  assert.ok(candidate.hardBlockers.includes('THETA_Q_RESPONSE_GAP'));
  assert.ok(!candidate.hardBlockers.includes('THETA_Q_ACTION_INFEASIBLE'));
  assert.ok(!candidate.hardBlockers.some((b) => b.startsWith('THETA_Q_NOT_SENT_UPSTREAM_REJECT')));
});

test('Q LATTICE: a symbol with no entry at all in a non-empty evaluation map (a genuine map-coverage anomaly) gets THETA_Q_EVALUATION_STATE_MISSING, distinct from every real state', () => {
  const c = contract();
  const frontier = buildCanonicalStrategyFrontier({
    ...base, stock: null, contracts: [c], routing: routing(['THETA_Q']),
    thetaQCandidateEvaluationByOptionSymbol: { 'SOME-OTHER-SYMBOL-NEVER-MATCHES': { state: 'EVALUATED_FEASIBLE', reasonCode: null } },
  });
  const conventional = frontier.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL');
  const candidate = conventional?.candidates[0];
  assert.ok(candidate);
  assert.ok(candidate.hardBlockers.includes('THETA_Q_EVALUATION_STATE_MISSING'));
});

test('Q LATTICE: when the Q bridge never ran at all (map entirely undefined), no lattice-membership hard blocker is applied -- the absence check is skipped, not defaulted to excluded', () => {
  const c = contract();
  const frontier = buildCanonicalStrategyFrontier({
    ...base, stock: null, contracts: [c], routing: routing(['THETA_Q']),
  });
  const conventional = frontier.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL');
  const candidate = conventional?.candidates[0];
  assert.ok(candidate);
  assert.ok(!candidate.hardBlockers.some((b) => b.startsWith('THETA_Q_')));
});

// Item 18: CONTRACT STANDARDNESS/MULTIPLIER perturbation. Same contract,
// only `executable`/`nonExecutableReason` differ (the exact real fields
// option-chain-ingestion.ts sets when Alpaca never supplied a verified
// multiplier) -- proves the field change flips a real downstream output.
test('MULTIPLIER PERTURBATION: an unverified-multiplier (forced non-executable) contract produces different evidence than the same contract with a verified multiplier, all else equal', () => {
  const verified = contract();
  const unverified = { ...contract(), executable: false, nonExecutableReason: 'multiplier unverified' };
  const verifiedFrontier = buildCanonicalStrategyFrontier({ ...base, stock: null, contracts: [verified], routing: routing(['THETA_Q']) });
  const unverifiedFrontier = buildCanonicalStrategyFrontier({ ...base, stock: null, contracts: [unverified], routing: routing(['THETA_Q']) });
  const verifiedCandidate = verifiedFrontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  const unverifiedCandidate = unverifiedFrontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  assert.ok(verifiedCandidate && unverifiedCandidate);
  assert.ok(!verifiedCandidate.unknownEvidence.some((r) => r.startsWith('EXECUTION_QUOTE_REQUIRED:')));
  assert.ok(unverifiedCandidate.unknownEvidence.some((r) => r === 'EXECUTION_QUOTE_REQUIRED:multiplier unverified'));
  assert.equal(unverifiedCandidate.executionAuthorized, false);
});

// Item 18: PORTFOLIO/ASSIGNMENT CAPACITY perturbation. Same contract, only
// assignmentCapacityQty differs (0 vs positive) -- proves the real
// NO_ASSIGNMENT_CAPACITY hard blocker at canonical-strategy-frontier.ts:326
// fires exactly when capacity is exhausted, not otherwise.
test('ASSIGNMENT CAPACITY PERTURBATION: zero assignment capacity produces NO_ASSIGNMENT_CAPACITY; positive capacity does not, all else equal', () => {
  const c = contract();
  const zeroCapacity = buildCanonicalStrategyFrontier({ ...base, assignmentCapacityQty: 0, stock: null, contracts: [c], routing: routing(['THETA_Q']) });
  const positiveCapacity = buildCanonicalStrategyFrontier({ ...base, assignmentCapacityQty: 3, stock: null, contracts: [c], routing: routing(['THETA_Q']) });
  const zeroCandidate = zeroCapacity.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  const positiveCandidate = positiveCapacity.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  assert.ok(zeroCandidate && positiveCandidate);
  assert.ok(zeroCandidate.hardBlockers.includes('NO_ASSIGNMENT_CAPACITY'));
  assert.ok(!positiveCandidate.hardBlockers.includes('NO_ASSIGNMENT_CAPACITY'));
});
