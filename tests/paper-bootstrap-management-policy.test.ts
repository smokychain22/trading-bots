import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementActionFrontier } from '../src/theta/management-action-frontier.js';
import { assembleManagementInput } from '../src/theta/management-input-state.js';
import {
  evaluatePaperBootstrapManagementPolicy, PaperBootstrapManagementPolicyProvider,
  type RollCandidate,
} from '../src/theta/paper-bootstrap-management-policy.js';

const state = (lifecycleState: string, overrides: Record<string, unknown> = {},
  observedAt = '2026-09-12T14:00:00.000Z', expiration = '2026-10-16') => assembleManagementInput({
  chain_id: 'chain', lifecycle_state: lifecycleState, underlying_id: 'underlying', underlying: 'AAPL',
  option_leg_id: 'leg', option_contract_id: 'contract', quantity: '1',
  entry_credit_debit: '200', contract_symbol: 'AAPL261016P00200000', option_type: 'PUT', strike: '200',
  expiration_date: expiration, multiplier: '100', bid: '1', ask: '1.1', quote_as_of: observedAt,
  feed: 'OPRA', quote_quality: 'GOOD', realized_option_pnl: '0',
  open_stock_shares: lifecycleState === 'RECOVERY_WAIT' ? '100' : '0',
  stock_basis_per_share: lifecycleState === 'RECOVERY_WAIT' ? '195' : null, realized_stock_pnl: '0', dividends: '0', fees: '0',
  buying_power: '50000', options_buying_power: '40000', account_as_of: observedAt, fusion_snapshot_id: 'fusion',
  snapshot_json: { underlyingState: { last: 205 }, marketSession: { isOpen: false },
    riskState: { assignmentCapacity: 1, newRiskState: 'ALLOW_FULL' }, eventState: { state: 'CLEAR' } },
  broker_position: lifecycleState === 'RECOVERY_WAIT' ? { currentPrice: 190 } : null,
  ...overrides,
}, { managementInputSnapshotId: 'input', reconciliationSnapshotId: 'recon', observedAt });

const rollCandidate = (overrides: Partial<RollCandidate> = {}): RollCandidate => ({
  optionContractId: 'target', symbol: 'AAPL261120P00195000', optionType: 'PUT', strike: 195,
  expiration: '2026-11-20', multiplier: 100, quantity: 1, bid: 1.5, ask: 1.6, ...overrides,
});

test('CSP_OPEN with no known reason to act and no roll candidate holds', () => {
  const evidence = evaluatePaperBootstrapManagementPolicy(state('CSP_OPEN'));
  assert.ok(evidence !== null);
  assert.equal(evidence?.selectedAction, 'HOLD');
  assert.ok(evidence?.reasonCodes.includes('BOOTSTRAP_DETERMINISTIC_NO_EMPIRICAL_CLAIM'));
});

test('CSP_OPEN near expiration with near-exhausted remaining value closes deterministically', () => {
  const input = state('CSP_OPEN', { bid: 0.01, ask: 0.02 }, '2026-10-13T14:00:00.000Z');
  const evidence = evaluatePaperBootstrapManagementPolicy(input);
  assert.equal(evidence?.selectedAction, 'CLOSE_FULL');
  const frontier = buildManagementActionFrontier(input, evidence ?? null);
  assert.equal(frontier.selectedAction, 'CLOSE_FULL');
  assert.equal(frontier.decisionState, 'ACTION_SELECTED');
});

