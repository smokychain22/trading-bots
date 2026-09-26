import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  classifyAccountDrawdownRegime, type AccountDrawdownRegimeThresholdPolicy,
} from '../src/research/account-drawdown-regime-research.js';

const POLICY: AccountDrawdownRegimeThresholdPolicy = {
  policyVersion: 'test-v1',
  cautionDrawdownFraction: 0.05,
  defensiveDrawdownFraction: 0.10,
  pauseNewRiskDrawdownFraction: 0.20,
};

test('CORE CLAIM: unknown drawdown is never defaulted to NORMAL', () => {
  const result = classifyAccountDrawdownRegime(
    { currentDrawdownFraction: null, trailingLossEpisodeCount: null, asOf: '2026-09-26T00:00:00Z' },
    POLICY,
  );
  assert.equal(result.regime, 'UNKNOWN');
});

test('below every threshold is NORMAL', () => {
  const result = classifyAccountDrawdownRegime(
    { currentDrawdownFraction: 0.01, trailingLossEpisodeCount: 0, asOf: '2026-09-26T00:00:00Z' },
    POLICY,
  );
  assert.equal(result.regime, 'NORMAL');
});

test('exactly at the caution threshold is CAUTION (inclusive boundary)', () => {
  const result = classifyAccountDrawdownRegime(
    { currentDrawdownFraction: 0.05, trailingLossEpisodeCount: 1, asOf: '2026-09-26T00:00:00Z' },
    POLICY,
  );
  assert.equal(result.regime, 'CAUTION');
});

test('above the pause threshold is PAUSE_NEW_RISK', () => {
  const result = classifyAccountDrawdownRegime(
    { currentDrawdownFraction: 0.25, trailingLossEpisodeCount: 3, asOf: '2026-09-26T00:00:00Z' },
    POLICY,
  );
  assert.equal(result.regime, 'PAUSE_NEW_RISK');
});

test('ADVERSARIAL: the classification never returns a field that could be mistaken for broker authority', () => {
  const result = classifyAccountDrawdownRegime(
    { currentDrawdownFraction: 0.5, trailingLossEpisodeCount: 10, asOf: '2026-09-26T00:00:00Z' },
    POLICY,
  );
  assert.ok(!('brokerAuthority' in result) || (result as { brokerAuthority?: unknown }).brokerAuthority === undefined);
  assert.ok(!('sizingOverride' in result));
});

// Phase 4 (directive item 81): the drawdown-authority firewall. There is no
// runtime input on canonical-strategy-frontier.ts or sizing.py for a
// drawdown regime to influence in the first place, so the real proof this
// pass can make is structural: no production module (outside this research
// file and its own test) imports account-drawdown-regime-research.ts at
// all. If a future change ever wires this in, this test fails loudly and
// forces a deliberate, reviewed decision rather than silent authority
// leakage.
function listTsFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) files.push(...listTsFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) files.push(full);
  }
  return files;
}

test('DRAWDOWN AUTHORITY FIREWALL: no production module imports account-drawdown-regime-research.ts -- research-only stays research-only', () => {
  const productionFiles = listTsFiles(join(process.cwd(), 'src')).filter((f) => !f.includes('account-drawdown-regime-research.ts'));
  const importers = productionFiles.filter((f) => readFileSync(f, 'utf8').includes('account-drawdown-regime-research'));
  assert.deepEqual(importers, [], `expected zero production consumers of the research-only drawdown regime module, found: ${importers.join(', ')}`);
});
