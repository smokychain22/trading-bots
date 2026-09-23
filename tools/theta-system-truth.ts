import { execFileSync } from 'node:child_process';
import { canonicalSystemTruthRegister } from '../src/theta/canonical-system-truth.js';

const baseline = canonicalSystemTruthRegister.sourceBaselineSha;
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceFiles = [...new Set(canonicalSystemTruthRegister.capabilities.flatMap((item) => item.sourceFiles))];
let sourceVerificationState: 'SOURCE_BASELINE_UNCHANGED' | 'STALE_REVIEW_REQUIRED'
  | 'WORKTREE_DIRTY' | 'UNVERIFIED_GIT_HISTORY';
let sourceFilesChanged: string[] = [];
try {
  execFileSync('git', ['merge-base', '--is-ancestor', baseline, head], { stdio: 'ignore' });
  sourceFilesChanged = execFileSync('git', ['diff', '--name-only', baseline, head, '--', ...sourceFiles],
    { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
  sourceVerificationState = sourceFilesChanged.length === 0 ? 'SOURCE_BASELINE_UNCHANGED' : 'STALE_REVIEW_REQUIRED';
} catch {
  sourceVerificationState = 'UNVERIFIED_GIT_HISTORY';
}
const dirtyPaths = execFileSync('git', ['status', '--porcelain', '--', ...sourceFiles,
  'src/theta/canonical-system-truth.ts', 'tools/theta-system-truth.ts'], { encoding: 'utf8' }).trim();
if (dirtyPaths) sourceVerificationState = 'WORKTREE_DIRTY';

const receipt = {
  ...canonicalSystemTruthRegister,
  currentSourceSha: head,
  sourceVerificationState,
  sourceFilesChanged,
  runtimeTruthSource: 'theta:truth-runtime',
};
console.log(JSON.stringify(process.argv.includes('--full') ? receipt : {
  schemaVersion: receipt.schemaVersion,
  auditCoverage: receipt.auditCoverage,
  sourceBaselineSha: receipt.sourceBaselineSha,
  currentSourceSha: receipt.currentSourceSha,
  sourceVerificationState: receipt.sourceVerificationState,
  sourceFilesChanged: receipt.sourceFilesChanged,
  runtimeTruthSource: receipt.runtimeTruthSource,
  layerCount: receipt.brainLayers.length,
  capabilityCount: receipt.capabilities.length,
  hardBlockers: receipt.capabilities.filter((item) => item.disposition === 'TRUE_HARD_BLOCKER')
    .map((item) => ({ capabilityId: item.capabilityId, currentBlocker: item.currentBlocker })),
}));
