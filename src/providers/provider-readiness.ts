import { assertProviderConfiguration, loadEnvironment } from '../config/environment.js';
import { checkAlpaca, checkOptionomics } from './readiness.js';

const environment = loadEnvironment();
const results = [];

try {
  assertProviderConfiguration(environment, 'ALPACA');
  results.push(...await checkAlpaca(environment));
} catch (error) {
  results.push({
    capability: 'alpaca.configuration',
    ok: false,
    status: null,
    observedAt: new Date().toISOString(),
    details: { configurationError: error instanceof Error ? error.message : 'UnknownError' }
  });
}

try {
  assertProviderConfiguration(environment, 'OPTIONOMICS');
  results.push(...await checkOptionomics(environment));
} catch (error) {
  results.push({
    capability: 'optionomics.configuration',
    ok: false,
    status: null,
    observedAt: new Date().toISOString(),
    details: { configurationError: error instanceof Error ? error.message : 'UnknownError' }
  });
}

for (const result of results) {
  console.info(JSON.stringify(result));
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1;
}
