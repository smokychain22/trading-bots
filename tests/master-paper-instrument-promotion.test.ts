import assert from 'node:assert/strict';
import test from 'node:test';
import { qualifyMasterPaperPromotion, selectBoundedMasterPaperPromotions,
  type MasterPaperPromotionEvidence } from '../src/theta/master-paper-instrument-promotion.js';

const qualified = (symbol: string, qCount: number, liquidity = 100_000_000): MasterPaperPromotionEvidence => ({
  symbol, instrumentClass: 'NON_COMPANY_FUND', officialIssuerEvidenceRef: `official:${symbol}`,
  alpacaTradable: true, optionable: true, activeChainComplete: true, quoteEnumerationComplete: true,
  standardContractCount: 100, quotedContractCount: 100, qEvidenceQualifiedCount: qCount,
  qSoftCapCompatibleCount: qCount, qHardCapCompatibleCount: qCount,
  lowestQualifiedCollateralUsd: 8_000, averageUnderlyingDollarVolumeUsd: liquidity,
  leveragedOrInverse: false, assignmentOwnershipStructurallySuitable: true,
  pendingUnsupportedCorporateAction: false, providerEvidenceObservedAt: '2026-10-04T11:41:12.937Z',
});

test('promotion requires actual Q contract geometry under the unchanged soft cap', () => {
  const result = qualifyMasterPaperPromotion({ ...qualified('HIGH', 2), qSoftCapCompatibleCount: 0 });
  assert.equal(result.qualified, false);
  assert.deepEqual(result.blockers, ['NO_Q_CONTRACT_FITS_SOFT_TICKER_CAP']);
});

test('unknown or leveraged ownership evidence fails closed', () => {
  const unknown = qualifyMasterPaperPromotion({ ...qualified('UNKNOWN', 2), leveragedOrInverse: null,
    assignmentOwnershipStructurallySuitable: null });
  assert.equal(unknown.qualified, false);
  assert.deepEqual(unknown.blockers, ['LEVERAGED_OR_INVERSE_STATUS_NOT_CLEAR', 'ASSIGNMENT_OWNERSHIP_SUITABILITY_NOT_PROVEN']);
});

test('bounded selection ranks qualified evidence and never expands beyond proven runtime capacity', () => {
  const decisions = selectBoundedMasterPaperPromotions({ existingApprovedSymbols: ['SPY'],
    candidates: [qualified('XLF', 5, 180_000_000), qualified('XLE', 11, 190_000_000),
      qualified('TLT', 34, 185_000_000), { ...qualified('LQD', 0), qSoftCapCompatibleCount: 0,
        qHardCapCompatibleCount: 0, lowestQualifiedCollateralUsd: null }],
    capacity: { maximumApprovedFullChainSymbols: 3, capacityEvidenceRef: 'runtime:three-full-chain-scans' } });
  assert.deepEqual(decisions.filter((decision) => decision.selected).map((decision) => decision.symbol), ['XLE', 'TLT']);
  assert.equal(decisions.find((decision) => decision.symbol === 'XLF')?.state, 'QUALIFIED_NOT_SELECTED_CAPACITY_BOUND');
  assert.equal(decisions.find((decision) => decision.symbol === 'LQD')?.state, 'NOT_QUALIFIED');
  assert.ok(decisions.every((decision) => decision.executionAuthorized === false));
});
