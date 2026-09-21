import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Bounded regression guard for the two confirmed false-safe producer defects.
// This does not replace a semantic review of all nullable financial inputs.
const source = async (path: string): Promise<string> => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('universe discovery never labels unverified event coverage as known false', async () => {
  const code = await source('src/theta/universe-discovery.ts');
  assert.doesNotMatch(code, /unsupportedCorporateActionPending:\s*false\b/);
  assert.doesNotMatch(code, /eventNear:\s*false\b/);
});

test('unknown regime event state is not coerced to no-event for the strategy router', async () => {
  const code = await source('src/theta/new-risk-orchestrator.ts');
  assert.doesNotMatch(code, /eventNear:\s*regimeResult\.data\.eventState\s*!==\s*null\s*&&/);
});

test('Alpaca contract identity is not filled with empty symbol, zero strike, or empty expiry', async () => {
  const code = await source('src/theta/alpaca-provider.ts');
  assert.doesNotMatch(code, /strikePrice:\s*asNumberOrNull\(c\.strike_price\)\s*\?\?\s*0/);
  assert.doesNotMatch(code, /symbol:\s*asStringOrNull\(c\.symbol\)\s*\?\?\s*''/);
  assert.doesNotMatch(code, /expirationDate:\s*asStringOrNull\(c\.expiration_date\)\s*\?\?\s*''/);
});
