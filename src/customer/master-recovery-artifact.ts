import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { recoveryPermitSchema } from './master-credential-recovery.js';

/** Offline packager, no deploy, provider, DB, environment download or key access.
 * Call only after the source is certified and deployment scope approved. The
 * permit attests an already verified protected ciphertext rollback file. */
export function prepareRecoveryArtifact(input: {
  repository: string; privateOutput: string; permit: unknown; rollbackFile: string;
}): { fileCount: number; sourceSha: string; deploymentAuthorized: false } {
  const repository = resolve(input.repository), output = resolve(input.privateOutput);
  if (output === repository || output.startsWith(repository + sep) || existsSync(output))
    throw new Error('RECOVERY_OUTPUT_MUST_BE_NEW_PRIVATE_DIRECTORY_OUTSIDE_REPOSITORY');
  const permit = recoveryPermitSchema.parse(input.permit);
  const rollbackBytes = readFileSync(input.rollbackFile);
  if (createHash('sha256').update(rollbackBytes).digest('hex') !== permit.rollbackFileHash)
    throw new Error('RECOVERY_ROLLBACK_FILE_HASH_MISMATCH');
  const rollback = JSON.parse(rollbackBytes.toString('utf8'));
  // No replacement credential or encryption key belongs in the artifact.
  const encryptedHash = createHash('sha256').update(Buffer.from(rollback.iv, 'base64'))
    .update(Buffer.from(rollback.auth_tag, 'base64')).update(Buffer.from(rollback.ciphertext, 'base64')).digest('hex');
  if (rollback.encryptedBundleHash !== encryptedHash || encryptedHash !== permit.previousCiphertextHash
    || createHash('sha256').update(rollback.provider_account_ref).digest('hex') !== permit.accountHash)
    throw new Error('RECOVERY_ROLLBACK_CIPHERTEXT_HASH_MISMATCH');
  const files = new Map<string, string>();
  const visit = (relative: string) => {
    if (files.has(relative)) return;
    const full = resolve(repository, relative);
    if (!full.startsWith(join(repository, 'dist') + sep)) throw new Error('RECOVERY_IMPORT_ESCAPES_DIST');
    const source = readFileSync(full, 'utf8'); files.set(relative, source);
    for (const match of source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)) {
      const dependency = match[1];
      if (dependency?.startsWith('.')) visit(resolve(dirname(full), dependency).slice(repository.length + 1));
    }
  };
  visit('dist/customer/master-recovery-handler.js');
  mkdirSync(join(output, 'api'), { recursive: true });
  mkdirSync(join(output, 'public'), { recursive: true });
  for (const [path, source] of files) {
    mkdirSync(dirname(join(output, path)), { recursive: true }); writeFileSync(join(output, path), source);
  }
  const packageJson = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'));
  writeFileSync(join(output, 'package.json'), JSON.stringify({ ...packageJson, scripts: {} }, null, 2));
  writeFileSync(join(output, 'package-lock.json'), readFileSync(join(repository, 'package-lock.json')));
  writeFileSync(join(output, 'recovery-permit.json'), JSON.stringify(permit));
  writeFileSync(join(output, 'api/recover-master.js'),
    `import {readFileSync} from 'node:fs';\nimport {createMasterRecoveryHandler} from '../dist/customer/master-recovery-handler.js';\n`
    + `const permit=JSON.parse(readFileSync(new URL('../recovery-permit.json',import.meta.url),'utf8'));\n`
    + `export default createMasterRecoveryHandler(permit,process.env);\n`);
  writeFileSync(join(output, 'vercel.json'), JSON.stringify({ version: 2, framework: null,
    buildCommand: '', installCommand: 'npm ci --omit=dev', outputDirectory: 'public',
    functions: { 'api/recover-master.js': { maxDuration: 120, includeFiles: '{dist/**,recovery-permit.json}' } } }, null, 2));
  return { fileCount: files.size + 5, sourceSha: permit.sourceSha, deploymentAuthorized: false };
}
