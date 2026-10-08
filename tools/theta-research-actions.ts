#!/usr/bin/env -S npx tsx
/**
 * One bounded, offline, research-only Actions vertical slice.
 *
 * It accepts only immutable repository-local ObservationBundle evidence,
 * invokes the existing real-data arrival pipeline, preserves PIT/hash/UNKNOWN
 * failures, and emits a small public-safe receipt. It has no broker, account,
 * database, provider, order, or production configuration import.
 */
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyQuoteEvidenceAdmission,
  parseArguments,
  readJsonFile,
  validateEvidenceManifest,
  validatePolicy,
} from './theta-research-actions-gate.mjs';
import type { DeterministicResearchScenario } from './theta-research-deterministic-adapters.js';

type Classification =
  | 'SOURCE_ALREADY_IMPLEMENTED'
  | 'SOURCE_GAP'
  | 'DATA_GAP'
  | 'EMPIRICAL_GAP'
  | 'PAPER_AUTHORITY_GAP';

interface Policy {
  readonly contractVersion: string;
  readonly allowedModes: readonly string[];
  readonly allowedManifestRoot: string;
  readonly deterministicScenarioPath: string;
  readonly sourceReuseContracts: readonly {
    readonly path: string;
    readonly symbols: readonly string[];
  }[];
  readonly limits: {
    readonly pipelineDeadlineSeconds: number;
    readonly maximumTotalInputBytes: number;
    readonly maximumInputFileBytes: number;
    readonly maximumSymbols: number;
    readonly maximumRows: number;
    readonly maximumCompleteEpisodes: number;
    readonly maximumPreregisteredComparisons: number;
    readonly maximumPreregisteredResamples: number;
    readonly maximumDiagnosticBytes: number;
    readonly maximumSummaryBytes: number;
  };
}

interface EvidenceEntry {
  readonly kind: 'OBSERVATION_BUNDLE';
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly evidenceClass: 'REAL_MARKET_EVIDENCE' | 'SYNTHETIC_TEST' | 'DETERMINISTIC_SCENARIO_COMPARISON';
  readonly symbol: string;
  readonly rowCount: number;
  readonly completeEpisodeCount: number;
  readonly comparisonCount: number;
  readonly resampleCount: number;
  readonly quoteEvidence?: Record<string, unknown>;
}

interface EvidenceManifest {
  readonly contractVersion: string;
  readonly manifestId: string;
  readonly dataAvailability: 'UNKNOWN' | 'VERIFIED';
  readonly historicalReplayStatus: 'HISTORICAL_REPLAY_NOT_RUN' | 'HISTORICAL_REPLAY_READY';
  readonly entries: readonly EvidenceEntry[];
}

interface Stage {
  readonly id: string;
  readonly status: Classification;
  readonly reasons: readonly string[];
  readonly count: number;
}

export interface BoundedResearchRequest {
  readonly rootDir: string;
  readonly mode: 'research' | 'shadow' | 'daily-report';
  readonly targetDate: string;
  readonly slotId: string;
  readonly sourceSha: string;
  readonly policyPath: string;
  readonly manifestPath: string;
  readonly outputDir: string;
  readonly now?: Date;
}

export interface BoundedResearchResult {
  readonly receipt: Record<string, unknown>;
  readonly summary: string;
  readonly receiptPath: string;
  readonly summaryPath: string;
}

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertWithinRoot(root: string, candidate: string): void {
  const relation = relative(root, candidate);
  if (relation === '..' || relation.startsWith('..' + sep) || isAbsolute(relation)) {
    throw new Error('EVIDENCE_PATH_ESCAPES_REPOSITORY');
  }
}