test('CSP_OPEN with a complete, positive-net-credit roll candidate rolls without any empirical EV model', () => {
  const input = state('CSP_OPEN', {}, '2026-09-12T14:00:00.000Z');
  const withCandidate = { ...input, rollCandidate: rollCandidate() };
  const evidence = evaluatePaperBootstrapManagementPolicy(withCandidate);
  assert.equal(evidence?.selectedAction, 'ROLL');
  const execution = evidence?.actionValues.find((value) => value.action === 'ROLL')?.executionEvidence;
  assert.equal(execution?.deterministicEconomicsValidated, true);
  assert.ok(execution?.deterministicNetCredit !== null && (execution.deterministicNetCredit ?? 0) > 0);
  assert.equal(execution?.empiricalEconomicsReady, false);
  const frontier = buildManagementActionFrontier(input, evidence ?? null);
  assert.equal(frontier.selectedAction, 'ROLL');
  assert.equal(frontier.decisionState, 'ACTION_SELECTED');
  assert.ok(!frontier.actions.find((action) => action.action === 'ROLL')?.blockers.includes('EMPIRICAL_ACTION_EV_UNKNOWN'));
});

test('a roll candidate with a net debit never outranks passive HOLD', () => {
  // currentMark (close cost) is ~$105 (bid 1 / ask 1.1 * 100). A target with
  // far smaller premium (bid 0.3 / ask 0.4) yields LESS open credit than the
  // known cost to close the old leg -- a genuine net debit.
  const input = state('CSP_OPEN');
  const debitCandidate = rollCandidate({ bid: 0.3, ask: 0.4 });
  const evidence = evaluatePaperBootstrapManagementPolicy({ ...input, rollCandidate: debitCandidate });
  assert.equal(evidence?.selectedAction, 'HOLD');
  const rejected = evidence?.actionValues.find((value) => value.action === 'ROLL');
  assert.ok((rejected?.executionEvidence?.deterministicNetCredit ?? 0) < 0);
});

test('CSP_OPEN with multiple roll candidates picks the one with the best RollIncrementalUtility, not merely the largest net credit', () => {
  const input = state('CSP_OPEN');
  const withCandidates = {
    ...input,
    rollCandidates: [
      // Much larger net credit (405 vs. 20), but a far-out expiration (91
      // extra days) and a much larger capital commitment -- expensive to carry.
      rollCandidate({ optionContractId: 'far-and-big', strike: 250, expiration: '2027-01-15', bid: 5, ask: 5.2 }),
      // Small net credit, short extension (7 days), and slightly LESS
      // capital committed than the old leg -- cheap to carry.
      rollCandidate({ optionContractId: 'near-and-small', strike: 195, expiration: '2026-10-23', bid: 1.6, ask: 1.7 }),
    ],
    rollIncrementalCapitalDayWeight: 0.005,
  };
  const evidence = evaluatePaperBootstrapManagementPolicy(withCandidates);
  assert.equal(evidence?.selectedAction, 'ROLL');
  const execution = evidence?.actionValues.find((value) => value.action === 'ROLL')?.executionEvidence;
  assert.equal(execution?.targetContract?.optionContractId, 'near-and-small');
  const rollValue = evidence?.actionValues.find((value) => value.action === 'ROLL');
  assert.ok(rollValue?.reasons.includes('BEST_OF_2_ROLL_CANDIDATES'));
});

test('rollCandidates takes precedence over the single rollCandidate field when both are present', () => {
  const input = state('CSP_OPEN');
  const withBoth = {
    ...input,
    rollCandidate: rollCandidate({ optionContractId: 'single-path-candidate' }),
    rollCandidates: [rollCandidate({ optionContractId: 'plural-path-candidate' })],
  };
  const evidence = evaluatePaperBootstrapManagementPolicy(withBoth);
  const execution = evidence?.actionValues.find((value) => value.action === 'ROLL')?.executionEvidence;
  assert.equal(execution?.targetContract?.optionContractId, 'plural-path-candidate');
});

