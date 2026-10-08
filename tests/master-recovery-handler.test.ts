import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createMasterRecoveryHandler, recoveryFailureReason } from '../src/customer/master-recovery-handler.js';
import { recoverySignaturePayload, type RecoveryPermit } from '../src/customer/master-credential-recovery.js';

test('unauthorized, plaintext, oversized and missing-control HTTP requests never acquire a database or leak their payload', async () => {
  const pair = generateKeyPairSync('ed25519'), now = Date.now(), host = 'synthetic-recovery.vercel.app';
  const permit: RecoveryPermit = { authorizationId: randomUUID(), sourceSha: 'a'.repeat(40),
    accountHash: 'b'.repeat(64), previousCiphertextHash: 'c'.repeat(64), rollbackFileHash: 'd'.repeat(64),
    ownerPublicKey: pair.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    notBefore: now - 1000, expiresAt: now + 60_000 };
  const operatorToken = 'x'.repeat(32), secret = 'synthetic-private-never-output';
  const body = JSON.stringify({ authorizationId: permit.authorizationId, api_key_id: 'synthetic', secret_key: secret });
  let pools = 0;
  const handler = createMasterRecoveryHandler(permit, { VERCEL_ENV: 'production', VERCEL_URL: host, CRON_SECRET: operatorToken },
    () => { pools++; throw new Error('PRIVATE_ERROR_MUST_NOT_LEAK'); });
  for (const variant of ['unsigned', 'plaintext', 'oversized', 'missing-controls']) {
    const request = Readable.from([variant === 'oversized' ? ' '.repeat(2049) : body]) as unknown as IncomingMessage;
    request.method = 'POST'; request.url = '/api/recover-master';
    request.headers = { host, 'content-type': 'application/json', 'x-forwarded-proto': variant === 'plaintext' ? 'http' : 'https',
      authorization: `Bearer ${operatorToken}`, 'x-theta-recovery-signature': variant === 'unsigned' ? ''
        : sign(null, recoverySignaturePayload(host, permit, body), pair.privateKey).toString('base64') };
    let output = '';
    const response = { setHeader() {}, statusCode: 0, end(value: string) { output = value; } } as unknown as ServerResponse;
    await handler(request, response);
    assert.equal(response.statusCode, 403);
    assert.ok(!output.includes(secret) && !output.includes('PRIVATE_ERROR'));
    assert.equal(JSON.parse(output).automaticRetry, false);
  }
  assert.equal(pools, 0);
});

test('typed recovery failures preserve useful classes without echoing request, provider or database secrets', () => {
  assert.equal(recoveryFailureReason(new Error('RECOVERY_PERMIT_EXPIRED')), 'RECOVERY_PERMIT_EXPIRED');
  assert.equal(recoveryFailureReason({ code: 'POSTGRES_COMMIT_OUTCOME_UNKNOWN', message: 'synthetic-private-secret' }),
    'POSTGRES_COMMIT_OUTCOME_UNKNOWN');
  assert.equal(recoveryFailureReason({ code: 'EAI_AGAIN', message: 'synthetic-private-database-url' }), 'POSTGRES_EAI_AGAIN');
  assert.equal(recoveryFailureReason(new Error('synthetic-private-secret')), 'RECOVERY_FAILURE_UNCLASSIFIED');
});
