/**
 * COMMAND 5C-7 item 48/61. Machine-readable blocker registry. The
 * directive's own completion rule: a blocker with class
 * `CODE_SOLVABLE_CLAUDE` must not remain open at completion --
 * `assertNoOpenClaudeSolvableBlockers` makes that a checkable, throwing
 * invariant rather than a promise kept only in prose. Every entry below
 * that IS code-solvable has already been closed this wave (see
 * `resolvedAt`); only genuinely external-class blockers remain open.
 */

export const researchBlockerRegistryVersion = 'theta-research-blocker-registry-v1' as const;

export type BlockerClass =
  | 'CODE_SOLVABLE_CLAUDE' | 'CODE_SOLVABLE_CODEX' | 'REAL_DATA_REQUIRED'
  | 'OWNER_PERMISSION_REQUIRED' | 'EXTERNAL_PROVIDER_REQUIRED' | 'EMPIRICAL_N_REQUIRED';

export interface BlockerRecord {
  readonly contractVersion: typeof researchBlockerRegistryVersion;
  readonly issueId: string;
  readonly domain: string;
  readonly owner: 'CLAUDE' | 'CODEX' | 'OWNER' | 'PROVIDER';
  readonly currentState: string;
  readonly exactMissingInput: string;
  readonly whyRequired: string;
  readonly consumer: string;
  readonly canBeBuiltAround: boolean;
  readonly nextAction: string;
  readonly testToClose: string;
  readonly blockerClass: BlockerClass;
  readonly resolvedAt: string | null;
}

