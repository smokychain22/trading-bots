import { assertProviderConfiguration, loadEnvironment, loadEnvironmentFile } from '../config/environment.js';
import { checkAlpaca, checkOptionomics, type CheckResult } from './readiness.js';

const useProcessEnvironment = process.argv.includes('--process-env');
const environment = useProcessEnvironment ? loadEnvironment() : loadEnvironmentFile('.env.local');
const results: CheckResult[] = [];

try {
  assertProviderConfiguration(environment, 'ALPACA');
  results.push(...await checkAlpaca(environment));
} catch (error) {
  results.push({
    provider: 'ALPACA',
    capability: 'alpaca.configuration',
    operationAlias: 'alpaca.configuration',
    state: 'INVALID',
    httpStatus: null,
    observedAt: new Date().toISOString(),
    provenance: { credentialValuesLogged: false },
    details: { configurationError: error instanceof Error ? error.message : 'UnknownError' }
  });
}

try {
  assertProviderConfiguration(environment, 'OPTIONOMICS');
  results.push(...await checkOptionomics(environment));
} catch (error) {
  results.push({
    provider: 'OPTIONOMICS',
    capability: 'optionomics.configuration',
    operationAlias: 'optionomics.configuration',
    state: 'INVALID',
    httpStatus: null,
    observedAt: new Date().toISOString(),
    provenance: { credentialValuesLogged: false },
    details: { configurationError: error instanceof Error ? error.message : 'UnknownError' }
  });
}

for (const result of results) {
  console.info(JSON.stringify(result));
}

if (results.some((result) => result.state !== 'GOOD')) {
  process.exitCode = 1;
}
