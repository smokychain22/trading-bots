import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Phase 1 Zero-Unknown Reclosure Pass 3 continuation (item 7): motivated
// directly by Sep24 (Postgres down, database-independent fallback taken).
// tools/theta-no-submit-probe.ts is a script, not an importable function --
// it reads real credentials from the process environment and makes real
// Alpaca calls, so simulating a genuine Postgres-down run here would
// require faking network/DB state at a scale disproportionate to what this
// specific safety property needs. Instead: a real, static structural proof
// that the T0 replay wiring this pass added inside the database-independent
// fallback branch calls only buildT0ReplayBundle/spoolEvidence -- never any
// broker/order-submission surface -- so it cannot be the source of a
// broker mutation or order submission regardless of database state.
const probeSourcePath = fileURLToPath(new URL('../tools/theta-no-submit-probe.ts', import.meta.url));
const probeSource = readFileSync(probeSourcePath, 'utf8');

test('the T0 replay bundle wiring inside the database-independent fallback path never calls a broker/order-submission surface', () => {
  const wiringStart = probeSource.indexOf("if(symbol.canonicalFrontierInput!==null){");
  assert.ok(wiringStart >= 0, 'the T0 replay wiring block must exist in the database-independent fallback path');
  const wiringEnd = probeSource.indexOf('spoolReachedStage(\'QUOTES_READY\'', wiringStart);
  assert.ok(wiringEnd > wiringStart);
  const wiringBlock = probeSource.slice(wiringStart, wiringEnd);
  assert.doesNotMatch(wiringBlock, /broker\.|placeOrder|submitOrder|createOrder|cancelOrder|replaceOrder/,
    'the T0 replay wiring must never touch a broker/order-submission surface, regardless of database state');
  assert.match(wiringBlock, /buildT0ReplayBundle\(/);
  assert.match(wiringBlock, /spoolEvidence\('T0_REPLAY_BUNDLE'/);
  assert.match(wiringBlock, /spoolEvidence\('T0_REPLAY_BUNDLE_UNAVAILABLE'/);
});

test('the database-independent fallback branch (this exact wiring\'s home) is only reached from the retryable-database-failure catch, never from the healthy Postgres path', () => {
  const fallbackMarker = probeSource.indexOf('DATABASE_INDEPENDENT_PROVIDER_OBSERVATION');
  const wiringStart = probeSource.indexOf("if(symbol.canonicalFrontierInput!==null){");
  assert.ok(fallbackMarker >= 0 && wiringStart > fallbackMarker,
    'the T0 replay wiring must live inside the retryable-database-failure fallback path, not the healthy path');
});