test('ROLL never uses the midpoint as the deterministic new-leg credit -- it uses the bid side', () => {
  const input = state('CSP_OPEN');
  // bid=1.5, ask=1.6 -> mid would be 155, bid-side is 150.
  const withCandidate = { ...input, rollCandidate: rollCandidate({ bid: 1.5, ask: 1.6 }) };
  const evidence = evaluatePaperBootstrapManagementPolicy(withCandidate);
  const execution = evidence?.actionValues.find((value) => value.action === 'ROLL')?.executionEvidence;
  // openEconomicBoundary is the new leg's credit; currentMark (close cost)
  // is now the ASK side (110), so deterministicNetCredit = 150 - 110 = 40,
  // never the mid-based 155 - 105 = 50 this would have been before the fix.
  assert.equal(execution?.openEconomicBoundary, 150);
  assert.ok(execution?.deterministicNetCredit !== null && Math.abs((execution.deterministicNetCredit ?? 0) - 40) < 1e-9);
  const rollValue = evidence?.actionValues.find((value) => value.action === 'ROLL');
  assert.ok(rollValue?.reasons.some((reason) => reason.startsWith('OPEN_CREDIT_BID_SIDE_150')));
  assert.ok(rollValue?.reasons.some((reason) => reason.startsWith('OPEN_CREDIT_MID_REFERENCE_ANALYTICAL_ONLY_155')));
});

test('ROLL_CC never uses the midpoint as the deterministic new-leg credit -- it uses the bid side', () => {
  const input = state('CC_OPEN');
  const withCandidate = { ...input, ccCandidate: rollCandidate({ optionType: 'CALL', bid: 1.5, ask: 1.6 }) };
  const evidence = evaluatePaperBootstrapManagementPolicy(withCandidate);
  const execution = evidence?.actionValues.find((value) => value.action === 'ROLL_CC')?.executionEvidence;
  assert.equal(execution?.openEconomicBoundary, 150);
});

test('a crossed roll-candidate quote (bid > ask) is treated as unknown/ineligible, never used to compute a nonsensical credit', () => {
  const input = state('CSP_OPEN');
  const withCandidate = { ...input, rollCandidate: rollCandidate({ bid: 5, ask: 1 }) };
  const evidence = evaluatePaperBootstrapManagementPolicy(withCandidate);
  assert.equal(evidence?.selectedAction, 'HOLD');
  const rollValue = evidence?.actionValues.find((value) => value.action === 'ROLL');
  assert.equal(rollValue?.executionEvidence, null);
});

test('a crossed roll-candidate quote in a multi-candidate list is excluded, never fabricated into a nonsensical credit', () => {
  const input = state('CSP_OPEN');
  const withCandidates = {
    ...input,
    rollCandidates: [rollCandidate({ optionContractId: 'crossed', bid: 5, ask: 1 })],
  };
  const evidence = evaluatePaperBootstrapManagementPolicy(withCandidates);
  assert.equal(evidence?.selectedAction, 'HOLD');
  const rollValue = evidence?.actionValues.find((value) => value.action === 'ROLL');
  assert.ok(rollValue?.reasons.includes('NO_USABLE_ROLL_CANDIDATES_IN_LIST'));
});

test('CLOSE_FULL uses the ask side (conservative debit) as the close-cost reference, never the midpoint', () => {
  const input = state('CSP_OPEN', {}, '2026-10-13T14:00:00.000Z'); // bid=1,ask=1.1 by default -> near expiry, near-exhausted
  const evidence = evaluatePaperBootstrapManagementPolicy(input);
  const closeValue = evidence?.actionValues.find((value) => value.action === 'CLOSE_FULL');
  assert.ok(closeValue?.reasons.some((reason) => reason.startsWith('CLOSE_COST_ASK_SIDE_110.00')));
  assert.ok(closeValue?.reasons.some((reason) => reason.startsWith('CLOSE_COST_MID_REFERENCE_ANALYTICAL_ONLY_105.00')));
  assert.ok(closeValue?.executionCostRisk !== null && Math.abs((closeValue.executionCostRisk ?? 0) - 110) < 1e-9);
});