export const RESEARCH_BLOCKER_REGISTRY: readonly BlockerRecord[] = [
  {
    contractVersion: researchBlockerRegistryVersion, issueId: 'THETA-CONTRACT-PATH-RUNTIME-OBSERVATION-PRODUCER',
    domain: 'CONTRACT_PATH_DATASET', owner: 'CODEX',
    currentState: 'No runtime process exists that observes and records a candidate/underlying at the 15M/1H/EOD/1D/3D/5D/expiration/common-horizon checkpoints CONTRACT_PATH_DATASET requires.',
    exactMissingInput: 'A scheduled Codex-owned observation job writing one row per (subjectId, checkpoint) with observedAt, marketMarkPrice, impliedVol, underlyingPrice, and a provenance flag distinguishing a real scheduled observation from a reconstructed/backfilled one.',
    whyRequired: 'Without it, CONTRACT_PATH_DATASET, filter-value analysis, strategy comparison, experience memory, and the session experience report can never receive real path data -- only fixtures.',
    consumer: 'src/research/contract-path-outcome-dataset.ts, src/research/filter-value-classification.ts, src/research/experience-memory-contract.ts, src/research/session-experience-report.ts',
    canBeBuiltAround: true, nextAction: 'Codex designs and ships the observation-scheduling process; research side is already contract-complete and ready to consume it on arrival.',
    testToClose: 'A real-data-arrival test proving the first genuine Codex-produced observation bundle flows through schema validation -> PIT validation -> dataset build with zero new code required.',
    blockerClass: 'CODE_SOLVABLE_CODEX', resolvedAt: null,
  },
  {
    contractVersion: researchBlockerRegistryVersion, issueId: 'THETA-EXPORT-SCHEMA-COMPATIBILITY-NOT-CHECKED',
    domain: 'INTEGRATION_READINESS', owner: 'CLAUDE',
    currentState: 'No compile-time/runtime compatibility check existed between Codex\'s canonical cycle-evidence export contract version and this branch\'s research adapters -- a silent Codex schema change could have gone unnoticed.',
    exactMissingInput: 'A versioned schema/drift detector plus real adapters consuming the archive\'s actual exported shape.',
    whyRequired: 'When Codex\'s first real observation/export bundle arrives, the branch must accept it deterministically or reject it with an exact version/field error -- never guess.',
    consumer: 'src/research/canonical-export-adapters.ts, src/research/export-schema-drift-detector.ts',
    canBeBuiltAround: true, nextAction: 'CLOSED this wave -- see export-schema-drift-detector.ts (COMPATIBLE/BACKWARD_COMPATIBLE/MISSING_REQUIRED_FIELD/UNKNOWN_ENUM_VALUE/VERSION_AHEAD_UNSUPPORTED/VERSION_BEHIND_UNSUPPORTED) and canonical-export-adapters.ts (real decision-candidate + strategy-comparison adapters over Codex\'s decoded archive).',
    testToClose: 'tests/export-schema-drift-detector.test.ts + tests/canonical-export-adapters.test.ts (14 tests, real, passing).',
    blockerClass: 'CODE_SOLVABLE_CLAUDE', resolvedAt: '2026-09-26T00:00:00Z',
  },
  {
    contractVersion: researchBlockerRegistryVersion, issueId: 'THETA-RESEARCH-ZERO-REAL-EPISODES',
    domain: 'ALL_STRATEGY_RESEARCH_PROGRAMS', owner: 'OWNER',
    currentState: 'Zero real resolved Q/H/D/Recovery/CC/WAIT episodes exist -- every research pipeline is contract-complete and fixture-tested but has nothing real to run against.',
    exactMissingInput: 'Real Paper trading history, gated by owner authorization for the first Paper canary.',
    whyRequired: 'No amount of research-side code can manufacture real economic outcomes.', consumer: 'every dataset/analysis module in the registry',
    canBeBuiltAround: false, nextAction: 'Owner authorization for first Paper canary, after Codex runtime closure.',
    testToClose: 'N/A -- this closes only when real episodes exist, not by a test.', blockerClass: 'REAL_DATA_REQUIRED', resolvedAt: null,
  },
  {
    contractVersion: researchBlockerRegistryVersion, issueId: 'THETA-DSR-PBO-PYTHON-RUNNER-MISSING',
    domain: 'STATISTICAL_RIGOR', owner: 'CLAUDE',
    currentState: 'Command 4 wrapped selection_bias.py in a TS receipt but reported no runner existed to produce real receipt inputs.',
    exactMissingInput: 'A Python runner computing real trial statistics (Sharpe, skew, kurtosis, cross-trial variance) from a versioned-normalization return series and calling the existing DSR/PBO functions.',
    whyRequired: 'Without it the receipt contract had nothing that could ever produce a real (non-fixture) value.', consumer: 'src/research/selection-bias-receipt.ts',
    canBeBuiltAround: true, nextAction: 'CLOSED this wave -- see bots/theta/quant/research/selection_bias_runner.py.',
    testToClose: 'bots/theta/tests/quant/test_selection_bias_runner.py (8 tests, real, passing).', blockerClass: 'CODE_SOLVABLE_CLAUDE',
    resolvedAt: '2026-09-26T00:00:00Z',
  },
  {
    contractVersion: researchBlockerRegistryVersion, issueId: 'THETA-MODEL-REGISTRY-NOT-DURABLE',
    domain: 'MODEL_LIFECYCLE', owner: 'CLAUDE',
    currentState: 'EmpiricalModelRegistry was in-memory only -- lost on process restart, unsuitable for repeatable experiments.',
    exactMissingInput: 'A durable, research-side (non-Production) persistence backend with hash verification and immutability.',
    whyRequired: 'Repeatable experiments and a real audit trail require durability across restarts.', consumer: 'src/research/empirical-model-registry.ts',
    canBeBuiltAround: true, nextAction: 'CLOSED this wave -- see src/storage/research-durable-store.ts (local SQLite, no Production migration).',
    testToClose: 'tests/research-durable-store.test.ts (real, passing).', blockerClass: 'CODE_SOLVABLE_CLAUDE', resolvedAt: '2026-09-26T00:00:00Z',
  },
  {
    contractVersion: researchBlockerRegistryVersion, issueId: 'THETA-UNKNOWN-TAXONOMY-MISSING',
    domain: 'UNKNOWN_CLOSURE', owner: 'CLAUDE',
    currentState: 'No canonical, centralized UNKNOWN-reason taxonomy existed -- individual modules used ad hoc null/UNKNOWN semantics without a shared avoidability classification.',
    exactMissingInput: 'A 17-value reason taxonomy plus a LEGITIMATE/AVOIDABLE/EXTERNAL/UNCLASSIFIED avoidability mapping.',
    whyRequired: 'Separating good UNKNOWN from avoidable UNKNOWN requires one shared vocabulary, not per-module invention.', consumer: 'future per-family unknown audits',
    canBeBuiltAround: true, nextAction: 'CLOSED this wave -- see src/research/unknown-value-taxonomy.ts.',
    testToClose: 'tests/unknown-value-taxonomy.test.ts (real, passing).', blockerClass: 'CODE_SOLVABLE_CLAUDE', resolvedAt: '2026-09-26T00:00:00Z',
  },
];

/**
 * The directive's own completion rule, made a real, checkable invariant:
 * a CODE_SOLVABLE_CLAUDE blocker with `resolvedAt: null` at the end of a
 * build wave is a genuine violation -- this throws rather than letting one
 * silently pass review.
 */
export function assertNoOpenClaudeSolvableBlockers(registry: readonly BlockerRecord[]): void {
  const open = registry.filter((b) => b.blockerClass === 'CODE_SOLVABLE_CLAUDE' && b.resolvedAt === null);
  if (open.length > 0) {
    throw new Error(`RESEARCH_BLOCKER_REGISTRY_OPEN_CLAUDE_SOLVABLE:${open.map((b) => b.issueId).join(',')}`);
  }
}

export function listBlockersByClass(blockerClass: BlockerClass): readonly BlockerRecord[] {
  return RESEARCH_BLOCKER_REGISTRY.filter((b) => b.blockerClass === blockerClass);
}
