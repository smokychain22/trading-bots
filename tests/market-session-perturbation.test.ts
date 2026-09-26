import assert from 'node:assert/strict';
import test from 'node:test';
import { paperExecutionHandoffMarketGate } from '../src/theta/autonomous-runtime.js';

// Phase 2 Pass B Final Closure C (directive section 10-12): MARKET/SESSION
// perturbation, automated. `paperExecutionHandoffMarketGate` is the exact
// pure decision extracted from the PAPER_EXECUTION_HANDOFF job's real
// production gate (autonomous-runtime.ts) -- no Postgres pool, broker
// client, or test-only bypass logic involved. Same relevant state
// (reconciliation), only `marketOpen` differs.

test('MARKET/SESSION PERTURBATION: marketOpen=false blocks with MARKET_CLOSED_NO_PAPER_EXECUTION', () => {
  const gate = paperExecutionHandoffMarketGate({ marketOpen: false });
  assert.equal(gate, 'MARKET_CLOSED_NO_PAPER_EXECUTION');
});

test('MARKET/SESSION PERTURBATION: marketOpen=true proceeds past the market-closed gate (null means continue)', () => {
  const gate = paperExecutionHandoffMarketGate({ marketOpen: true });
  assert.equal(gate, null);
});

test('MARKET/SESSION PERTURBATION: marketOpen=null (unknown, never coerced to open) is treated the same as closed -- fail-closed, never assumed open', () => {
  const gate = paperExecutionHandoffMarketGate({ marketOpen: null });
  assert.equal(gate, 'MARKET_CLOSED_NO_PAPER_EXECUTION');
});
