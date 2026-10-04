import { assertRuntimeConfiguration, loadEnvironment, loadEnvironmentFile } from './environment.js';

// Local operator commands use the same explicit repository-owned source as
// provider readiness. Ambient parent-shell credentials are accepted only
// when the caller deliberately requests them.
const useProcessEnvironment = process.argv.includes('--process-env');
const environment = useProcessEnvironment ? loadEnvironment() : loadEnvironmentFile('.env.local');
assertRuntimeConfiguration(environment);
console.info('Provider configuration is complete. Secret values were not inspected or logged.');
