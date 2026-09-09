import { assertRuntimeConfiguration, loadEnvironment } from './environment.js';

const environment = loadEnvironment();
assertRuntimeConfiguration(environment);
console.info('Provider configuration is complete. Secret values were not inspected or logged.');
