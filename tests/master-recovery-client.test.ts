import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { recoveryCurlInput } from '../src/customer/master-recovery-client.js';
import { authorizeRecovery, type RecoveryPermit } from '../src/customer/master-credential-recovery.js';

test('private curl input sends signed body and operator authentication through stdin with no redirect', () => {
  const pair = generateKeyPairSync('ed25519'), now = Date.now();
  const permit: RecoveryPermit = { authorizationId: randomUUID(), sourceSha: 'a'.repeat(40),
    accountHash: 'b'.repeat(64), previousCiphertextHash: 'c'.repeat(64), rollbackFileHash: 'd'.repeat(64),
    ownerPublicKey: pair.publicKey.export({ format: 'pem', type: 'spki' }).toString(), notBefore: now, expiresAt: now + 60_000 };
  const host = 'synthetic-recovery.vercel.app', operatorToken = 'x'.repeat(32);
  const input = recoveryCurlInput({ host, permit, operatorToken,
    ownerPrivateKey: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    credentials: { api_key_id: 'synthetic"key', secret_key: 'synthetic\\secret' } });
  const config = input.toString('utf8');
  assert.equal(config.split('\n').filter(line => line.startsWith('url =')).length, 0,
    'URL comes only from the pinned CLI argument, never a second curl config URL');
  const line = config.split('\n').find(line => line.startsWith('data-binary = ')); assert.ok(line);
  const body = JSON.parse(line.slice('data-binary = '.length));
  const signature = config.match(/X-Theta-Recovery-Signature: ([A-Za-z0-9+/=]+)/)?.[1]; assert.ok(signature);
  assert.equal(authorizeRecovery({ method: 'POST', url: `https://${host}/api/recover-master`, body,
    authorization: `Bearer ${operatorToken}`, signature }, permit,
  { vercelEnvironment: 'production', deploymentHost: host, operatorToken, now }).authorizationId, permit.authorizationId);
  assert.ok(config.includes('max-redirs = 0'));
  assert.throws(() => recoveryCurlInput({ host: 'attacker.example', permit, operatorToken,
    ownerPrivateKey: '', credentials: { api_key_id: 'synthetic', secret_key: 'synthetic' } }));
});
