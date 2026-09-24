import process from 'node:process';
import { premarketSessionSimulatorVersion, runSessionSimulation,
  sessionSimulationCases } from '../src/operations/premarket-session-simulator.js';

const result = runSessionSimulation();
process.stdout.write(`${JSON.stringify({
  contractVersion: premarketSessionSimulatorVersion,
  ...result,
  cases: sessionSimulationCases.map((scenario) => scenario.caseId),
  brokerMutations: 0,
  orderSubmissions: 0,
})}\n`);
if (result.failures.length > 0) process.exitCode = 1;
