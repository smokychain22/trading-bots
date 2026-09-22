#!/usr/bin/env node
// THETA quantified unknown audit generator (Wave 9 Batch 2). Research
// tooling, no Production side effects. Reuses the already-completed
// capability registry (src/research/pre-vps-capability-registry.ts) as
// the denominator -- does NOT build a new one, per this wave's own
// instruction. Classifies every real registry row into the categories
// this wave asked for, derived from the registry's existing real fields
// (currentState/runtimeReachable/maturity/persistence/empiricallyValidated),
// never guessed independently of that source data.
//
// Usage: npx tsx tools/theta-unknown-audit.mjs
import { capabilityRegistry } from '../src/research/pre-vps-capability-registry.ts';

function classify(r) {
  if (r.maturity === 'RESEARCH_ONLY' || r.maturity === 'DEPRECATED') return 'NOT_APPLICABLE';
  if (r.currentState === 'QUARANTINED_NO_CALLERS') return 'NOT_APPLICABLE';
  if (r.currentState === 'STUB_DEFAULT') return 'IMPLEMENTATION_DEFECT';
  if (r.currentState === 'MISSING') return 'NO_PROVIDER_CAPABILITY';
  if (r.currentState === 'NOT_INDEPENDENTLY_VERIFIED') return 'LEGITIMATE_RUNTIME_UNKNOWN';
  if (r.currentState === 'PARTIAL') {
    if (r.runtimeReachable === false || r.runtimeReachable === 'PARTIAL') return 'DATA_EXISTS_BUT_NOT_WIRED';
    return 'DATA_EXISTS_BUT_NOT_CONSUMED';
  }
  if (r.currentState === 'REAL') {
    if (r.persistence && r.persistence.toLowerCase().includes('not independently verified')) return 'DATA_EXISTS_BUT_NOT_PERSISTED';
    if (r.maturity === 'PRODUCTION_REQUIRED' && !r.empiricallyValidated) return 'EMPIRICALLY_UNPROVEN';
    return 'DATA_EXISTS_AND_WIRED';
  }
  return 'UNCLASSIFIED';
}

const counts = {};
const rows = [];
for (const r of capabilityRegistry) {
  const c = classify(r);
  counts[c] = (counts[c] ?? 0) + 1;
  rows.push({ id: r.capabilityId, class: c, blocker: r.blocker });
}

const avoidable = (counts.DATA_EXISTS_BUT_NOT_WIRED ?? 0) + (counts.DATA_EXISTS_BUT_NOT_CONSUMED ?? 0) + (counts.IMPLEMENTATION_DEFECT ?? 0);
const legitimate = (counts.LEGITIMATE_RUNTIME_UNKNOWN ?? 0) + (counts.NOT_APPLICABLE ?? 0);

console.log('=== THETA quantified unknown audit (denominator: pre-vps-capability-registry.ts, 40 rows) ===\n');
console.log(JSON.stringify(counts, null, 2));
console.log(`\nAVOIDABLE_UNKNOWN_COUNT (DATA_EXISTS_BUT_NOT_WIRED + DATA_EXISTS_BUT_NOT_CONSUMED + IMPLEMENTATION_DEFECT) = ${avoidable}`);
console.log(`LEGITIMATE_UNKNOWN_COUNT (LEGITIMATE_RUNTIME_UNKNOWN + NOT_APPLICABLE) = ${legitimate}`);
console.log(`PROVIDER_LIMITED_COUNT (registry has no dedicated state for this yet) = 0 -- distinct from LEGITIMATE_RUNTIME_UNKNOWN, not currently modeled`);
console.log(`\n--- per-row classification ---`);
for (const row of rows) console.log(`${row.id} | ${row.class}`);