test('deterministic pre-fill execution economics and empirical broker-fill readiness remain structurally separate fields -- no double-counting path exists', () => {
  // deterministicEconomicsValidated/deterministicNetCredit are computed
  // purely from CURRENT QUOTES (never a broker fill); empiricalEconomicsReady/
  // expectedAfterCostEv are a SEPARATE field pair this bootstrap policy
  // never sets true. A future fill-reconciliation layer that later
  // populates empiricalEconomicsReady cannot silently overwrite or double-
  // count the deterministic pre-fill reference, because they are
  // different fields on the same object, not the same field reused.
  const input = state('CSP_OPEN');
  const evidence = evaluatePaperBootstrapManagementPolicy({ ...input, rollCandidate: rollCandidate() });
  const execution = evidence?.actionValues.find((value) => value.action === 'ROLL')?.executionEvidence;
  assert.equal(execution?.empiricalEconomicsReady, false);
  assert.equal(execution?.expectedAfterCostEv, null);
  assert.equal(execution?.deterministicEconomicsValidated, true);
  assert.notEqual(execution?.deterministicNetCredit, null);
});

test('a mildly losing position with an intact thesis stays HOLD by default -- thesis bias defaults to inert (no fixed stop-loss authority)', () => {
  // Spot still above strike (OTM, thesis intact); a genuine price loss
  // (remainingFraction > 1) but not near-exhausted/near-expiry, so
  // CLOSE_FULL's own economic trigger does not fire either. No
  // thesisFailureUtilityBias is supplied, so the default (0) applies.
  const input = state('CSP_OPEN', { bid: 3, ask: 3.1 });
  const evidence = evaluatePaperBootstrapManagementPolicy(input);
  assert.equal(evidence?.selectedAction, 'HOLD');
});

test('the SAME mildly losing position closes when a broken thesis is present and the caller supplies a justified bias', () => {
  // Spot now BELOW strike -- ITM against the original short-put thesis, a
  // real structural break -- with the same mild price loss as above.
  const overrides = {
    bid: 3, ask: 3.1,
    snapshot_json: { underlyingState: { last: 195 }, marketSession: { isOpen: false },
      riskState: { assignmentCapacity: 1, newRiskState: 'ALLOW_FULL' }, eventState: { state: 'CLEAR' } },
  };
  const withoutBias = evaluatePaperBootstrapManagementPolicy(state('CSP_OPEN', overrides));
  assert.equal(withoutBias?.selectedAction, 'HOLD', 'thesis classification alone (bias=0) must not force a close');

  const withBias = evaluatePaperBootstrapManagementPolicy({ ...state('CSP_OPEN', overrides), thesisFailureUtilityBias: 2 });
  assert.equal(withBias?.selectedAction, 'CLOSE_FULL');
  const closeValue = withBias?.actionValues.find((value) => value.action === 'CLOSE_FULL');
  assert.ok(closeValue?.reasons.includes('THESIS_CLASSIFICATION_THESIS_FAILURE_AND_PRICE_LOSS')
    || closeValue?.reasons.includes('THESIS_CLASSIFICATION_THESIS_FAILURE_SUSPECTED'));
  assert.ok(closeValue?.reasons.some((reason) => reason === 'PRICE_LOSS_KNOWN_true'));
});

test('a losing position with an intact thesis still lets ROLL win on its own forward economics, unaffected by the bias', () => {
  const input = state('CSP_OPEN', { bid: 3, ask: 3.1 }); // OTM, thesis intact, but a real price loss
  const withCandidate = {
    ...input, rollCandidate: rollCandidate({ bid: 4, ask: 4.1 }), // large enough credit to beat currentMark
    thesisFailureUtilityBias: 5, // even a large bias must not matter when thesis is intact
  };
  const evidence = evaluatePaperBootstrapManagementPolicy(withCandidate);
  assert.equal(evidence?.selectedAction, 'ROLL');
});

