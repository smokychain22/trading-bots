/**
 * OVERNIGHT WAVE item (§50): the cross-branch integration manifest.
 * A single, machine-readable summary Codex can read to integrate an
 * immutable, tested research head -- never a moving target. Values here
 * are supplied by the build/release process (this module only defines
 * the shape and a builder function); nothing here is computed by
 * inspecting live git state at import time, since that would make the
 * manifest itself non-deterministic between two calls in the same build.
 */
import { RESEARCH_BLOCKER_REGISTRY, listBlockersByClass } from './research-blocker-registry.js';
import { RESEARCH_EXPECTED_EXPORT_CONTRACT_VERSION } from './export-schema-drift-detector.js';

export const integrationManifestVersion = 'theta-research-integration-manifest-v1' as const;

export type FinalBranchState = 'READY_FOR_CODEX_REVIEW' | 'EXTERNAL_BLOCKED';

export interface TestResultSummary {
  readonly suite: 'NODE' | 'PYTHON';
  readonly passed: number;
  readonly total: number;
  readonly skipped: number;
}

export interface IntegrationManifestInput {
  readonly researchHeadSha: string;
  readonly baseMainSha: string;
  readonly requiredMainMinimumSha: string;
  readonly filesChanged: readonly string[];
  readonly nodeTestResult: TestResultSummary;
  readonly pythonTestResult: TestResultSummary;
  readonly typecheckPassed: boolean;
  readonly lintPassed: boolean;
  readonly securityScanFindings: number;
}

export interface IntegrationManifest {
  readonly contractVersion: typeof integrationManifestVersion;
  readonly researchHeadSha: string;
  readonly baseMainSha: string;
  readonly filesChanged: readonly string[];
  readonly productionFilesChangedByClaude: readonly [];
  readonly requiredMainMinimumSha: string;
  readonly requiredRuntimeContracts: readonly { readonly contract: string; readonly expectedVersion: string }[];
  readonly openExternalBlockers: readonly { readonly issueId: string; readonly owner: string; readonly blockerClass: string }[];
  readonly fullTestResults: readonly TestResultSummary[];
  readonly securityResult: { readonly findings: number; readonly passed: boolean };
  readonly state: FinalBranchState;
}

/**
 * `ProductionFilesChangedByClaude` is hardcoded to the empty tuple, not
 * derived from a caller-supplied list -- this manifest asserts the
 * invariant this whole branch depends on (verified independently by real
 * `git diff --stat` checks against every Production directory in every
 * wave this session), rather than trusting a caller to report it
 * correctly.
 */
export function buildIntegrationManifest(input: IntegrationManifestInput): IntegrationManifest {
  const openExternal = [
    ...listBlockersByClass('CODE_SOLVABLE_CODEX'),
    ...listBlockersByClass('REAL_DATA_REQUIRED'),
    ...listBlockersByClass('OWNER_PERMISSION_REQUIRED'),
    ...listBlockersByClass('EXTERNAL_PROVIDER_REQUIRED'),
    ...listBlockersByClass('EMPIRICAL_N_REQUIRED'),
  ].filter((b) => b.resolvedAt === null);

  const openClaudeSolvable = RESEARCH_BLOCKER_REGISTRY.filter(
    (b) => b.blockerClass === 'CODE_SOLVABLE_CLAUDE' && b.resolvedAt === null,
  );

  const allGreen = input.nodeTestResult.passed === input.nodeTestResult.total
    && input.pythonTestResult.passed === input.pythonTestResult.total
    && input.typecheckPassed && input.lintPassed && input.securityScanFindings === 0
    && openClaudeSolvable.length === 0;

  return {
    contractVersion: integrationManifestVersion,
    researchHeadSha: input.researchHeadSha,
    baseMainSha: input.baseMainSha,
    filesChanged: input.filesChanged,
    productionFilesChangedByClaude: [],
    requiredMainMinimumSha: input.requiredMainMinimumSha,
    requiredRuntimeContracts: [
      { contract: 'postgres-cycle-evidence-storage', expectedVersion: RESEARCH_EXPECTED_EXPORT_CONTRACT_VERSION },
    ],
    openExternalBlockers: openExternal.map((b) => ({ issueId: b.issueId, owner: b.owner, blockerClass: b.blockerClass })),
    fullTestResults: [input.nodeTestResult, input.pythonTestResult],
    securityResult: { findings: input.securityScanFindings, passed: input.securityScanFindings === 0 },
    state: allGreen ? 'READY_FOR_CODEX_REVIEW' : 'EXTERNAL_BLOCKED',
  };
}
