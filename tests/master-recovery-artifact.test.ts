import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareRecoveryArtifact } from '../src/customer/master-recovery-artifact.js';

test('private standalone artifact preserves verified ciphertext pin and has one route, no aliases, schedules or private keys', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'theta-recovery-fixture-'));
  try {
    const repository = join(temporary, 'synthetic-repository'); mkdirSync(join(repository, 'dist/customer'), { recursive: true });
    writeFileSync(join(repository, 'dist/customer/master-recovery-handler.js'), 'export const createMasterRecoveryHandler=()=>()=>{};');
    writeFileSync(join(repository, 'package.json'), JSON.stringify({ name: 'synthetic', type: 'module', scripts: { start: 'forbidden' } }));
    writeFileSync(join(repository, 'package-lock.json'), '{}');
    const encryptedHash = createHash('sha256').update(Buffer.from('synthetic-iv')).update(Buffer.from('synthetic-tag'))
      .update(Buffer.from('synthetic-ciphertext')).digest('hex');
    const rollback = JSON.stringify({ ciphertext: Buffer.from('synthetic-ciphertext').toString('base64'),
      iv: Buffer.from('synthetic-iv').toString('base64'), auth_tag: Buffer.from('synthetic-tag').toString('base64'),
      encryptedBundleHash: encryptedHash, provider_account_ref: 'synthetic-master' });
    const rollbackFile = join(temporary, 'synthetic-rollback.json'); writeFileSync(rollbackFile, rollback);
    const permit = { authorizationId: randomUUID(), sourceSha: 'a'.repeat(40),
      accountHash: createHash('sha256').update('synthetic-master').digest('hex'), previousCiphertextHash: encryptedHash,
      rollbackFileHash: createHash('sha256').update(rollback).digest('hex'),
      ownerPublicKey: generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      notBefore: 0, expiresAt: 60_000 };
    const privateOutput = join(temporary, 'private-artifact');
    const result = prepareRecoveryArtifact({ repository, privateOutput, permit, rollbackFile });
    assert.equal(result.deploymentAuthorized, false);
    const config = JSON.parse(readFileSync(join(privateOutput, 'vercel.json'), 'utf8'));
    assert.deepEqual(Object.keys(config.functions), ['api/recover-master.js']);
    for (const key of ['crons', 'alias', 'rewrites', 'env', 'build', 'routes']) assert.equal(config[key], undefined);
    assert.deepEqual(JSON.parse(readFileSync(join(privateOutput, 'package.json'), 'utf8')).scripts, {});
    const encodedPermit = readFileSync(join(privateOutput, 'recovery-permit.json'), 'utf8');
    assert.ok(!encodedPermit.includes('PRIVATE KEY') && !encodedPermit.includes('synthetic-master'));
    assert.throws(() => prepareRecoveryArtifact({ repository, privateOutput: join(repository, 'private'), permit, rollbackFile }));
    assert.throws(() => prepareRecoveryArtifact({ repository, privateOutput: join(temporary, 'wrong-hash'),
      permit: { ...permit, rollbackFileHash: 'e'.repeat(64) }, rollbackFile }));
    assert.throws(() => prepareRecoveryArtifact({ repository, privateOutput, permit, rollbackFile }));
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