function verifySourceReuse(rootDir: string, policy: Policy): {
  readonly status: Classification;
  readonly reasons: readonly string[];
  readonly found: number;
} {
  const reasons: string[] = [];
  let found = 0;
  for (const contract of policy.sourceReuseContracts) {
    const path = resolve(rootDir, contract.path);
    assertWithinRoot(rootDir, path);
    if (!existsSync(path)) {
      reasons.push('SOURCE_PATH_MISSING:' + contract.path);
      continue;
    }
    const content = readFileSync(path, 'utf8');
    const missing = contract.symbols.filter((symbol) => !content.includes(symbol));
    if (missing.length > 0) {
      for (const symbol of missing) reasons.push('SOURCE_SYMBOL_MISSING:' + contract.path + ':' + symbol);
      continue;
    }
    found += 1;
  }
  return {
    status: reasons.length === 0 ? 'SOURCE_ALREADY_IMPLEMENTED' : 'SOURCE_GAP',
    reasons: reasons.length === 0 ? ['REQUIRED_REUSE_CONTRACTS_PRESENT'] : reasons.sort(),
    found,
  };
}

function buildSummary(receipt: {
  readonly overallStatus: string;
  readonly mode: string;
  readonly targetDate: string;
  readonly slotId: string;
  readonly historicalReplayStatus: string;
  readonly manifest: Record<string, unknown>;
  readonly stages: readonly Stage[];
  readonly recommendations: readonly { readonly classification: string; readonly action: string }[];
}): string {
  const lines = [
    '## THETA bounded research',
    '',
    '- Overall status: ' + receipt.overallStatus,
    '- Mode: ' + receipt.mode,
    '- Target date: ' + receipt.targetDate,
    '- Slot: ' + receipt.slotId,
    '- Historical replay: ' + receipt.historicalReplayStatus,
    '- Evidence manifest: ' + String(receipt.manifest.manifestId),
    '- Evidence entries: ' + String(receipt.manifest.entryCount),
    '',
    '### Stage classifications',
    '',
  ];
  for (const stage of receipt.stages) {
    lines.push('- ' + stage.id + ': ' + stage.status + ' — ' + stage.reasons.join(', '));
  }
  lines.push('', '### Recommendations', '');
  for (const recommendation of receipt.recommendations) {
    lines.push('- ' + recommendation.classification + ': ' + recommendation.action);
  }
  lines.push(
    '',
    'This is research evidence only. It grants no Paper or Production authority and cannot submit orders.',
    '',
  );
  return lines.join('\n');
}

function deadlineExceeded(startedAt: number, policy: Policy): boolean {
  return Date.now() - startedAt >= policy.limits.pipelineDeadlineSeconds * 1000;
}

