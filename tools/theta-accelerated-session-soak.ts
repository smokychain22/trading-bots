import { runAcceleratedSessionSoak } from '../src/operations/accelerated-session-soak.js';

const receipt = runAcceleratedSessionSoak();
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (receipt.state !== 'PASS') process.exitCode = 1;
