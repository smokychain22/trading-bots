/**
 * Compatibility surface for the research studies that originally introduced
 * broker-fact impact classification. Production owns the deterministic
 * classifier so research and runtime cannot drift into different meanings.
 */
export {
  brokerFactImpactClassifierVersion,
  historicalBrokerFactClassifierVersion,
  classifyBrokerFact,
  classifyBrokerFactBatch,
  type BrokerFactBatchSummary,
  type BrokerFactClassification,
  type BrokerFactClassificationResult,
  type BrokerFactEvidence,
} from '../execution/broker-fact-impact.js';
