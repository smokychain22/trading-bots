import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { deriveAccountExposure } from '../src/theta/account-exposure.js';
import { paperBootstrapRuntimePolicy } from '../src/theta/paper-bootstrap-runtime-policy.js';
import {
  assessStrategyAccountPolicyCompatibility, summarizeAccountPolicyIncompatibilities,
  type StrategyAccountPolicyCompatibility,
} from '../src/theta/strategy-account-policy-compatibility.js';

interface MoneyValue { readonly value?: number | null }
interface ArchivedCandidate {
  readonly candidateId: string;
  readonly underlying: string;
  readonly branch: string;
  readonly delta: number | null;
  readonly aegisState: string | null;
  readonly hardBlockers: readonly string[];
  readonly unknownEvidence: readonly string[];
  readonly entryEligibility?: { readonly basis?: string; readonly paperBootstrapReasonCodes?: readonly string[] };
  readonly economics: { readonly collateral: number | null; readonly maxLoss: number | null };
  readonly legs: readonly { readonly optionSymbol: string; readonly strike: number; readonly expiration: string;
    readonly delta?: number | null; readonly multiplier: number }[];
  readonly sizing: { readonly quantity: number; readonly bindingConstraint: string; readonly reasons: readonly string[];
    readonly waterfall?: { readonly capitalBudget?: { readonly accountEquity?: MoneyValue; readonly accountCash?: MoneyValue;
      readonly brokerBuyingPower?: MoneyValue; readonly accountObservedAt?: string | null; readonly snapshotId?: string } } };
}
interface ArchivedRecord {
  readonly recordType: string;
  readonly frontierId: string;
  readonly fusionSnapshotId: string;
  readonly branch: { readonly bestCandidateId?: string | null; readonly bestRejectedCandidateId?: string | null;
    readonly routeReasons?: readonly string[] };
  readonly candidate: ArchivedCandidate | null;
}

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const sqlitePath = resolve(arg('sqlite') ?? '.theta-local-worker/research-spool/theta-research.sqlite');
const outputPath = resolve(arg('output') ?? 'docs/operations/THETA_PHASE2_OCT5_CAPITAL_RISK_AUDIT_20261006.json');
if (!existsSync(sqlitePath)) throw new Error(`OCT5_ARCHIVE_NOT_FOUND:${sqlitePath}`);

const capacityPolicy = {
  hardCapMultiplier: paperBootstrapRuntimePolicy.aegis.hardCapMultiplier,
  maxTickerConcentrationPct: paperBootstrapRuntimePolicy.aegis.maximumTickerConcentrationPct,
  maxSectorConcentrationPct: paperBootstrapRuntimePolicy.aegis.maximumSectorConcentrationPct,
  maxCorrelationClusterPct: paperBootstrapRuntimePolicy.aegis.maximumCorrelationClusterPct,
  maxPortfolioCapitalAtRiskPct: paperBootstrapRuntimePolicy.aegis.maximumPortfolioCapitalAtRiskPct,
  maxInventoryCapacityPct: paperBootstrapRuntimePolicy.aegis.maximumInventoryCapacityPct,
  maxAssignmentCapacityPct: paperBootstrapRuntimePolicy.aegis.maximumAssignmentCapacityPct,
  maxRecoveryCapacityPct: paperBootstrapRuntimePolicy.aegis.maximumRecoveryCapacityPct,
};

function numberValue(value: MoneyValue | undefined): number | null {
  return typeof value?.value === 'number' && Number.isFinite(value.value) ? value.value : null;
}

function compatibility(candidate: ArchivedCandidate): StrategyAccountPolicyCompatibility {
  const budget = candidate.sizing.waterfall?.capitalBudget;
  const equity = numberValue(budget?.accountEquity);
  const cash = numberValue(budget?.accountCash);
  const buyingPower = numberValue(budget?.brokerBuyingPower);
  const collateral = candidate.economics.collateral;
  const exposure = deriveAccountExposure(equity === null ? null : {
    accountId: 'archive-redacted', status: 'ACTIVE', tradingBlocked: false, accountBlocked: false,
    equity, cash, buyingPower, optionsBuyingPower: buyingPower, optionsTradingLevel: 2,
    patternDayTrader: false, daytradeCount: 0,
    retrievedAt: budget?.accountObservedAt ?? '2026-10-05T00:00:00.000Z',
  }, [], []);
  const brokerAllowedQty = buyingPower === null || collateral === null || collateral <= 0
    ? null : Math.floor(buyingPower / collateral);
  return assessStrategyAccountPolicyCompatibility({
    strategy: 'THETA_CONVENTIONAL', riskProfile: 'CASH_SECURED_SHORT_PUT', underlying: candidate.underlying,
    marketApplicable: true, minimumCapitalRequired: collateral, securedCollateralRequired: collateral,
    brokerAllowedQty, exposure, policy: capacityPolicy,
  });
}