test('a suspected (not confirmed) thesis failure penalizes but does not categorically forbid ROLL when economics are strong enough', () => {
  const overrides = {
    bid: 1, ask: 1.1,
    snapshot_json: { underlyingState: { last: 195 }, marketSession: { isOpen: false },
      riskState: { assignmentCapacity: 1, newRiskState: 'ALLOW_FULL' }, eventState: { state: 'CLEAR' } },
  };
  const input = state('CSP_OPEN', overrides);
  // A tiny bias (0.1) is easily outweighed by a genuinely large net credit.
  const withCandidate = { ...input, rollCandidate: rollCandidate({ bid: 4, ask: 4.1 }), thesisFailureUtilityBias: 0.1 };
  const evidence = evaluatePaperBootstrapManagementPolicy(withCandidate);
  assert.equal(evidence?.selectedAction, 'ROLL');
});

test('uncertainty on CLOSE_FULL reflects the count of uninterpreted context signals, never a fabricated probability', () => {
  const overrides = {
    snapshot_json: { underlyingState: { last: 205 }, marketSession: { isOpen: false },
      riskState: { assignmentCapacity: 1, newRiskState: 'ALLOW_FULL' }, eventState: { state: 'CLEAR' },
      expertPriorState: { anything: 'unverified' }, regimeState: { anything: true } },
  };
  const input = state('CSP_OPEN', { ...overrides, bid: 0.05, ask: 0.06 }, '2026-10-13T14:00:00.000Z');
  const evidence = evaluatePaperBootstrapManagementPolicy(input);
  const closeValue = evidence?.actionValues.find((value) => value.action === 'CLOSE_FULL');
  assert.equal(closeValue?.uncertainty, 2);
});

test('RECOVERY_WAIT with a covered call candidate at or above cost basis sells the call', () => {
  const input = state('RECOVERY_WAIT');
  const cc = rollCandidate({ optionType: 'CALL', strike: 200, bid: 1, ask: 1.2 });
  const evidence = evaluatePaperBootstrapManagementPolicy({ ...input, ccCandidate: cc });
  assert.equal(evidence?.selectedAction, 'SELL_CC');
  const execution = evidence?.actionValues.find((value) => value.action === 'SELL_CC')?.executionEvidence;
  assert.equal(execution?.deterministicEconomicsValidated, true);
  assert.ok((execution?.deterministicNetCredit ?? 0) > 0);
});

test('RECOVERY_WAIT rejects a covered call candidate priced below the known cost basis', () => {
  const input = state('RECOVERY_WAIT');
  const cc = rollCandidate({ optionType: 'CALL', strike: 190, bid: 1, ask: 1.2 });
  const evidence = evaluatePaperBootstrapManagementPolicy({ ...input, ccCandidate: cc });
  assert.equal(evidence?.selectedAction, 'RECOVERY_WAIT');
  const rejected = evidence?.actionValues.find((value) => value.action === 'SELL_CC');
  assert.ok(rejected?.reasons.includes('CC_STRIKE_BELOW_KNOWN_COST_BASIS_REJECTED'));
});

test('RECOVERY_WAIT with multiple CC candidates picks the highest-premium SELECTABLE one, skipping below-basis alternatives', () => {
  const input = state('RECOVERY_WAIT');
  const withCandidates = {
    ...input,
    ccCandidates: [
      rollCandidate({ optionContractId: 'below-basis', optionType: 'CALL', strike: 190, bid: 3, ask: 3.2 }),
      rollCandidate({ optionContractId: 'above-basis-small', optionType: 'CALL', strike: 200, bid: 1, ask: 1.2 }),
      rollCandidate({ optionContractId: 'above-basis-large', optionType: 'CALL', strike: 205, bid: 2, ask: 2.2 }),
    ],
  };
  const evidence = evaluatePaperBootstrapManagementPolicy(withCandidates);
  assert.equal(evidence?.selectedAction, 'SELL_CC');
  const execution = evidence?.actionValues.find((value) => value.action === 'SELL_CC')?.executionEvidence;
  assert.equal(execution?.targetContract?.optionContractId, 'above-basis-large');
});

