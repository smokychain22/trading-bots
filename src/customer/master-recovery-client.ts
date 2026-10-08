import { sign } from 'node:crypto';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { recoverySignaturePayload, type RecoveryPermit } from './master-credential-recovery.js';

/** Sensitive in-memory material, never log or persist this buffer. Both headers
 * and replacement keys go to curl over stdin, never process arguments. Vercel
 * CLI supplies its authenticated Deployment Protection bypass automatically. */
export function recoveryCurlInput(input: {
  host: string; permit: RecoveryPermit; ownerPrivateKey: string; operatorToken: string;
  credentials: { api_key_id: string; secret_key: string };
}): Buffer {
  if (!/^[a-z0-9-]+\.vercel\.app$/.test(input.host) || input.operatorToken.length < 32
    || /[\r\n]/.test(input.operatorToken)) throw new Error('RECOVERY_CLIENT_CONFIGURATION_INVALID');
  const credential = z.object({ api_key_id: z.string().min(1).max(256).regex(/^[^\r\n]+$/),
    secret_key: z.string().min(1).max(256).regex(/^[^\r\n]+$/) }).strict().parse(input.credentials);
  const body = JSON.stringify({ authorizationId: input.permit.authorizationId, ...credential });
  const signature = sign(null, recoverySignaturePayload(input.host, input.permit, body), input.ownerPrivateKey).toString('base64');
  const quoted = (value: string) => '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
  return Buffer.from([
    'request = "POST"', 'header = "Content-Type: application/json"',
    `header = ${quoted(`Authorization: Bearer ${input.operatorToken}`)}`,
    `header = ${quoted(`X-Theta-Recovery-Signature: ${signature}`)}`,
    `data-binary = ${quoted(body)}`, 'max-redirs = 0',
  ].join('\n') + '\n');
}

/** No automatic retry. Call only after separately approved deployment and
 * unauthenticated protection test. Raw stdout/stderr are never propagated. */
export async function invokeProtectedRecovery(input: {
  vercelCliEntry: string; host: string; privateConfig: Buffer;
}): Promise<{ status: 'VERIFIED' | 'REJECTED_OR_INCOMPLETE'; brokerMutations: 0 }> {
  if (!/^[a-z0-9-]+\.vercel\.app$/.test(input.host)) throw new Error('RECOVERY_CLIENT_HOST_INVALID');
  const env = { ...process.env }; delete env.DEBUG; delete env.VERCEL_DEBUG;
  const child = spawn(process.execPath, [input.vercelCliEntry, 'curl', `https://${input.host}/api/recover-master`,
    '--', '--config', '-', '--silent', '--max-time', '120', '--proto', '=https'],
  { env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  const chunks: Buffer[] = []; let size = 0;
  child.stdout.on('data', chunk => { size += chunk.length; if (size <= 4096) chunks.push(chunk); else child.kill(); });
  const timeout = setTimeout(() => child.kill(), 130_000);
  try {
    const result = await new Promise<number | null>((resolve, reject) => {
      child.once('error', () => reject(new Error('RECOVERY_TRANSPORT_FAILED')));
      child.once('close', resolve);
      child.stdin.on('error', () => {});
      child.stdin.end(input.privateConfig);
    });
    if (result !== 0 || size > 4096) throw new Error('RECOVERY_RESULT_UNCONFIRMED_NO_RETRY');
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('RECOVERY_RESULT_UNCONFIRMED_NO_RETRY'); }
    const parsed = z.object({ status: z.enum(['VERIFIED', 'REJECTED_OR_INCOMPLETE']), brokerMutations: z.literal(0) })
      .safeParse(body);
    if (!parsed.success) throw new Error('RECOVERY_RESULT_UNCONFIRMED_NO_RETRY');
    return parsed.data;
  } finally { clearTimeout(timeout); input.privateConfig.fill(0); }
}
