import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalJson,
  componentsFromEvidence,
  knownField,
  unknownField,
  wholeChainComponentEvidenceVersion,
  wholeChainEvidenceHash,
  type WholeChainComponentEvidence,
} from '../src/theta/whole-chain-component-evidence.js';

const asOf = '2026-09-18T15:00:00.000Z';
const source = [{ relation:'test.fact', columns:['value'], recordIds:['one'], observedAt:asOf }];

function completeEvidence(): Omit<WholeChainComponentEvidence, 'components'|'componentBlockers'|'contentHash'> {
  return {
    contractVersion:wholeChainComponentEvidenceVersion,
    chainId:'chain-one', asOf,
    initialPutPremium:knownField(200,asOf,source),
    putCloseCosts:knownField(0,asOf,source),
    rollCredits:knownField(0,asOf,source),
    rollCloseCosts:knownField(0,asOf,source),
    assignmentStrike:unknownField(asOf,['NO_ASSIGNMENT']),
    stockSharesAssigned:knownField(0,asOf,source),
    assignmentObservedAt:unknownField(asOf,['NO_ASSIGNMENT']),
    dividends:knownField(0,asOf,source),
    coveredCallPremium:knownField(0,asOf,source),
    coveredCallCloseCosts:knownField(0,asOf,source),
    stockSaleOrCallAwayProceeds:unknownField(asOf,['NO_STOCK_EXIT']),
    fees:knownField(0,asOf,source),
    tcaExecutionShortfall:knownField(0,asOf,source),
    currentStockMarkPerShare:unknownField(asOf,['NO_OPEN_STOCK']),
    openStockShares:knownField(0,asOf,source),
    stockLotBasisReferences:[],
  };
}

test('KNOWN_ZERO remains distinct from UNKNOWN and conversion never zero-fills unknown evidence', () => {
  const evidence = completeEvidence();
  assert.equal(evidence.rollCredits.status,'KNOWN_ZERO');
  assert.equal(evidence.assignmentStrike.status,'UNKNOWN');
  assert.ok(componentsFromEvidence(evidence).components);

  const incomplete = { ...evidence, fees:unknownField<number>(asOf,['FEE_NOT_PROVEN']) };
  const converted = componentsFromEvidence(incomplete);
  assert.equal(converted.components,null);
  assert.deepEqual(converted.blockers,['fees:UNKNOWN']);
});

test('assignment, current stock mark, and stock exit are required only for the applicable lifecycle state', () => {
  const assigned = { ...completeEvidence(), assignmentStrike:unknownField<number>(asOf,['MISSING']),
    stockSharesAssigned:knownField(100,asOf,source), openStockShares:knownField(100,asOf,source),
    currentStockMarkPerShare:unknownField<number>(asOf,['MISSING']) };
  assert.deepEqual(componentsFromEvidence(assigned).blockers,
    ['assignmentStrike:UNKNOWN','currentStockMarkPerShare:UNKNOWN']);

  const disposed = { ...assigned, assignmentStrike:knownField(50,asOf,source), openStockShares:knownField(0,asOf,source),
    stockSaleOrCallAwayProceeds:unknownField<number>(asOf,['MISSING']) };
  assert.deepEqual(componentsFromEvidence(disposed).blockers,['stockSaleOrCallAwayProceeds:UNKNOWN']);
});

test('canonical evidence serialization and hashing are restart deterministic', () => {
  const evidence = completeEvidence();
  const conversion = componentsFromEvidence(evidence);
  const value = { ...evidence, components:conversion.components, componentBlockers:conversion.blockers };
  const reordered = Object.fromEntries(Object.entries(value).reverse()) as typeof value;
  assert.equal(canonicalJson(value),canonicalJson(reordered));
  assert.equal(wholeChainEvidenceHash(value),wholeChainEvidenceHash(reordered));
});
