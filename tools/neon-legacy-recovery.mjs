import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import pg from 'pg';

const root = resolve(process.cwd(), '.theta-local-worker', 'legacy-recovery');
const dumpDirectory = resolve(root, 'dumps');
const receiptPath = resolve(root, 'neon-source-recovery-receipt.json');
const envPath = resolve(process.argv[2] ?? '.theta-local-worker/vercel-production-fresh.env');
await mkdir(dumpDirectory, { recursive: true });

const parsed = dotenv.parse(await readFile(envPath));
const surfaces = [
  ['MAIN_POOLED', parsed.DATABASE_URL],
  ['MAIN_DIRECT', parsed.DATABASE_URL_UNPOOLED],
].filter((entry) => typeof entry[1] === 'string' && entry[1].length > 0);

if (surfaces.length === 0) throw new Error('NO_LEGACY_NEON_SOURCE_SURFACE_CONFIGURED');

const receipt = {
  schemaVersion: 'theta-neon-source-recovery-v1',
  sourceSystem: 'NEON_LEGACY',
  runtimeAuthority: false,
  attemptedAt: new Date().toISOString(),
  mutationAuthorized: false,
  attempts: [],
  dumps: [],
  recoveryState: 'SOURCE_NOT_READABLE',
};

let readableSurface;
for (const [surface, connectionString] of surfaces) {
  const result = await probeOnce(surface, connectionString);
  receipt.attempts.push(result);
  if (result.state === 'READABLE' && readableSurface === undefined) readableSurface = { surface, connectionString };
}

if (readableSurface !== undefined) {
  const source = new URL(readableSurface.connectionString);
  const databases = await listDatabases(readableSurface.connectionString);
  for (const database of databases) {
    const fileName = `${safeName(database)}.dump`;
    const hostPath = resolve(dumpDirectory, fileName);
    assertWithin(dumpDirectory, hostPath);
    await runPgDump({ source, database, fileName });
    const bytes = await readFile(hostPath);
    receipt.dumps.push({ database, fileName: basename(hostPath), byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), format: 'POSTGRES_CUSTOM',
      ownerPrivilegesIncluded: false });
  }
  receipt.recoveryState = 'IMMUTABLE_EXPORT_CREATED';
}

await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ recoveryState: receipt.recoveryState,
  sourceSurfacesAttempted: receipt.attempts.map(({ surface, state, sqlState }) => ({ surface, state, sqlState })),
  dumpsCreated: receipt.dumps.length, receiptPath: '.theta-local-worker/legacy-recovery/neon-source-recovery-receipt.json' })}\n`);

async function probeOnce(surface, connectionString) {
  let hostname = 'INVALID';
  try {
    const parsedUrl = new URL(connectionString);
    hostname = parsedUrl.hostname;
    if (!hostname.endsWith('.neon.tech')) throw new Error('SOURCE_HOST_NOT_NEON');
  } catch (error) {
    return { surface, state: 'INVALID_CONFIGURATION', hostname, failureCode: safeCode(error) };
  }
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 8_000,
    application_name: `theta-neon-recovery-${surface.toLowerCase()}` });
  try {
    await client.connect();
    const result = await client.query(`SELECT current_database() AS database,
      current_setting('server_version') AS version, pg_is_in_recovery() AS replica`);
    return { surface, state: 'READABLE', hostname, database: String(result.rows[0].database),
      postgresVersion: String(result.rows[0].version), replica: result.rows[0].replica === true };
  } catch (error) {
    return { surface, state: 'BLOCKED', hostname, sqlState: safeSqlState(error), failureCode: safeCode(error) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function listDatabases(connectionString) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 8_000,
    application_name: 'theta-neon-recovery-database-inventory' });
  await client.connect();
  try {
    const result = await client.query(`SELECT datname FROM pg_database
      WHERE datallowconn AND NOT datistemplate ORDER BY datname`);
    return result.rows.map((row) => String(row.datname));
  } finally {
    await client.end();
  }
}

async function runPgDump({ source, database, fileName }) {
  const argumentsList = ['run', '--rm',
    '-e', 'PGHOST', '-e', 'PGPORT', '-e', 'PGUSER', '-e', 'PGPASSWORD', '-e', 'PGSSLMODE', '-e', 'PGDATABASE',
    '-v', `${dumpDirectory}:/recovery`, 'postgres:18-alpine', 'pg_dump', '--format=custom', '--no-owner',
    '--no-acl', `--file=/recovery/${fileName}`];
  const env = { ...process.env, PGHOST: source.hostname, PGPORT: source.port || '5432',
    PGUSER: decodeURIComponent(source.username), PGPASSWORD: decodeURIComponent(source.password),
    PGSSLMODE: source.searchParams.get('sslmode') ?? 'require', PGDATABASE: database };
  await spawnChecked('docker', argumentsList, env);
}

function spawnChecked(command, args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { if (stderr.length < 4_000) stderr += chunk.toString(); });
    child.once('error', () => reject(new Error('PG_DUMP_PROCESS_START_FAILED')));
    child.once('exit', (code) => code === 0 ? resolvePromise() : reject(Object.assign(new Error('PG_DUMP_FAILED'),
      { cause: stderr.replaceAll(/postgres(?:ql)?:\/\/\S+/gi, '[REDACTED_DATABASE_URL]').slice(0, 500) })));
  });
}

function safeName(value) {
  const safe = value.replaceAll(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  if (safe.length === 0) throw new Error('UNSAFE_DATABASE_NAME');
  return safe;
}

function assertWithin(parent, child) {
  const prefix = `${resolve(parent).toLowerCase()}\\`;
  if (!resolve(child).toLowerCase().startsWith(prefix)) throw new Error('RECOVERY_PATH_OUTSIDE_BOUNDARY');
}

function safeSqlState(error) {
  return typeof error === 'object' && error !== null && 'code' in error && /^[0-9A-Z]{5}$/.test(String(error.code))
    ? String(error.code) : 'UNKNOWN';
}

function safeCode(error) {
  const message = error instanceof Error ? error.message : 'UNKNOWN';
  if (/quota|limit|resource/i.test(message)) return 'RESOURCE_QUOTA';
  if (/password authentication|unauthorized|authentication/i.test(message)) return 'AUTHENTICATION_FAILED';
  if (/timeout|timed out/i.test(message)) return 'TIMEOUT';
  if (/SOURCE_HOST_NOT_NEON/.test(message)) return 'SOURCE_HOST_NOT_NEON';
  return 'SOURCE_UNAVAILABLE';
}
