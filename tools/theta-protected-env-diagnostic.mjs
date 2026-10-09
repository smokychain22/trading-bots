// Safe replacement for printing or filtering the installed worker's protected
// environment file. This emits only fixed boolean facts, never source lines,
// parsed URLs, exception messages, or values.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

export function inspectProtectedEnvironment(contents) {
  const values = parse(contents);
  let aivenUrlValid = false;
  let aivenHostAllowed = false;
  let credentialConfigured = false;
  try {
    const url = new URL(values.AIVEN_DATABASE_URL ?? '');
    aivenUrlValid = url.protocol === 'postgres:' || url.protocol === 'postgresql:';
    aivenHostAllowed = aivenUrlValid && url.hostname.endsWith('.aivencloud.com');
    credentialConfigured = aivenHostAllowed && url.username.length > 0 && url.password.length > 0;
  } catch {
    // A malformed URL is a false predicate, never a reason to echo its value.
  }
  return {
    diagnosticVersion: 'theta-protected-env-presence-v1',
    authorityAiven: values.DATABASE_RUNTIME_AUTHORITY === 'AIVEN',
    aivenUrlValid,
    aivenHostAllowed,
    credentialConfigured,
    masterDisabled: values.MASTER_PAPER_EXECUTION_ENABLED === 'false',
    followerDisabled: values.FOLLOWER_PAPER_EXECUTION_ENABLED === 'false',
    newOrdersPaused: values.PAPER_PAUSE_NEW_ORDERS === 'true',
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argument = process.argv.find((value) => value.startsWith('--environment-file='));
  if (!argument || argument.length <= '--environment-file='.length) {
    process.stdout.write('{"state":"BLOCKED","code":"ENVIRONMENT_FILE_REQUIRED"}\n');
    process.exitCode = 1;
  } else {
    try {
      const contents = readFileSync(argument.slice('--environment-file='.length));
      process.stdout.write(`${JSON.stringify({ state: 'OBSERVED', ...inspectProtectedEnvironment(contents) })}\n`);
    } catch {
      process.stdout.write('{"state":"BLOCKED","code":"ENVIRONMENT_FILE_UNREADABLE"}\n');
      process.exitCode = 1;
    }
  }
}
