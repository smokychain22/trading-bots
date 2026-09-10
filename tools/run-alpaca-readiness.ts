// One-off, local-only readiness runner. Never commit real credential output.
// Prints ONLY sanitized CheckResult objects (state/httpStatus/details/provenance) --
// checkAlpaca()/checkOptionomics() in src/providers/readiness.ts already redact
// account identifiers (masked) and never echo API keys/secrets.
import { loadEnvironmentFile } from '../src/config/environment.js';
import { checkAlpaca, checkOptionomics } from '../src/providers/readiness.js';

const environment = loadEnvironmentFile('.env.alpaca.local');

const alpacaResults = await checkAlpaca(environment);
console.log(JSON.stringify({ provider: 'ALPACA', results: alpacaResults }, null, 2));

const optionomicsResults = await checkOptionomics(environment);
console.log(JSON.stringify({ provider: 'OPTIONOMICS', results: optionomicsResults }, null, 2));
