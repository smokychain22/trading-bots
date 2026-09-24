import { buildProfitabilityBrainRealityReceipt } from '../src/theta/profitability-brain-reality.js';

// Source-level receipt only. Current-worker, empirical, and broker-authorization
// proof must be supplied by their authoritative runtime/evaluation systems and
// is deliberately not inferred from files or environment flags here.
process.stdout.write(`${JSON.stringify(buildProfitabilityBrainRealityReceipt(), null, 2)}\n`);
