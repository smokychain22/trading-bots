import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const RESEARCH_BRANCH = 'codex/zero-cost-theta-research-actions';
const RESEARCH_REF = `refs/heads/${RESEARCH_BRANCH}`;
const CI_WORKFLOW = readFileSync('.github/workflows/ci.yml', 'utf8');

function extractPersistentStoragePredicate(workflow: string) {
  const match = workflow.match(
    /CI_PERSISTENT_STORAGE_ALLOWED:\s*\$\{\{\s*github\.ref\s*!=\s*'([^']+)'\s*&&\s*github\.head_ref\s*!=\s*'([^']+)'\s*}}/,
  );
  assert.ok(match, 'CI persistent-storage expression must use the reviewed exact-branch grammar');
  return { excludedRef: match[1], excludedHeadRef: match[2] };
}

const STORAGE_PREDICATE = extractPersistentStoragePredicate(CI_WORKFLOW);

function persistentStorageAllowed(event: { ref: string; headRef?: string | null; baseRef?: string | null }) {
  return event.ref !== STORAGE_PREDICATE.excludedRef && event.headRef !== STORAGE_PREDICATE.excludedHeadRef;
}

function stepBlock(workflow: string, name: string) {
  const marker = `      - name: ${name}`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `missing step: ${name}`);
  const next = workflow.indexOf('\n      - ', start + marker.length);
  return workflow.slice(start, next === -1 ? workflow.length : next);
}

function extractCacheExpression(workflow: string) {
  const setupNode = workflow.match(/- uses: actions\/setup-node@v4[\s\S]*?cache:\s*([^\r\n]+)/);
  assert.ok(setupNode, 'setup-node cache expression is required');
  return setupNode[1].trim();
}

function evaluateCacheExpression(expression: string, environment: Record<string, string>) {
  const match = expression.match(
    /^\$\{\{\s*env\.([A-Z0-9_]+)\s*==\s*'([^']+)'\s*&&\s*'([^']*)'\s*\|\|\s*'([^']*)'\s*}}$/,
  );
  assert.ok(match, 'setup-node cache expression must use the reviewed conditional grammar');
  return environment[match[1]] === match[2] ? match[3] : match[4];
}

function extractUploadExpression(workflow: string, name: string) {
  const match = stepBlock(workflow, name).match(/\n\s*if:\s*([^\r\n]+)/);
  assert.ok(match, `missing upload condition: ${name}`);
  return match[1].trim();
}

function evaluateUploadExpression(
  expression: string,
  environment: Record<string, string>,
  outcome: 'success' | 'failure',
) {
  const match = expression.match(/^always\(\)\s*&&\s*env\.([A-Z0-9_]+)\s*==\s*'([^']+)'$/);
  assert.ok(match, 'artifact condition must use always() and the reviewed environment grammar');
  const alwaysResult = outcome === 'success' || outcome === 'failure';
  return alwaysResult && environment[match[1]] === match[2];
}

const CACHE_EXPRESSION = extractCacheExpression(CI_WORKFLOW);
const ARTIFACT_STEP_NAMES = [
  'Browser evidence',
  'Preserve sanitized disposable-database executed test identities',
] as const;
const UPLOAD_EXPRESSIONS = ARTIFACT_STEP_NAMES.map((name) => extractUploadExpression(CI_WORKFLOW, name));

function evaluateActualWorkflowStorage(event: { ref: string; headRef?: string | null }, outcome: 'success' | 'failure') {
  const environment = { CI_PERSISTENT_STORAGE_ALLOWED: String(persistentStorageAllowed(event)) };
  return {
    cacheInput: evaluateCacheExpression(CACHE_EXPRESSION, environment),
    uploadStepsRun: UPLOAD_EXPRESSIONS.map((expression) => evaluateUploadExpression(expression, environment, outcome)),
  };
}

test('persistent storage stays enabled for main, V4, and unrelated pull requests', () => {
  assert.deepEqual(STORAGE_PREDICATE, { excludedRef: RESEARCH_REF, excludedHeadRef: RESEARCH_BRANCH });
  for (const event of [
    { ref: 'refs/heads/main' },
    { ref: 'refs/heads/codex/theta-v4-integration' },
    {
    ref: 'refs/pull/42/merge',
    headRef: 'feature/unrelated-change',
    },
  ]) {
    const evaluated = evaluateActualWorkflowStorage(event, 'success');
    assert.equal(evaluated.cacheInput, 'npm');
    assert.deepEqual(evaluated.uploadStepsRun, [true, true]);
  }
});

