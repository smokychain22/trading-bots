// Read-only credential-source diagnostic. Run from an explicitly selected
// environment. Never print a credential, account payload, request header or ID.
// Passing an explicit dotenv path uses THETA's canonical loader, whose file
// values intentionally override stale ambient PowerShell variables.
const environmentFileArgument = process.argv.find((argument) => argument.startsWith('--environment-file='));
if (environmentFileArgument) {
  const { loadEnvironmentFile } = await import('../src/config/environment.ts');
  const filePath = environmentFileArgument.slice('--environment-file='.length);
  const environment = loadEnvironmentFile(filePath);
  for (const name of ['ALPACA_API_KEY', 'ALPACA_SECRET_KEY', 'ALPACA_BASE_URL']) {
    if (environment[name] !== undefined) process.env[name] = String(environment[name]);
  }
}
const variables = ['ALPACA_API_KEY', 'ALPACA_SECRET_KEY', 'ALPACA_BASE_URL'];
const usable = Object.fromEntries(variables.map((name) => [name,
  typeof process.env[name] === 'string' && process.env[name].length > 0
    && process.env[name] !== '[SENSITIVE]']));
console.info(JSON.stringify({
  source: environmentFileArgument ? 'EXPLICIT_THETA_ENVIRONMENT_FILE' : 'EXPLICIT_PROCESS_ENV',
  credentialPresence: usable,
}));
if (Object.values(usable).some((value) => !value)) process.exit(2);

let base;
try { base = new URL(process.env.ALPACA_BASE_URL); }
catch { console.info(JSON.stringify({ host: 'INVALID', checks: [] })); process.exit(2); }
if (base.protocol !== 'https:' || base.hostname !== 'paper-api.alpaca.markets'
  || base.port !== '' || !['', '/'].includes(base.pathname) || base.search || base.hash) {
  console.info(JSON.stringify({ host: 'NON_PAPER_REJECTED', checks: [] }));
  process.exit(2);
}

const paths = ['/v2/account', '/v2/clock', '/v2/positions', '/v2/orders?status=all&limit=1',
  '/v2/assets?status=active&asset_class=us_equity&limit=1'];
for (const path of paths) {
  try {
    const response = await fetch(new URL(path, base), {
      method: 'GET',
      headers: {
        'APCA-API-KEY-ID': process.env.ALPACA_API_KEY,
        'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
      },
      signal: AbortSignal.timeout(15_000),
    });
    console.info(JSON.stringify({ host: base.hostname, path: path.split('?')[0], httpStatus: response.status,
      requestIdPresent: response.headers.has('x-request-id') }));
    // Consume no response body. Provider error text can include identifiers.
    await response.body?.cancel();
  } catch (error) {
    console.info(JSON.stringify({ host: base.hostname, path: path.split('?')[0], httpStatus: null,
      errorCategory: error instanceof Error ? error.name : 'UNKNOWN' }));
  }
}
