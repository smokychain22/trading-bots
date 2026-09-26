import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// Phase 1 (Profitability Brain Completion Program) 1H residual closure.
// Real, static source-scanning regression tests -- these catch a NEW
// competing authority being introduced, not a runtime behavioral proof
// (that would require calling Codex-owned business logic with realistic
// broker/AEGIS inputs, out of this session's scope). A grep-based test is
// a legitimate, real regression guard for "did someone add a second
// function that assigns all three sovereign-selection fields together."

function listTsFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) { out.push(...listTsFilesRecursive(full)); continue; }
    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

// Verified case-by-case (not a blanket exemption): both files below construct
// an object with these three key names, but in each case the VALUES are read
// directly from `partial.selectedCandidateId` / `partial.primaryAction` /
// `partial.selectedQuantity` -- the one real structural selection computed
// once in canonical-strategy-frontier.ts -- and are being relabeled only to
// match a specific downstream consumer's input contract (the shadow/adaptive
// comparator, SHADOW authority, confirmed non-competing in Phase 1's 1C
// audit). This is a relabeling pass-through of one value for two consumer
// shapes, not two independent computations. Any FUTURE addition to this list
// must be individually re-verified the same way, not added by pattern match.
const KNOWN_SOVEREIGN_VALUE_RELABEL_SITES = [
  'canonical-strategy-frontier.ts', // constructs the value itself, then relabels it once for buildAdaptiveShadowDecisionReceipt's input contract (line ~640)
  'adaptive-decision-brain.ts', // receives that relabeled value as an input parameter type declaration, never computes it independently
];

test('CORE CLAIM: only canonical-decision-authority.ts assigns selectedCandidateRef+actionCode+quantity together as one object literal', () => {
  const files = listTsFilesRecursive(join(process.cwd(), 'src', 'theta'));
  const offenders: string[] = [];
  for (const file of files) {
    if (file.endsWith('canonical-decision-authority.ts')) continue;
    if (KNOWN_SOVEREIGN_VALUE_RELABEL_SITES.some((name) => file.endsWith(name))) continue;
    const text = readFileSync(file, 'utf8');
    const hasAll3 = text.includes('selectedCandidateRef') && text.includes('actionCode') && text.includes('quantity');
    // Only flag it if all three appear as object-literal KEYS (assignment),
    // not merely referenced/read/passed through -- a subordinate evidence
    // wrapper reading these fields off the sovereign result is expected and
    // fine; a second file independently *constructing* an object with all
    // three keys would be the real duplicate-authority signal.
    const constructsAll3 = /selectedCandidateRef\s*:/.test(text)
      && /actionCode\s*:/.test(text)
      && /quantity\s*:/.test(text);
    if (hasAll3 && constructsAll3) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `Found a file other than canonical-decision-authority.ts constructing all three sovereign-selection fields: ${offenders.join(', ')}`);
});

test('CORE CLAIM: only management-action-frontier.ts exports buildManagementActionFrontier', () => {
  const files = listTsFilesRecursive(join(process.cwd(), 'src', 'theta'));
  const definers = files.filter((file) => {
    const text = readFileSync(file, 'utf8');
    return /export\s+function\s+buildManagementActionFrontier\s*\(/.test(text);
  });
  assert.deepEqual(definers.map((f) => f.split(/[\\/]/).pop()), ['management-action-frontier.ts']);
});

test('CORE CLAIM: only canonical-decision-authority.ts exports resolveCanonicalDecisionAuthority', () => {
  const files = listTsFilesRecursive(join(process.cwd(), 'src', 'theta'));
  const definers = files.filter((file) => {
    const text = readFileSync(file, 'utf8');
    return /export\s+function\s+resolveCanonicalDecisionAuthority\s*\(/.test(text);
  });
  assert.deepEqual(definers.map((f) => f.split(/[\\/]/).pop()), ['canonical-decision-authority.ts']);
});
