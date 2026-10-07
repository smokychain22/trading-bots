import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStrategyEdgeReceipts } from '../src/theta/strategy-edge-receipt.js';
import type { CanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';

const candidate = (branch: 'THETA_CONVENTIONAL' | 'THETA_HOLD_STRIKE' | 'THETA_DEFINED_RISK', id: string) => ({
  candidateId: id, branch, action: branch === 'THETA_DEFINED_RISK' ? 'OPEN_DEFINED_RISK' : 'OPEN_CSP', underlying: 'SPY',
  legs: [], dte: 30, delta: -0.2, moneyness: 0.9, spreadPct: 0.05,
  liquidity: { volume: 10, openInterest: 100 },
  shortDteRiskEvidence: branch === 'THETA_HOLD_STRIKE' ? { state: 'READY', dte: 3, gamma: 0.04, theta: -0.08,
    distanceToStrikePct: 0.03, pinDistancePct: 0.03, maxAdverseGap60d: -0.02,
    assignmentConsequence: 'SHORT_PUT_MAY_ASSIGN_STOCK', eventState: 'CLEAR', spreadPct: 0.05,
    openInterest: 100, volume: 10, modeledOpeningCost: 2, unknownReasons: [], authority: 'RESEARCH_ONLY' } : null,
  multiLegRiskEvidence: branch === 'THETA_DEFINED_RISK' ? { state: 'STRUCTURAL_READY_FILL_UNCALIBRATED',
    expiration: '2026-11-20', shortLegQuoteState: 'TWO_SIDED', longLegQuoteState: 'TWO_SIDED',
    simultaneousFillState: 'NOT_OBSERVED_RESEARCH_ONLY', fillRiskState: 'UNCALIBRATED',
    shortStrikePinDistancePct: 0.04, longStrikePinDistancePct: 0.08, combinedSpreadPct: 0.1,
    modeledOpeningCost: 4, unknownReasons: [], authority: 'RESEARCH_ONLY' } : null,
  economics: { premiumPerShare: 1, grossPremium: 100, collateral: 4_900, maxProfit: 100, maxLoss: 4_900,
    breakEven: 49, downsideCushion: 0.05, retainedUpside: null, callAwayProceeds: null, wholeChainPnlAtCallAway: null,
    grossReturnOnCollateral: 100 / 4_900, capitalDayYield: 100 / 4_900 / 30,
    modeledOpeningCosts: { state: 'UNKNOWN', reason: 'COST_MODEL_MISSING', costModelVersion: null, optionLegCount: 1,
      commission: null, fees: null, slippage: null, total: null, netPremiumAfterOpeningCost: null,
      maxProfitAfterOpeningCost: null, maxLossAfterOpeningCost: null, returnOnCollateralAfterOpeningCost: null,
      capitalDayYieldAfterOpeningCost: null }, expectedAfterCostEv: null },
  assignmentCapacityQty: 1, aegisState: 'ALLOW_FULL', sizing: { quantity: 1, bindingConstraint: 'BROKER_ALLOWED_QTY' },
  hardBlockers: [], unknownEvidence: [], riskFeasible: true,
}) as unknown as CanonicalStrategyFrontier['branches'][number]['candidates'][number];

const frontier = (candidates: readonly ReturnType<typeof candidate>[]) => ({
  snapshotId: 'snapshot-1', timestamp: '2026-10-07T15:00:00.000Z', branches: [
    { branch: 'THETA_CONVENTIONAL', candidates },
  ],
}) as Pick<CanonicalStrategyFrontier, 'snapshotId' | 'timestamp' | 'branches'>;

test('buildStrategyEdgeReceipts creates deterministic candidate-scoped shadow receipts', () => {
  const input = frontier([candidate('THETA_DEFINED_RISK', 'D:1'), candidate('THETA_CONVENTIONAL', 'Q:1'),
    candidate('THETA_HOLD_STRIKE', 'H:1')]);
  const first = buildStrategyEdgeReceipts(input);
  const second = buildStrategyEdgeReceipts(input);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((receipt) => receipt.candidateId), ['D:1', 'H:1', 'Q:1']);
  assert.deepEqual(first.map((receipt) => receipt.edgeId),
    ['BOUNDED_RISK_CAPITAL_EFFICIENCY', 'SHORT_DTE_THETA', 'OWNERSHIP_PREMIUM']);
  assert.ok(first.every((receipt) => receipt.authority === 'SHADOW_EVIDENCE_ONLY'
    && receipt.executionAuthorized === false && receipt.confidence === null && receipt.edgeStrength === null));
});

test('missing empirical EV and IV/RV remain explicit UNKNOWN evidence', () => {
  const [receipt] = buildStrategyEdgeReceipts(frontier([candidate('THETA_CONVENTIONAL', 'Q:1')]));
  assert.equal(receipt?.currentEvidence.expectedAfterCostEv.state, 'UNKNOWN');
  assert.equal(receipt?.currentEvidence.expectedAfterCostEv.value, null);
  assert.equal(receipt?.currentEvidence.ivMinusRv.state, 'UNKNOWN');
  assert.equal(receipt?.edgeStrengthState, 'EMPIRICALLY_UNCALIBRATED');
});