const database = new DatabaseSync(sqlitePath, { readOnly: true });
const batches = database.prepare(`SELECT batch_id, observed_at, row_count, payload_hash, payload_json
  FROM research_batch WHERE family = 'CANONICAL_STRATEGY_CANDIDATE_EVIDENCE'
  AND observed_at >= '2026-10-05T00:00:00.000Z' AND observed_at < '2026-10-06T00:00:00.000Z'
  ORDER BY observed_at, batch_id`).all() as Array<Record<string, unknown>>;
database.close();

const decoded = batches.map((batch) => ({
  batchId: String(batch.batch_id), observedAt: String(batch.observed_at), declaredRowCount: Number(batch.row_count),
  payloadHash: String(batch.payload_hash), records: JSON.parse(String(batch.payload_json)) as ArchivedRecord[],
}));
const records = decoded.flatMap((batch) => batch.records.map((record) => ({ ...record, batchId: batch.batchId, observedAt: batch.observedAt })));
const candidates = records.filter((record): record is typeof record & { candidate: ArchivedCandidate } => record.candidate !== null);
const oldGeneric = candidates.filter((record) => record.candidate.hardBlockers.includes('ACCOUNT_POLICY_INCOMPATIBILITY'));
const observationCompatibility = oldGeneric.map((record) => compatibility(record.candidate));
const latestByCandidate = new Map<string, StrategyAccountPolicyCompatibility>();
for (const record of oldGeneric) latestByCandidate.set(record.candidate.candidateId, compatibility(record.candidate));

function representative(underlying: string) {
  const underlyingRecords = candidates.filter((record) => record.candidate.underlying === underlying
    && record.candidate.branch === 'THETA_CONVENTIONAL');
  const batchRecords = records.filter((record) => record.candidate?.underlying === underlying);
  const preferredIds = batchRecords.flatMap((record) => [record.branch.bestCandidateId, record.branch.bestRejectedCandidateId])
    .filter((value): value is string => typeof value === 'string');
  const reachedAegis = underlyingRecords.filter((record) => record.candidate.aegisState !== null);
  const selected = preferredIds.map((id) => reachedAegis.find((record) => record.candidate.candidateId === id)
    ?? underlyingRecords.find((record) => record.candidate.candidateId === id)).find((record) => record !== undefined)
    ?? reachedAegis[0] ?? underlyingRecords[0];
  if (selected === undefined) return null;
  const candidate = selected.candidate;
  const account = candidate.sizing.waterfall?.capitalBudget;
  const policy = compatibility(candidate);
  return {
    evidenceClass: 'REAL_PERSISTED', derivedPolicyClass: 'DERIVED_FROM_REAL_PERSISTED',
    frontierId: selected.frontierId, fusionSnapshotId: selected.fusionSnapshotId,
    candidateId: candidate.candidateId, contract: candidate.legs[0]?.optionSymbol ?? null,
    strike: candidate.legs[0]?.strike ?? null, expiry: candidate.legs[0]?.expiration ?? null,
    delta: candidate.delta, multiplier: candidate.legs[0]?.multiplier ?? null,
    account: { equity: numberValue(account?.accountEquity), cash: numberValue(account?.accountCash),
      optionsBuyingPower: numberValue(account?.brokerBuyingPower), observedAt: account?.accountObservedAt ?? null },
    capital: { collateral: candidate.economics.collateral, maximumLoss: candidate.economics.maxLoss,
      minimumExecutableQuantity: 1 },
    accountCompatibility: policy,
    ownership: { score: null, threshold: paperBootstrapRuntimePolicy.ownership.thetaQAcceptabilityFloor,
      state: 'NOT_PERSISTED_IN_FRONTIER_CANDIDATE', entryBasis: candidate.entryEligibility?.basis ?? null,
      reasonCodes: candidate.entryEligibility?.paperBootstrapReasonCodes ?? [], routeReasons: selected.branch.routeReasons ?? [] },
    aegis: { state: candidate.aegisState, bindingReasons: candidate.sizing.reasons },
    sizing: { finalQuantity: candidate.sizing.quantity, bindingConstraint: candidate.sizing.bindingConstraint },
    hardBlockers: candidate.hardBlockers, unknownEvidence: candidate.unknownEvidence,
  };
}