test('persistent storage is disabled for research pushes and pull requests', () => {
  for (const event of [
    { ref: RESEARCH_REF },
    { ref: 'refs/pull/43/merge', headRef: RESEARCH_BRANCH, baseRef: 'main' },
    { ref: 'refs/pull/44/merge', headRef: RESEARCH_BRANCH, baseRef: 'codex/theta-v4-integration' },
  ]) {
    const evaluated = evaluateActualWorkflowStorage(event, 'success');
    assert.equal(evaluated.cacheInput, '');
    assert.deepEqual(evaluated.uploadStepsRun, [false, false]);
  }
});

test('failure-path artifact behavior follows the branch guard, not test outcome', () => {
  for (const outcome of ['success', 'failure'] as const) {
    assert.deepEqual(evaluateActualWorkflowStorage({ ref: RESEARCH_REF }, outcome), {
      cacheInput: '', uploadStepsRun: [false, false],
    });
    assert.deepEqual(evaluateActualWorkflowStorage({ ref: 'refs/heads/main' }, outcome), {
      cacheInput: 'npm', uploadStepsRun: [true, true],
    });
  }
});

test('CI applies one exact guard to setup-node cache and both artifact writers', () => {
  const workflow = CI_WORKFLOW;
  assert.ok(workflow.includes(
    `CI_PERSISTENT_STORAGE_ALLOWED: \${{ github.ref != '${RESEARCH_REF}' && github.head_ref != '${RESEARCH_BRANCH}' }}`,
  ));
  assert.ok(workflow.includes(
    "cache: ${{ env.CI_PERSISTENT_STORAGE_ALLOWED == 'true' && 'npm' || '' }}",
  ));

  const uploadGuard = "if: always() && env.CI_PERSISTENT_STORAGE_ALLOWED == 'true'";
  for (const name of ARTIFACT_STEP_NAMES) {
    const block = stepBlock(workflow, name);
    assert.ok(block.includes(uploadGuard), `${name} must be storage guarded`);
    assert.ok(block.includes('uses: actions/upload-artifact@v4'));
  }
  assert.equal((workflow.match(/uses: actions\/upload-artifact@v4/g) ?? []).length, 2);
});

test('all CI checks and failure-path sanitation remain independent of the storage guard', () => {
  const workflow = CI_WORKFLOW;
  for (const required of [
    'npm run lint',
    'npm run check',
    'npm test -- --evidence=.ci-test-evidence/node-suite.jsonl',
    'npm run scan:security',
    'npm run storage:git-policy',
    './tests/windows/theta-backup-readonly-guard.test.ps1',
    "python -m unittest discover -s bots/theta/tests/quant -p 'test_*.py'",
    'tests/db/schema-064-locked-worker.integration.test.ts',
  ]) assert.ok(workflow.includes(required), `missing essential check: ${required}`);

  const scan = stepBlock(workflow, 'Scan generated evidence and test output for secrets before it is uploaded');
  assert.ok(scan.includes('if: always()'));
  assert.equal(scan.includes('CI_PERSISTENT_STORAGE_ALLOWED'), false);
});

test('bounded research workflow remains default-off and has no persistent-write action', () => {
  const workflow = readFileSync('.github/workflows/theta-research.yml', 'utf8');
  assert.ok(workflow.includes("vars.THETA_RESEARCH_ACTIONS_ENABLED == 'true'"));
  assert.ok(workflow.includes('permissions:\n  contents: read'));
  assert.ok(workflow.includes('runs-on: ubuntu-24.04'));
  assert.ok(workflow.includes('timeout-minutes: 12'));
  assert.ok(workflow.includes('package-manager-cache: false'));
  assert.equal(/actions\/upload-artifact@|actions\/cache@|cache\/save@/.test(workflow), false);
  assert.equal(/DATABASE_URL|ALPACA_|submitOrder/i.test(workflow), false);
});