test('with justified CC utility weights, a farther-OTM lower-premium candidate can outrank a near-basis high-premium one with event risk', () => {
  const input = state('RECOVERY_WAIT');
  const withCandidates = {
    ...input,
    ccCandidates: [
      rollCandidate({ optionContractId: 'near-rich-risky', optionType: 'CALL', strike: 196, bid: 4, ask: 4.6, eventRisk: true }),
      rollCandidate({ optionContractId: 'far-modest-safe', optionType: 'CALL', strike: 210, bid: 0.5, ask: 0.55 }),
    ],
    ccUtilityWeights: {
      upsideSacrificePerDollarWeight: 0, spreadPerDollarWeight: 3, eventRiskPenalty: 500,
      dividendExDateRiskPenalty: 100, belowBasisPenalty: 1000,
    },
  };
  const evidence = evaluatePaperBootstrapManagementPolicy(withCandidates);
  const execution = evidence?.actionValues.find((value) => value.action === 'SELL_CC')?.executionEvidence;
  assert.equal(execution?.targetContract?.optionContractId, 'far-modest-safe');
});

test('with the default (inert) CC utility weights, the highest-premium selectable candidate still wins -- the honest no-information fallback', () => {
  const input = state('RECOVERY_WAIT');
  const withCandidates = {
    ...input,
    ccCandidates: [
      rollCandidate({ optionContractId: 'lower', optionType: 'CALL', strike: 200, bid: 0.5, ask: 0.6 }),
      rollCandidate({ optionContractId: 'higher', optionType: 'CALL', strike: 200, bid: 1, ask: 1.2 }),
    ],
  };
  const evidence = evaluatePaperBootstrapManagementPolicy(withCandidates);
  const execution = evidence?.actionValues.find((value) => value.action === 'SELL_CC')?.executionEvidence;
  assert.equal(execution?.targetContract?.optionContractId, 'higher');
});

test('ccCandidates takes precedence over the single ccCandidate field when both are present', () => {
  const input = state('RECOVERY_WAIT');
  const withBoth = {
    ...input,
    ccCandidate: rollCandidate({ optionContractId: 'single-path', optionType: 'CALL', strike: 200, bid: 1, ask: 1.2 }),
    ccCandidates: [rollCandidate({ optionContractId: 'plural-path', optionType: 'CALL', strike: 200, bid: 1, ask: 1.2 })],
  };
  const evidence = evaluatePaperBootstrapManagementPolicy(withBoth);
  const execution = evidence?.actionValues.find((value) => value.action === 'SELL_CC')?.executionEvidence;
  assert.equal(execution?.targetContract?.optionContractId, 'plural-path');
});

test('RECOVERY_WAIT surfaces known distance-to-basis honestly, and UNKNOWN for capital-days without caller-supplied entry data', () => {
  const evidence = evaluatePaperBootstrapManagementPolicy(state('RECOVERY_WAIT'));
  const recoveryValue = evidence?.actionValues.find((value) => value.action === 'RECOVERY_WAIT');
  assert.ok(recoveryValue?.reasons.some((reason) => reason.startsWith('DISTANCE_TO_BASIS_FRACTION_') && !reason.endsWith('UNKNOWN')));
  assert.ok(recoveryValue?.reasons.includes('CAPITAL_DAYS_SO_FAR_UNKNOWN'));
  assert.ok(recoveryValue?.reasons.includes('RECOVERY_PROBABILITY_NOT_MODELED_NO_FABRICATED_ESTIMATE'));
});

test('SELL_STOCK surfaces capital opportunity cost once the caller supplies entry data and a justified rate', () => {
  const input = { ...state('RECOVERY_WAIT'), assignedAtObservedAt: '2026-08-13T14:00:00.000Z', annualOpportunityCostRate: 0.05 };
  const evidence = evaluatePaperBootstrapManagementPolicy(input);
  const sellStockValue = evidence?.actionValues.find((value) => value.action === 'SELL_STOCK');
  assert.ok(sellStockValue?.reasons.some((reason) => reason.startsWith('CAPITAL_OPPORTUNITY_COST_') && !reason.endsWith('UNKNOWN')));
});

