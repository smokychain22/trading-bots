import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareRecoveryArtifact, recoveryDeploymentInvocation, recoveryDeploymentHost } from '../src/customer/master-recovery-artifact.js';

test('deployment host uses the exact stdout result, never merged progress or suggested alias URLs', () => {
  const stdout = 'https://synthetic-recovery.vercel.app\n';
  const stderr = 'Production: https://synthetic-recovery.vercel.app\nTo assign: https://synthetic-other.vercel.app';
  assert.equal(recoveryDeploymentHost(stdout), 'synthetic-recovery.vercel.app');
  for (const invalid of [stdout + stderr, stderr, stdout + stdout, '',
    'http://synthetic-recovery.vercel.app', 'https://synthetic-recovery.vercel.app?token=synthetic',
    'https://synthetic-recovery.vercel.app/api/recover-master', 'https://evil.example'])
    assert.throws(() => recoveryDeploymentHost(invalid), /HOST_UNCONFIRMED/);
});

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
    // Reproduce caller config contamination: its config references a function
    // absent from the artifact. Invocation must never use that config or cwd.
    writeFileSync(join(repository, 'vercel.json'), JSON.stringify({ functions: { 'api/theta-runtime.ts': {} } }));
    const invocation = recoveryDeploymentInvocation({ repository, privateOutput, scope: 'synthetic-team', systemAliasState: 'ABSENT_VERIFIED' });
    assert.equal(invocation.cwd, privateOutput);
    assert.equal(invocation.args[invocation.args.indexOf('--local-config') + 1], join(privateOutput, 'vercel.json'));
    assert.equal(invocation.args[invocation.args.indexOf('--cwd') + 1], privateOutput);
    assert.ok(invocation.args.includes('--prod') && invocation.args.includes('--skip-domain'));
    assert.ok(!invocation.args.includes('--token') && !invocation.args.includes('--force'));
    for (const systemAliasState of ['PRESENT', 'UNKNOWN'] as const)
      assert.throws(() => recoveryDeploymentInvocation({ repository, privateOutput, scope: 'synthetic-team', systemAliasState }), /SYSTEM_ALIAS_ISOLATION_UNPROVED/);
    assert.throws(() => recoveryDeploymentInvocation({ repository, privateOutput: repository, scope: 'synthetic-team', systemAliasState: 'ABSENT_VERIFIED' }), /OUTSIDE_REPOSITORY/);
    assert.throws(() => recoveryDeploymentInvocation({ repository, privateOutput, scope: '--token', systemAliasState: 'ABSENT_VERIFIED' }), /SCOPE_INVALID/);
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
    writeFileSync(join(privateOutput, 'api/theta-runtime.ts'), 'forbidden');
    assert.throws(() => recoveryDeploymentInvocation({ repository, privateOutput, scope: 'synthetic-team', systemAliasState: 'ABSENT_VERIFIED' }), /STANDALONE_CONFIG_MISMATCH/);
    rmSync(join(privateOutput, 'api/theta-runtime.ts'));
    writeFileSync(join(privateOutput, 'vercel.json'), JSON.stringify({ ...config, alias: ['forbidden.example'] }));
    assert.throws(() => recoveryDeploymentInvocation({ repository, privateOutput, scope: 'synthetic-team', systemAliasState: 'ABSENT_VERIFIED' }), /STANDALONE_CONFIG_MISMATCH/);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
