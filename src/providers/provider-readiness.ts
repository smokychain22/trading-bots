import { assertProviderConfiguration, loadEnvironment, loadEnvironmentFile } from '../config/environment.js';
import { checkAlpaca, checkOptionomics, configurationFailureResult, type CheckResult } from './readiness.js';
import { providerReadinessHasBlockingFailure } from './provider-readiness-policy.js';

const useProcessEnvironment = process.argv.includes('--process-env');
const environment = useProcessEnvironment ? loadEnvironment() : loadEnvironmentFile('.env.local');
const results: CheckResult[] = [];

try {
  assertProviderConfiguration(environment, 'ALPACA');
  results.push(...await checkAlpaca(environment));
} catch (error) {
  results.push(configurationFailureResult('ALPACA', error));
}

try {
  assertProviderConfiguration(environment, 'OPTIONOMICS');
  results.push(...await checkOptionomics(environment));
} catch (error) {
  results.push(configurationFailureResult('OPTIONOMICS', error));
}

for (const result of results) {
  console.info(JSON.stringify(result));
}

if (providerReadinessHasBlockingFailure(results)) {
  process.exitCode = 1;
}