export async function runBoundedResearch(request: BoundedResearchRequest): Promise<BoundedResearchResult> {
  const startedAt = Date.now();
  const rootDir = resolve(request.rootDir);
  const policy = readJsonFile(resolve(rootDir, request.policyPath)) as Policy;
  const manifest = readJsonFile(resolve(rootDir, request.manifestPath)) as EvidenceManifest;
  const policyErrors = validatePolicy(policy);
  const manifestErrors = validateEvidenceManifest(manifest, policy);
  if (policyErrors.length > 0 || manifestErrors.length > 0) {
    throw new Error('RESEARCH_CONFIGURATION_INVALID:' + [...policyErrors, ...manifestErrors].join(','));
  }
  if (!policy.allowedModes.includes(request.mode)) throw new Error('RESEARCH_MODE_NOT_ALLOWED');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.targetDate)) throw new Error('TARGET_DATE_INVALID');
  if (!/^[A-Za-z0-9_.:-]+$/.test(request.slotId)) throw new Error('SLOT_ID_INVALID');
  if (!/^[0-9a-f]{40}$/.test(request.sourceSha)) throw new Error('SOURCE_SHA_INVALID');

  const source = verifySourceReuse(rootDir, policy);
  const deterministicScenarioPath = resolve(rootDir, policy.deterministicScenarioPath);
  assertWithinRoot(rootDir, deterministicScenarioPath);
  if (!existsSync(deterministicScenarioPath)
    || statSync(deterministicScenarioPath).size > policy.limits.maximumDiagnosticBytes) {
    throw new Error('DETERMINISTIC_SCENARIO_FILE_INVALID');
  }
  const deterministicScenario = readJsonFile(deterministicScenarioPath) as DeterministicResearchScenario;
  const deterministicAdapters = await import('./theta-research-deterministic-adapters.js');
  const deterministic = deterministicAdapters.runDeterministicResearchAdapters(deterministicScenario);
  const stages: Stage[] = [{
    id: 'SOURCE_REUSE',
    status: source.status,
    reasons: source.reasons,
    count: source.found,
  }, {
    id: 'REGIME_DETERMINISTIC_CONTRACT_COMPOSITION',
    status: deterministic.regime.status,
    reasons: [
      deterministic.evidenceClass,
      'NON_EMPIRICAL',
      'FIVE_AXES_PRESERVED',
      'CONFIDENCE_DERIVED_FROM_RESOLVED_AXES',
    ],
    count: 1,
  }, {
    id: 'Q_D_DETERMINISTIC_CONTRACT_COMPOSITION',
    status: deterministic.qd.status,
    reasons: [
      deterministic.evidenceClass,
      'NON_EMPIRICAL',
      'IDENTICAL_SHORT_LEG_AND_EXPIRATION_ENFORCED',
      deterministic.qd.readiness,
    ],
    count: 1,
  }, {
    id: 'H_DETERMINISTIC_SHORT_VS_CONVENTIONAL_COMPOSITION',
    status: deterministic.h.status,
    reasons: [
      deterministic.evidenceClass,
      'NON_EMPIRICAL',
      'H_2_5_DTE_NO_ROLL_PRESERVED',
      'CONVENTIONAL_25_60_DTE_PRESERVED',
      'SAME_SNAPSHOT_TIMESTAMP_EXECUTION_CLASS_AND_UNDERLYING',
    ],
    count: 1,
  }, {
    id: 'ENTRY_EXIT_DETERMINISTIC_POLICY_REPLAY',
    status: deterministic.entryExit.status,
    reasons: [
      deterministic.evidenceClass,
      'NON_EMPIRICAL',
      'ALL_REGISTERED_POLICIES_EXECUTED_OFFLINE',
      'NO_ACTUAL_FILLS',
      deterministic.entryExit.profitability,
    ],
    count: 1,
  }, {
    id: 'A_C_DETERMINISTIC_CONTRACT_COMPOSITION',
    status: deterministic.ac.status,
    reasons: [
      deterministic.evidenceClass,
      'NON_EMPIRICAL',
      'HISTORICAL_BASIS_SEPARATE_FROM_FORWARD_OUTCOME',
      'STAGE_VALID_ACTIONS_AND_COMMON_HORIZON_ENFORCED',
      deterministic.ac.comparisonState,
    ],
    count: 1,
  }];

  let actualBytes = 0;
  let actualRows = 0;
  let completeEpisodes = 0;
  let comparisons = deterministic.comparisonCount;
  let resamples = 0;
  let acceptedBundles = 0;
  let rejectedBundles = 0;
  let unknownAuditCount = 0;
  let executionReplayAdmitted = 0;
  const symbols = new Set<string>();
  const inputReasons: string[] = [];
  const quoteReasons = new Set<string>();
  let arrivalPipeline: ((bundle: unknown) => {
    readonly schemaValid: boolean;
    readonly pitValid: boolean;
    readonly unknownAudit: readonly unknown[];
  }) | null = null;

  for (const entry of manifest.entries) {
    if (deadlineExceeded(startedAt, policy)) throw new Error('PIPELINE_DEADLINE_EXCEEDED');
    const evidencePath = resolve(rootDir, entry.path);
    assertWithinRoot(rootDir, evidencePath);
    if (!existsSync(evidencePath)) {
      rejectedBundles += 1;
      inputReasons.push('EVIDENCE_FILE_MISSING:' + entry.path);
      continue;
    }
    const size = statSync(evidencePath).size;
    actualBytes += size;
    if (size !== entry.bytes) {
      rejectedBundles += 1;
      inputReasons.push('EVIDENCE_SIZE_MISMATCH:' + entry.path);
      continue;
    }
    if (size > policy.limits.maximumInputFileBytes
      || actualBytes > policy.limits.maximumTotalInputBytes) throw new Error('EVIDENCE_BYTE_CAP_EXCEEDED');
    const raw = readFileSync(evidencePath, 'utf8');
    if (sha256(raw) !== entry.sha256) {
      rejectedBundles += 1;
      inputReasons.push('EVIDENCE_HASH_MISMATCH:' + entry.path);
      continue;
    }
    let bundle: { readonly rows?: readonly unknown[] };
    try {
      bundle = JSON.parse(raw) as { readonly rows?: readonly unknown[] };
    } catch {
      rejectedBundles += 1;
      inputReasons.push('EVIDENCE_JSON_INVALID:' + entry.path);
      continue;
    }
    actualRows += Array.isArray(bundle.rows) ? bundle.rows.length : 0;
    completeEpisodes += entry.completeEpisodeCount;
    comparisons += entry.comparisonCount;
    resamples += entry.resampleCount;
    symbols.add(entry.symbol);
    if (actualRows > policy.limits.maximumRows || completeEpisodes > policy.limits.maximumCompleteEpisodes
      || comparisons > policy.limits.maximumPreregisteredComparisons
      || resamples > policy.limits.maximumPreregisteredResamples
      || symbols.size > policy.limits.maximumSymbols) throw new Error('EVIDENCE_RESEARCH_CAP_EXCEEDED');
    if (arrivalPipeline === null) {
      const module = await import('../src/research/real-data-arrival-harness.js');
      arrivalPipeline = module.runRealDataArrivalPipeline;
    }
    const pipeline = arrivalPipeline(bundle);
    if (!pipeline.schemaValid || !pipeline.pitValid) {
      rejectedBundles += 1;
      inputReasons.push(!pipeline.schemaValid
        ? 'OBSERVATION_BUNDLE_SCHEMA_INVALID:' + entry.path
        : 'OBSERVATION_BUNDLE_PIT_INVALID:' + entry.path);
      continue;
    }
    acceptedBundles += 1;
    unknownAuditCount += pipeline.unknownAudit.length;
    if (entry.evidenceClass !== 'REAL_MARKET_EVIDENCE') {
      inputReasons.push('NON_REAL_EVIDENCE_LABEL:' + entry.path + ':' + entry.evidenceClass);
    }
    if (entry.quoteEvidence !== undefined) {
      const admission = classifyQuoteEvidenceAdmission({
        ...entry.quoteEvidence,
        evidenceClass: entry.evidenceClass,
      });
      if (admission.opraExecutionQualityReplay === 'ADMITTED') executionReplayAdmitted += 1;
      for (const reason of admission.reasons) quoteReasons.add(reason);
    }
  }

  const hasEvidence = manifest.entries.length > 0;
  const usableRealEvidence = acceptedBundles > 0
    && manifest.entries.some((entry) => entry.evidenceClass === 'REAL_MARKET_EVIDENCE');
  stages.push({
    id: 'OBSERVATION_BUNDLE_INGESTION',
    status: !hasEvidence ? 'DATA_GAP' : acceptedBundles > 0 ? 'SOURCE_ALREADY_IMPLEMENTED' : 'DATA_GAP',
    reasons: !hasEvidence
      ? ['APPROVED_EVIDENCE_MANIFEST_EMPTY']
      : inputReasons.length > 0 ? [...new Set(inputReasons)].sort() : ['PIT_HASH_AND_UNKNOWN_AUDIT_COMPLETE'],
    count: acceptedBundles,
  });
  stages.push({
    id: 'EXECUTION_QUALITY_ADMISSION',
    status: executionReplayAdmitted > 0 ? 'SOURCE_ALREADY_IMPLEMENTED' : 'DATA_GAP',
    reasons: executionReplayAdmitted > 0
      ? ['VERIFIED_OPRA_HISTORICAL_BBO_EVIDENCE_PRESENT']
      : quoteReasons.size > 0 ? [...quoteReasons].sort() : ['NO_VERIFIED_HISTORICAL_OPRA_BBO_EVIDENCE'],
    count: executionReplayAdmitted,
  });
  stages.push({
    id: 'RESEARCH_ADAPTER_ORCHESTRATION',
    status: 'SOURCE_GAP',
    reasons: [
      'DETERMINISTIC_REGIME_Q_D_H_ENTRY_EXIT_AND_A_C_ADAPTERS_RUN',
      'REAL_EVIDENCE_TO_DOMAIN_ADAPTERS_NOT_IMPLEMENTED',
      'APPROVED_HISTORICAL_OPTION_EVIDENCE_SCHEMA_AND_DATA_REQUIRED',
    ],
    count: deterministic.comparisonCount,
  });
  stages.push({
    id: 'Q_H_D_COMMON_HORIZON_COMPARISON',
    status: usableRealEvidence ? 'EMPIRICAL_GAP' : 'DATA_GAP',
    reasons: [
      'Q_D_IDENTICAL_SHORT_LEG_AND_EXPIRATION_EXPERIMENT_SEPARATE',
      'Q_D_SAME_RISK_BUDGET_EXPERIMENT_SEPARATE',
      'Q_D_DETERMINISTIC_CONTRACT_COMPOSITION_PASSED',
      'H_SHORT_VS_CONVENTIONAL_DETERMINISTIC_COMPOSITION_PASSED',
      'H_2_5_DTE_NO_ROLL_PRESERVED',
      usableRealEvidence ? 'EMPIRICAL_OUTCOMES_NOT_MATURED' : 'MARKET_EVIDENCE_UNAVAILABLE',
    ],
    count: 0,
  });
  stages.push({
    id: 'ENTRY_EXIT_POLICY_REPLAY',
    status: 'EMPIRICAL_GAP',
    reasons: [
      'DETERMINISTIC_POLICY_REPLAY_PASSED',
      'HISTORICAL_REPLAY_NOT_RUN',
      'SOURCE_ANCESTRY_AND_COMPLETE_EXIT_PATH_REQUIRED',
    ],
    count: 0,
  });
  stages.push({
    id: 'RECOVERY_COVERED_CALL_COMPARISON',
    status: usableRealEvidence ? 'EMPIRICAL_GAP' : 'DATA_GAP',
    reasons: [
      'HISTORICAL_BASIS_SEPARATE_FROM_FORWARD_VALUE',
      'STAGE_VALID_ACTIONS_ONLY',
      'A_C_DETERMINISTIC_CONTRACT_COMPOSITION_PASSED',
      'UNRESOLVED_STOCK_AND_OPTION_OUTCOMES_RETAINED',
    ],
    count: 0,
  });
  stages.push({
    id: 'PAPER_AUTHORITY',
    status: 'PAPER_AUTHORITY_GAP',
    reasons: ['NO_AUTOMATIC_STRATEGY_AUTHORITY_CHANGE', 'NO_ORDER_SUBMISSION_PATH'],
    count: 0,
  });

  const overallStatus = source.status === 'SOURCE_GAP'
    ? 'SOURCE_GAP'
    : !usableRealEvidence ? 'DATA_GAP' : 'EMPIRICAL_GAP';
  const generatedAt = (request.now ?? new Date()).toISOString();
  const runId = sha256([
    request.mode,
    request.targetDate,
    request.slotId,
    request.sourceSha,
    manifest.manifestId,
    deterministic.scenarioId,
  ].join('|')).slice(0, 24);
  const recommendations = [
    {
      classification: 'SOURCE_GAP',
      action: 'Define and review real-evidence-to-domain adapters before calling the Actions runner feature-complete; deterministic contract composition alone is not empirical readiness.',
    },
    {
      classification: 'DATA_GAP',
      action: 'Keep historical replay unrun until public-safe immutable option evidence has verified source hashes, PIT lineage, entitlement, and historical BBO coverage.',
    },
    {
      classification: 'EMPIRICAL_GAP',
      action: 'Do not rank Q, H, D, Recovery, or Covered Call while common-horizon after-cost outcomes remain unknown.',
    },
    {
      classification: 'PAPER_AUTHORITY_GAP',
      action: 'Preserve current strategy authority; research output cannot activate Paper or Production behavior.',
    },
  ];
  const receipt = {
    contractVersion: 'theta-zero-cost-research-receipt-v1',
    runId,
    mode: request.mode,
    targetDate: request.targetDate,
    slotId: request.slotId,
    generatedAt,
    sourceSha: request.sourceSha,
    overallStatus,
    historicalReplayStatus: 'HISTORICAL_REPLAY_NOT_RUN',
    manifest: {
      manifestId: manifest.manifestId,
      dataAvailability: manifest.dataAvailability,
      entryCount: manifest.entries.length,
      acceptedBundleCount: acceptedBundles,
      rejectedBundleCount: rejectedBundles,
      unknownAuditCount,
      executionReplayAdmittedCount: executionReplayAdmitted,
    },
    limitsObserved: {
      inputBytes: actualBytes,
      symbols: symbols.size,
      rows: actualRows,
      completeEpisodes,
      comparisons,
      resamples,
      capsReached: false,
    },
    stages,
    recommendations,
    authority: {
      brokerAuthority: false,
      orderSubmissionAvailable: false,
      productionMutationAvailable: false,
      strategyAuthorityChangeAvailable: false,
    },
  };
  const summary = buildSummary(receipt);
  const receiptText = JSON.stringify(receipt, null, 2) + '\n';
  if (Buffer.byteLength(receiptText) > policy.limits.maximumDiagnosticBytes) {
    throw new Error('RECEIPT_SIZE_CAP_EXCEEDED');
  }
  if (Buffer.byteLength(summary) > policy.limits.maximumSummaryBytes) {
    throw new Error('SUMMARY_SIZE_CAP_EXCEEDED');
  }
  const outputDir = resolve(request.outputDir);
  mkdirSync(outputDir, { recursive: true });
  const receiptPath = resolve(outputDir, 'research-receipt.json');
  const summaryPath = resolve(outputDir, 'research-summary.md');
  writeFileSync(receiptPath, receiptText, 'utf8');
  writeFileSync(summaryPath, summary, 'utf8');
  return { receipt, summary, receiptPath, summaryPath };
}

function requiredArgument(args: Record<string, string | true>, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error('MISSING_ARGUMENT:' + name);
  return value;
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2)) as Record<string, string | true>;
  const result = await runBoundedResearch({
    rootDir: process.cwd(),
    mode: requiredArgument(args, 'mode') as BoundedResearchRequest['mode'],
    targetDate: requiredArgument(args, 'target-date'),
    slotId: requiredArgument(args, 'slot-id'),
    sourceSha: requiredArgument(args, 'source-sha'),
    policyPath: requiredArgument(args, 'policy'),
    manifestPath: requiredArgument(args, 'manifest'),
    outputDir: requiredArgument(args, 'output-dir'),
  });
  process.stdout.write(JSON.stringify({
    status: result.receipt.overallStatus,
    receiptBytes: statSync(result.receiptPath).size,
    summaryBytes: statSync(result.summaryPath).size,
  }) + '\n');
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write('THETA_RESEARCH_ACTIONS_FAILED:'
      + (error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  });
}
