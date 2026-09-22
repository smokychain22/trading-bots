import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAivenConnectionString, resolveDatabaseConnection } from '../tools/database-connection.mjs';

test('migration resolver preserves encrypted Aiven libpq require semantics', () => {
  const normalized = normalizeAivenConnectionString(
    'postgres://user:fake-secret@service.aivencloud.com:25934/defaultdb?sslmode=require',
  );
  const parsed = new URL(normalized);
  assert.equal(parsed.searchParams.get('sslmode'), 'require');
  assert.equal(parsed.searchParams.get('uselibpqcompat'), 'true');
});

test('Aiven authority cannot be shadowed by a stale generic database URL', () => {
  const resolved = resolveDatabaseConnection({
    DATABASE_RUNTIME_AUTHORITY: 'AIVEN',
    AIVEN_DATABASE_URL: 'postgresql://aiven.invalid/theta',
    DATABASE_URL: 'postgresql://stale-neon.invalid/theta',
  }, 'migration');
  assert.equal(resolved.authority, 'AIVEN');
  assert.equal(resolved.sourceVariable, 'AIVEN_DATABASE_URL');
  assert.equal(resolved.connectionString, 'postgresql://aiven.invalid/theta');
});

test('Aiven authority fails closed instead of falling back to a generic URL', () => {
  assert.throws(() => resolveDatabaseConnection({
    DATABASE_RUNTIME_AUTHORITY: 'AIVEN',
    DATABASE_URL: 'postgresql://stale-neon.invalid/theta',
  }), /AIVEN_DATABASE_NOT_CONFIGURED/);
});

test('legacy archive access requires the explicit read-only variable', () => {
  assert.throws(() => resolveDatabaseConnection({ DATABASE_URL: 'postgresql://neon.invalid/theta' }, 'archive'),
    /NEON_ARCHIVE_DATABASE_NOT_CONFIGURED/);
  const resolved = resolveDatabaseConnection({
    NEON_ARCHIVE_DATABASE_URL: 'postgresql://archive.neon.tech/theta',
  }, 'archive');
  assert.equal(resolved.authority, 'NEON_ARCHIVE');
  assert.equal(resolved.sourceVariable, 'NEON_ARCHIVE_DATABASE_URL');
});
