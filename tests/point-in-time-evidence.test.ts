import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { assertNoFutureLabels,buildDatasetExport,candidateEvidenceHash,type CandidatePointInTimeEvidence } from '../src/research/point-in-time-evidence.js';

const candidate=():CandidatePointInTimeEvidence => ({candidateId:randomUUID(),decisionId:null,fusionSnapshotId:randomUUID(),
  decisionTime:'2026-09-12T14:30:00Z',branch:'THETA_CONVENTIONAL',rankAtDecision:1,selected:false,
  hardStatus:'DATA_INSUFFICIENT',softStatus:'REJECTED',rejectionReason:'EV_UNKNOWN',contract:{symbol:'SPY261009P00500000'},
  market:{bid:2.5,ask:2.6},volatility:{iv:null},technical:{trend:null},event:{state:null},flow:{uoa:null},
  ownership:{state:null},account:{buyingPower:100000},portfolio:{},aegis:{state:'HOLD_ONLY'},execution:{fillAssumed:false},
  knownEconomics:{collateral:50000},unknownEconomics:['EV'],hardBlockers:[],softEvidence:[],providerProvenance:[{
    source:'ALPACA',operationAlias:'option_snapshot',providerTimestamp:'2026-09-12T14:29:59Z',
    ingestionTimestamp:'2026-09-12T14:30:00Z',asOf:'2026-09-12T14:30:00Z',version:'v1',state:'GOOD'}],
  lineage:{strategyVersion:'s1',riskVersion:'r1',featureVersion:'f1',costModelVersion:'c1',regimeVersion:'g1',executionModelVersion:'e1'}});

test('candidate evidence is deterministic and rejects future labels anywhere in feature payload',()=>{
  const value=candidate();
  assert.equal(candidateEvidenceHash(value),candidateEvidenceHash(structuredClone(value)));
  assert.throws(()=>assertNoFutureLabels({nested:{whole_chain_net_pnl:42}}),/FUTURE_LABEL_IN_FEATURE_PAYLOAD/);
});

test('dataset export ordering and identity are deterministic',()=>{
  const a=candidate(), b={...candidate(),candidateId:randomUUID()};
  const base={sourceWindow:{start:'2026-09-01T00:00:00Z',end:'2026-09-12T00:00:00Z'},
    exportedAt:'2026-09-12T01:00:00Z',featureSetVersion:'f1',strategyVersions:['s1'],
    rows:{candidateSets:[],candidates:[a,b],shadowCandidates:[],managementSnapshots:[],lifecycleOutcomes:[],wholeChainOutcomes:[],executionEvidence:[]}};
  const first=buildDatasetExport(base),second=buildDatasetExport({...base,rows:{...base.rows,candidates:[b,a]}});
  assert.equal(first.datasetHash,second.datasetHash);
  assert.equal(first.rowCounts.candidates,2);
});

test('feature side cannot contain future labels even when outcome tables are separate',()=>{
  const value=candidate();
  assert.throws(()=>buildDatasetExport({sourceWindow:{start:'2026-09-01T00:00:00Z',end:'2026-09-12T00:00:00Z'},
    exportedAt:'2026-09-12T01:00:00Z',featureSetVersion:'f1',strategyVersions:['s1'],rows:{candidateSets:[],
      candidates:[{...value,market:{futureOutcome:'WIN'}}],shadowCandidates:[],managementSnapshots:[],lifecycleOutcomes:[],
      wholeChainOutcomes:[],executionEvidence:[]}}),/FUTURE_LABEL_IN_FEATURE_PAYLOAD/);
});
