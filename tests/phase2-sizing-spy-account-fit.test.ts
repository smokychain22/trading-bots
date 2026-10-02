import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { classifySizingZero } from '../src/theta/runtime-behavior-diagnostic.js';
import { paperBootstrapRuntimePolicy as P } from '../src/theta/paper-bootstrap-runtime-policy.js';
import { assessStrategyAccountPolicyCompatibility } from '../src/theta/strategy-account-policy-compatibility.js';
import { deriveAccountExposure } from '../src/theta/account-exposure.js';
import { decodeCycleEvidenceArchive } from '../src/theta/postgres-cycle-evidence-storage.js';

// SPY account-fit truth for archived cycle e9f4b10f (source c3d8868, 2,619 SPY puts, $100k paper account).
const jsonPath = path.resolve('docs/operations/THETA_PHASE2_SPY_ACCOUNT_FIT_20261002.json');
const archivePath = 'C:/Users/hp/Documents/Codex/2026-09-09/read-all-my-files-in-depth/work/trading-bots/.theta-local-worker/replay-corpus/'
  + 'e9f4b10f-7d76-4612-bceb-0c4f50bf617e-3f53173812aa3b97556ee821a3815c3f56e447e6d1233af9f3d5daeec7086fea.bin';

interface AccountFitDocument {
  readonly account: { readonly equityUsd: number };
  readonly baseline: { readonly softCapFitCount: number; readonly hardCapFitCount: number; readonly finalQtyAtLeastOneCount: number };
  readonly chain: { readonly totalPuts: number; readonly allPutsCollateral: { readonly min: number } };
  readonly classification: { readonly zeroFitClass: string };
  readonly policy: { readonly tickerSoftCapUsd: number; readonly tickerHardThresholdUsd: number };
  readonly qStructuralValid: { readonly count: number; readonly collateralUsd: { readonly min: number; readonly max: number } };
  readonly scaleScenarios: readonly {
    readonly equityMultiple: number; readonly hardCapFitCount: number; readonly softCapFitCount: number; readonly finalQtyAtLeastOneCount: number;
  }[];
}

interface ArchivedPutContract {
  readonly optionType: string; readonly underlying: string; readonly multiplier: number; readonly strike: number;
  readonly dte: number; readonly delta: number | null; readonly openInterest: number | null; readonly volume: number | null;
  readonly bid: number; readonly ask: number; readonly spreadPct: number; readonly dataAgeSeconds: number;
}

const fit = JSON.parse(readFileSync(jsonPath, 'utf8')) as AccountFitDocument;

test('account-fit JSON states the hard numbers and the classification (derived numbers only, no secrets)', () => {
  assert.equal(fit.chain.totalPuts, 2619);
  assert.equal(fit.qStructuralValid.count, 363);
  assert.equal(fit.baseline.softCapFitCount, 0);
  assert.equal(fit.baseline.hardCapFitCount, 0);
  assert.equal(fit.baseline.finalQtyAtLeastOneCount, 0);
  assert.equal(fit.classification.zeroFitClass, 'ACCOUNT_POLICY_INCOMPATIBILITY');
  assert.deepEqual(fit.scaleScenarios.map((s) => s.equityMultiple), [0.5, 1, 1.5, 2, 3, 5]);
  const fitCounts = fit.scaleScenarios.map((s) => s.hardCapFitCount);
  assert.deepEqual(fitCounts, [...fitCounts].sort((a: number, b: number) => a - b), 'more equity never fits fewer contracts');
  for (const s of fit.scaleScenarios) assert.equal(s.finalQtyAtLeastOneCount, s.hardCapFitCount, 'final qty >= 1 exactly when hard-threshold fit');
  assert.doesNotMatch(JSON.stringify(fit), /secret|apikey|api_key|token|password|authorization/i);
});

test('policy arithmetic behind the zero: hard USD threshold and the cheapest Q-valid collateral', () => {
  const equity = fit.account.equityUsd as number;
  const soft = equity * P.aegis.maximumTickerConcentrationPct;
  const hard = soft * P.aegis.hardCapMultiplier;
  assert.ok(Math.abs(fit.policy.tickerSoftCapUsd - soft) < 1e-6);
  assert.ok(Math.abs(fit.policy.tickerHardThresholdUsd - hard) < 1e-6);
  assert.equal(fit.qStructuralValid.collateralUsd.min, 375 * 100, 'strike * 100, applied once');
  assert.ok(fit.qStructuralValid.collateralUsd.min > hard, 'even the cheapest Q-valid unit exceeds the hard threshold');
  assert.ok(fit.chain.allPutsCollateral.min >= 300 * 100 && fit.chain.allPutsCollateral.min > hard, 'no enumerated SPY put fits at all');
});