test('RECOVERY_WAIT wins by default when no candidates or economic reason to act exist', () => {
  const evidence = evaluatePaperBootstrapManagementPolicy(state('RECOVERY_WAIT'));
  assert.equal(evidence?.selectedAction, 'RECOVERY_WAIT');
});

test('SELL_STOCK is no longer permanently handicapped -- it wins over RECOVERY_WAIT when a justified opportunity-cost weight applies to a real, known capital cost', () => {
  const input = {
    ...state('RECOVERY_WAIT'), assignedAtObservedAt: '2026-08-13T14:00:00.000Z', annualOpportunityCostRate: 0.05,
    sellStockOpportunityCostUtilityWeight: 0.02,
  };
  const evidence = evaluatePaperBootstrapManagementPolicy(input);
  assert.equal(evidence?.selectedAction, 'SELL_STOCK');
});

test('SELL_STOCK wins over RECOVERY_WAIT when a broken thesis is present and a justified thesisFailureUtilityBias applies -- the SAME lever that already governs CLOSE_FULL/ROLL, not a second invented bias', () => {
  const overrides = {
    snapshot_json: { underlyingState: { last: 190 }, marketSession: { isOpen: false },
      riskState: { assignmentCapacity: 1, newRiskState: 'HARD_VETO' }, eventState: { state: 'CLEAR' } },
    broker_position: { currentPrice: 190 },
  };
  const withoutBias = evaluatePaperBootstrapManagementPolicy(state('RECOVERY_WAIT', overrides));
  assert.equal(withoutBias?.selectedAction, 'RECOVERY_WAIT', 'thesis classification alone (bias=0) must not force a sale');

  const withBias = evaluatePaperBootstrapManagementPolicy({ ...state('RECOVERY_WAIT', overrides), thesisFailureUtilityBias: 1 });
  assert.equal(withBias?.selectedAction, 'SELL_STOCK');
});

test('with no opportunity-cost weight or thesis bias supplied, SELL_STOCK stays neutral (tied with RECOVERY_WAIT, never worse by a hidden permanent handicap)', () => {
  const input = { ...state('RECOVERY_WAIT'), assignedAtObservedAt: '2026-08-13T14:00:00.000Z', annualOpportunityCostRate: 0.05 };
  const evidence = evaluatePaperBootstrapManagementPolicy(input);
  const sellStockValue = evidence?.actionValues.find((value) => value.action === 'SELL_STOCK');
  assert.equal(sellStockValue?.utility, 0);
});

test('CC_OPEN with no known reason to act holds the covered call', () => {
  const evidence = evaluatePaperBootstrapManagementPolicy(state('CC_OPEN'));
  assert.equal(evidence?.selectedAction, 'HOLD_CC');
});

test('the policy never fabricates empirical readiness for any action it selects', () => {
  for (const lifecycle of ['CSP_OPEN', 'RECOVERY_WAIT', 'CC_OPEN']) {
    const evidence = evaluatePaperBootstrapManagementPolicy(state(lifecycle));
    for (const value of evidence?.actionValues ?? []) {
      assert.equal(value.executionEvidence?.empiricalEconomicsReady ?? false, false);
    }
  }
});

test('the provider wires an injected candidate source into evaluate()', async () => {
  const input = state('CSP_OPEN');
  const provider = new PaperBootstrapManagementPolicyProvider({
    async candidatesFor(chainId: string) {
      assert.equal(chainId, input.chainId);
      return { rollCandidate: rollCandidate(), ccCandidate: null };
    },
  });
  const evidence = await provider.evaluate(input);
  assert.equal(evidence?.selectedAction, 'ROLL');
});

