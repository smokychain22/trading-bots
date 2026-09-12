import assert from 'node:assert/strict';
import test from 'node:test';
import { buildResearchHandoff, hasExportableEvidence } from '../src/research/research-handoff.js';

test('research handoff is deterministic, concise, and contains no secret material',()=>{
  const artifact={schemaVersion:'theta-research-dataset-v1',datasetHash:'a'.repeat(64),
    sourceWindow:{start:'2026-09-14T14:30:00.000Z',end:'2026-09-14T20:00:00.000Z'},
    exportedAt:'2026-09-14T20:01:00.000Z',featureSetVersion:'f1',strategyVersions:['s1'],
    rowCounts:{candidateSets:1,candidates:0,shadowCandidates:0,managementSnapshots:0,lifecycleOutcomes:0,
      wholeChainOutcomes:0,executionEvidence:0},rows:{candidateSets:[],candidates:[],shadowCandidates:[],
      managementSnapshots:[],lifecycleOutcomes:[],wholeChainOutcomes:[],executionEvidence:[]}} as const;
  const handoff=buildResearchHandoff({artifact,exportPath:'x/dataset.json',manifestPath:'x/manifest.json'});
  assert.equal(handoff.datasetHash,'a'.repeat(64));
  assert.equal(handoff.sourceClass,'REAL_POINT_IN_TIME_SHADOW');
  assert.doesNotMatch(JSON.stringify(handoff),/api[_-]?key|secret|authorization/i);
});

test('a complete candidate set with zero candidates remains exportable WAIT evidence',()=>{
  assert.equal(hasExportableEvidence({candidateSets:1,candidates:0}),true);
  assert.equal(hasExportableEvidence({candidateSets:0,candidates:0}),false);
});