test('the compatibility assessor names the zero ACCOUNT policy incompatibility, not a market or Q failure', () => {
  const exposure = deriveAccountExposure({ accountStatus: 'ACTIVE', equity: fit.account.equityUsd, cash: fit.account.equityUsd, buyingPower: fit.account.equityUsd * 4,
    optionsBuyingPower: fit.account.equityUsd, optionsApprovedLevel: 3, optionsTradingLevel: 3, tradingBlocked: false, transfersBlocked: false,
    maskedAccountId: '****', receivedAt: '2026-10-01T18:38:50.000Z' }, [], []);
  const policy = { hardCapMultiplier: P.aegis.hardCapMultiplier, maxTickerConcentrationPct: P.aegis.maximumTickerConcentrationPct,
    maxSectorConcentrationPct: P.aegis.maximumSectorConcentrationPct, maxCorrelationClusterPct: P.aegis.maximumCorrelationClusterPct,
    maxPortfolioCapitalAtRiskPct: P.aegis.maximumPortfolioCapitalAtRiskPct, maxInventoryCapacityPct: P.aegis.maximumInventoryCapacityPct,
    maxAssignmentCapacityPct: P.aegis.maximumAssignmentCapacityPct, maxRecoveryCapacityPct: P.aegis.maximumRecoveryCapacityPct };
  const base = { strategy: 'THETA_CONVENTIONAL' as const, underlying: 'SPY', marketApplicable: true, brokerAllowedQty: 1, exposure, policy };
  const cheapest = assessStrategyAccountPolicyCompatibility({ ...base, minimumCapitalRequired: 37_500 });
  assert.equal(cheapest.state, 'STRATEGY_ACCOUNT_POLICY_INCOMPATIBLE');
  assert.equal(cheapest.accountFeasible, false);
  assert.ok(cheapest.bindingPolicies.includes('TICKER_CONCENTRATION'));
  assert.deepEqual(cheapest.reasons, ['MINIMUM_EXECUTABLE_UNIT_EXCEEDS_HARD_RISK_POLICY']);
  // The same strategy is market-applicable and fits at a larger account: the zero is account scale.
  const scaled = deriveAccountExposure({ accountStatus: 'ACTIVE', equity: 500_000, cash: 500_000, buyingPower: 2_000_000, optionsBuyingPower: 500_000,
    optionsApprovedLevel: 3, optionsTradingLevel: 3, tradingBlocked: false, transfersBlocked: false, maskedAccountId: '****', receivedAt: '2026-10-01T18:38:50.000Z' }, [], []);
  assert.notEqual(assessStrategyAccountPolicyCompatibility({ ...base, exposure: scaled, minimumCapitalRequired: 37_500 }).state, 'STRATEGY_ACCOUNT_POLICY_INCOMPATIBLE');
  // Broker capacity zero is a different, separately named state.
  assert.equal(assessStrategyAccountPolicyCompatibility({ ...base, brokerAllowedQty: 0, minimumCapitalRequired: 37_500 }).state, 'ACCOUNT_INFEASIBLE_BROKER_CAPACITY');
});

test('AEGIS result, sizing binding and zero cause agree for a concentration hard veto (no contradiction)', () => {
  // Shape produced by the frontier for the archived SPY finalists: AEGIS_HARD_VETO blocker + AEGIS family binding.
  const vetoed = { hardBlockers: ['AEGIS_HARD_VETO'], sizing: { quantity: 0, bindingConstraint: 'UNDERLYING:UNDERLYING_SEVERELY_EXCEEDED' } };
  assert.equal(classifySizingZero(vetoed), 'AEGIS_HARD_VETO');
  assert.equal(classifySizingZero({ hardBlockers: [], sizing: vetoed.sizing }), 'AEGIS_RISK_FAMILY_BLOCK');
  // Shortlist-bound candidates were never assessed: labelled NOT_REACHED / Q_REJECTED_UPSTREAM, never as a rule rejection.
  assert.equal(classifySizingZero({ hardBlockers: ['THETA_Q_NOT_EVALUATED_SHORTLIST_BOUND'], sizing: { quantity: 0, bindingConstraint: 'AEGIS_NOT_REACHED_UPSTREAM' } }), 'Q_REJECTED_UPSTREAM');
  assert.equal(classifySizingZero({ hardBlockers: [], sizing: { quantity: 0, bindingConstraint: 'AEGIS_NOT_REACHED_UPSTREAM' } }), 'AEGIS_NOT_REACHED');
  assert.equal(classifySizingZero({ hardBlockers: [], sizing: { quantity: 2, bindingConstraint: 'COLLATERAL_CAP' } }), null);
});

test('archived SPY chain recomputed with current code reproduces the JSON (skipped when the local archive is absent)', (t) => {
  if (!existsSync(archivePath)) { t.skip('local replay archive not present on this machine'); return; }
  const decoded = decodeCycleEvidenceArchive(readFileSync(archivePath)) as unknown as { canonicalFrontierInput: { contracts: ArchivedPutContract[] } };
  const contracts: ArchivedPutContract[] = decoded.canonicalFrontierInput.contracts;
  const puts = contracts.filter((c) => c.optionType === 'PUT');
  assert.equal(puts.length, fit.chain.totalPuts);
  assert.ok(puts.every((c) => c.underlying === 'SPY' && c.multiplier === 100), 'single multiplier, SPY only');
  const k = P.conventional;
  const q = puts.filter((c) => c.dte >= k.minimumDte && c.dte <= k.maximumDte && c.delta !== null && Math.abs(c.delta) <= 0.5
    && (c.openInterest ?? -1) >= k.minimumOpenInterest && (c.volume ?? -1) >= k.minimumVolume && c.bid > 0 && c.ask > 0
    && c.spreadPct <= k.maximumSpreadPct && c.dataAgeSeconds <= P.quoteAge.candidateMaximumSeconds);
  assert.equal(q.length, fit.qStructuralValid.count);
  const unit = (c: ArchivedPutContract) =>c.strike * c.multiplier;
  assert.equal(Math.min(...q.map(unit)), fit.qStructuralValid.collateralUsd.min);
  assert.equal(Math.max(...q.map(unit)), fit.qStructuralValid.collateralUsd.max);
  for (const s of fit.scaleScenarios) {
    const equity = fit.account.equityUsd * s.equityMultiple;
    const hardFit = q.filter((c) => !(unit(c) / equity >= P.aegis.maximumTickerConcentrationPct * P.aegis.hardCapMultiplier)).length;
    const softFit = q.filter((c) => unit(c) / equity < P.aegis.maximumTickerConcentrationPct).length;
    assert.equal(hardFit, s.hardCapFitCount, `x${s.equityMultiple} hard`);
    assert.equal(softFit, s.softCapFitCount, `x${s.equityMultiple} soft`);
  }
});