test('at the exact structural expiration cutoff (dte=0, session closed), the bootstrap policy defers entirely so broker-truth ACCEPT_ASSIGNMENT wins -- never loses a tiebreak to HOLD', () => {
  // ITM short put at the exact cutoff: spot(190) < strike(200).
  const input = state('CSP_OPEN', { snapshot_json: { underlyingState: { last: 190 }, marketSession: { isOpen: false },
    riskState: { assignmentCapacity: 1, newRiskState: 'ALLOW_FULL' }, eventState: { state: 'CLEAR' } } },
    '2026-10-16T20:01:00.000Z', '2026-10-16');
  const evidence = evaluatePaperBootstrapManagementPolicy(input);
  assert.equal(evidence, null, 'the bootstrap policy must step aside, not offer a competing (tie-losing) evidence set');
  const frontier = buildManagementActionFrontier(input, evidence);
  assert.equal(frontier.selectedAction, 'ACCEPT_ASSIGNMENT');
  assert.equal(frontier.decisionState, 'ACTION_SELECTED');
  assert.ok(frontier.reasonCodes.includes('STRUCTURAL_EXPIRATION_NO_ORDER'));
});

test('at the exact structural expiration cutoff, an OTM short put correctly resolves to LET_EXPIRE, not HOLD', () => {
  const input = state('CSP_OPEN', {}, '2026-10-16T20:01:00.000Z', '2026-10-16'); // default fixture: spot 205 > strike 200, OTM
  const evidence = evaluatePaperBootstrapManagementPolicy(input);
  assert.equal(evidence, null);
  const frontier = buildManagementActionFrontier(input, evidence);
  assert.equal(frontier.selectedAction, 'LET_EXPIRE');
});

test('before the cutoff (dte > 0), the bootstrap policy still actively compares CLOSE/ROLL -- the deferral affects only the exact structural instant', () => {
  const input = state('CSP_OPEN', { bid: 0.01, ask: 0.02 }, '2026-10-13T14:00:00.000Z'); // 3 days out, near-exhausted
  const evidence = evaluatePaperBootstrapManagementPolicy(input);
  assert.notEqual(evidence, null);
  assert.equal(evidence?.selectedAction, 'CLOSE_FULL');
});

test('CLOSE_FULL surfaces real assignment-utility.ts facts (secured cash, ownership-quality data presence) when the short put is genuinely ITM before the cutoff', () => {
  const overrides = {
    snapshot_json: { underlyingState: { last: 190 }, marketSession: { isOpen: false },
      riskState: { assignmentCapacity: 1, newRiskState: 'ALLOW_FULL' }, eventState: { state: 'CLEAR' } },
  };
  const input = state('CSP_OPEN', overrides, '2026-10-10T14:00:00.000Z'); // 6 days out, ITM, before the exact cutoff
  const evidence = evaluatePaperBootstrapManagementPolicy(input);
  const closeValue = evidence?.actionValues.find((value) => value.action === 'CLOSE_FULL');
  assert.ok(closeValue?.reasons.includes('ASSIGNMENT_RELEVANT_ITM_SHORT_PUT'));
  assert.ok(closeValue?.reasons.some((reason) => reason.startsWith('SECURED_CASH_IF_ASSIGNED_20000.00')));
  assert.ok(closeValue?.reasons.some((reason) => reason.startsWith('OWNERSHIP_QUALITY_DATA_PRESENT_')));
});

test('CLOSE_FULL does NOT surface assignment-utility facts when the short put is OTM', () => {
  const input = state('CSP_OPEN', {}, '2026-10-10T14:00:00.000Z'); // default fixture: OTM (spot 205 > strike 200)
  const evidence = evaluatePaperBootstrapManagementPolicy(input);
  const closeValue = evidence?.actionValues.find((value) => value.action === 'CLOSE_FULL');
  assert.ok(!closeValue?.reasons.includes('ASSIGNMENT_RELEVANT_ITM_SHORT_PUT'));
});

test('the provider defaults to no candidates and stays passive', async () => {
  const provider = new PaperBootstrapManagementPolicyProvider();
  const evidence = await provider.evaluate(state('CSP_OPEN'));
  assert.equal(evidence?.selectedAction, 'HOLD');
});