function aegisReachedRepresentative(underlying: string) {
  const underlyingRecords = candidates.filter((record) => record.candidate.underlying === underlying
    && record.candidate.branch === 'THETA_CONVENTIONAL' && record.candidate.aegisState !== null);
  const preferredIds = records.filter((record) => record.candidate?.underlying === underlying)
    .map((record) => record.branch.bestRejectedCandidateId)
    .filter((value): value is string => typeof value === 'string');
  const selected = preferredIds.map((id) => underlyingRecords.find((record) => record.candidate.candidateId === id))
    .find((record) => record !== undefined) ?? underlyingRecords[0];
  if (selected === undefined) return null;
  const candidate = selected.candidate;
  const account = candidate.sizing.waterfall?.capitalBudget;
  return {
    evidenceClass: 'REAL_PERSISTED', derivedPolicyClass: 'DERIVED_FROM_REAL_PERSISTED',
    frontierId: selected.frontierId, fusionSnapshotId: selected.fusionSnapshotId,
    candidateId: candidate.candidateId, contract: candidate.legs[0]?.optionSymbol ?? null,
    strike: candidate.legs[0]?.strike ?? null, expiry: candidate.legs[0]?.expiration ?? null,
    delta: candidate.delta, multiplier: candidate.legs[0]?.multiplier ?? null,
    account: { equity: numberValue(account?.accountEquity), optionsBuyingPower: numberValue(account?.brokerBuyingPower),
      observedAt: account?.accountObservedAt ?? null },
    capital: { collateral: candidate.economics.collateral, maximumLoss: candidate.economics.maxLoss,
      minimumExecutableQuantity: 1 },
    accountCompatibility: compatibility(candidate),
    aegis: { state: candidate.aegisState, bindingReasons: candidate.sizing.reasons },
    sizing: { finalQuantity: candidate.sizing.quantity, bindingConstraint: candidate.sizing.bindingConstraint },
    hardBlockers: candidate.hardBlockers, unknownEvidence: candidate.unknownEvidence,
  };
}

const reportWithoutHash = {
  version: 'theta-phase2-oct5-capital-risk-audit-v1', generatedAt: new Date().toISOString(),
  archive: { path: sqlitePath, batchCount: decoded.length,
    declaredRows: decoded.reduce((sum, batch) => sum + batch.declaredRowCount, 0), candidateRows: candidates.length,
    payloadHashes: decoded.map((batch) => ({ batchId: batch.batchId, payloadHash: batch.payloadHash })) },
  policy: { source: 'paperBootstrapRuntimePolicy', ...capacityPolicy,
    ownershipFloor: paperBootstrapRuntimePolicy.ownership.thetaQAcceptabilityFloor },
  oldGenericAccountPolicyIncompatibility: {
    observationCount: oldGeneric.length, uniqueCandidateCount: latestByCandidate.size,
    observationSummary: summarizeAccountPolicyIncompatibilities(observationCompatibility),
    uniqueCandidateSummary: summarizeAccountPolicyIncompatibilities([...latestByCandidate.values()]),
    explanation: 'Observation counts preserve repeated cycle evidence. Unique counts use the latest observation per candidateId.',
  },
  representatives: { SPY: representative('SPY'), TLT: representative('TLT'), XLE: representative('XLE') },
  aegisReachedRepresentatives: {
    SPY: aegisReachedRepresentative('SPY'), TLT: aegisReachedRepresentative('TLT'), XLE: aegisReachedRepresentative('XLE'),
  },
  verdicts: {
    SPY: 'CSP minimum-unit account and AEGIS concentration vetoes are arithmetically supported by persisted evidence.',
    TLT: 'Persisted account policy is feasible. Ownership score was not persisted. The reached candidate stopped at AEGIS HOLD_ONLY on missing spread/system stress evidence.',
    XLE: 'Persisted account policy is feasible. Ownership score was not persisted. The reached candidate stopped at AEGIS HOLD_ONLY on missing spread/system stress evidence.',
    ownershipClaim: 'The archive does not support a numeric TLT or XLE ownership-rejection claim. Missing ownership was explicitly allowed by the uncalibrated Paper bootstrap.',
  },
} as const;
const canonical = JSON.stringify(reportWithoutHash);
const report = { ...reportWithoutHash, reportHash: createHash('sha256').update(canonical).digest('hex') };
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ outputPath, reportHash: report.reportHash,
  genericObservationCount: oldGeneric.length, genericUniqueCandidateCount: latestByCandidate.size }, null, 2)}\n`);
