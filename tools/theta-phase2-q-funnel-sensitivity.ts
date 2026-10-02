import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { selectFinalistContractsForRefresh } from '../src/theta/finalist-quote-refresh.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import {
  buildQEntryFunnel, modelAegisConcentrationState, modelAffordableContracts, modelQFinalQuantity,
  qEntryFunnelPolicyFromRuntimePolicy, qFunnelFactsFromContract, qFunnelInvariantViolations,
  type QEntryFunnelPolicy, type QEntryFunnelReceipt, type QFunnelCandidateFacts,
} from '../src/theta/q-entry-funnel.js';

/**
 * Phase 2 area Q: RESEARCH-ONLY Q strictness / capital sensitivity over an
 * archived real SPY chain. It reads a compact extract of an archived
 * CANONICAL_STRATEGY_CANDIDATE_EVIDENCE batch (see `reproduction` in the
 * output), writes DERIVED NUMBERS ONLY (no raw quotes, no account identifiers)
 * and changes no Production threshold.
 *
 * Usage: node --import tsx tools/theta-phase2-q-funnel-sensitivity.ts
 *   --input=<compact extract json> --out=docs/operations/THETA_PHASE2_Q_FUNNEL_SENSITIVITY_20261002.json
 */
interface ArchiveRow {
  readonly branch: 'THETA_CONVENTIONAL' | 'THETA_HOLD_STRIKE';
  readonly candidateId: string; readonly optionSymbol: string; readonly occSymbol: string | null; readonly strike: number;
  readonly expiration: string; readonly multiplier: number; readonly bid: number | null; readonly ask: number | null;
  readonly quoteTimestamp: string | null; readonly dte: number; readonly delta: number | null; readonly spreadPct: number | null;
  readonly openInterest: number | null; readonly volume: number | null; readonly hardBlockers: readonly string[];
  readonly unknownEvidence: readonly string[]; readonly aegisState: string | null; readonly qty: number;
  readonly binding: string; readonly underlyingMoneyness: number | null;
}
interface Extract {
  readonly cycle: { readonly fusionSnapshotId: string; readonly asOf: string; readonly accountEquity: number;
    readonly brokerBuyingPower: number };
  readonly rows: readonly ArchiveRow[];
}

const argument = (prefix: string): string | undefined =>
  process.argv.slice(2).find((item) => item.startsWith(prefix))?.slice(prefix.length);
const inputPath = argument('--input=');
const outPath = argument('--out=') ?? 'docs/operations/THETA_PHASE2_Q_FUNNEL_SENSITIVITY_20261002.json';
if (inputPath === undefined) throw new Error('--input=<compact extract json> is required');
const bytes = readFileSync(inputPath);
const extract = JSON.parse(bytes.toString('utf8')) as Extract;
const asOf = extract.cycle.asOf;
const base = qEntryFunnelPolicyFromRuntimePolicy();

// Distinct archived puts (a symbol may appear under more than one branch).
const bySymbol = new Map<string, ArchiveRow>();
for (const row of extract.rows) if (!bySymbol.has(row.optionSymbol)) bySymbol.set(row.optionSymbol, row);
const rows = [...bySymbol.values()].sort((a, b) => a.optionSymbol.localeCompare(b.optionSymbol));

function contractsFor(maxAgeSeconds: number, maxSpreadPct: number): NormalizedOptionContract[] {
  return rows.map((row) => normalizeOptionContract({
    source: 'ALPACA', underlying: 'SPY', optionSymbol: row.optionSymbol, occSymbol: row.occSymbol, optionType: 'PUT',
    strike: row.strike, expiration: row.expiration, asOfDate: asOf.slice(0, 10), multiplier: row.multiplier,
    underlyingBid: null, underlyingAsk: null,
    underlyingLast: row.underlyingMoneyness === null ? null : row.strike * (1 + row.underlyingMoneyness),
    underlyingTimestamp: null, bid: row.bid, ask: row.ask, bidSize: null, askSize: null, lastTradePrice: null,
    lastTradeSize: null, quoteTimestamp: row.quoteTimestamp, tradeTimestamp: null,
    volume: row.volume, volumeSource: row.volume === null ? null : 'ALPACA',
    openInterest: row.openInterest, openInterestSource: row.openInterest === null ? null : 'OPTIONOMICS',
    iv: null, delta: row.delta, gamma: null, theta: null, vega: null, rho: null, greeksTimestamp: row.delta === null ? null : asOf,
    greeksSource: row.delta === null ? null : 'ALPACA', feed: 'INDICATIVE', dataQuality: 'GOOD',
    maxQuoteAgeSecondsForExecutable: maxAgeSeconds, maxSpreadPctForExecutable: maxSpreadPct,
  }, asOf));
}

interface Scenario {
  readonly name: string;
  readonly group: string;
  readonly policy: QEntryFunnelPolicy;
  readonly equityMultiplier: number;
  readonly note: string;
}
const tighter = (p: QEntryFunnelPolicy): Partial<QEntryFunnelPolicy>[] => [
  { minOpenInterest: Math.ceil(p.minOpenInterest * 1.2) }, { minVolume: Math.ceil(p.minVolume * 1.2) },
  { maxSpreadPct: p.maxSpreadPct * 0.8 }, { candidateQuoteMaxAgeSeconds: p.candidateQuoteMaxAgeSeconds * 0.8 },
  { deltaBands: [[0, 0.25], [0.25, 0.45]] }, { minDte: p.minDte + 5 }, { maxDte: p.maxDte - 5 },
];
const looser = (p: QEntryFunnelPolicy): Partial<QEntryFunnelPolicy>[] => [
  { minOpenInterest: Math.floor(p.minOpenInterest * 0.8) }, { minVolume: Math.floor(p.minVolume * 0.8) },
  { maxSpreadPct: p.maxSpreadPct * 1.2 }, { candidateQuoteMaxAgeSeconds: p.candidateQuoteMaxAgeSeconds * 1.2 },
  { deltaBands: [[0, 0.25], [0.25, 0.55]] }, { minDte: p.minDte - 4 }, { maxDte: p.maxDte + 5 },
];
const parameterNames = ['OPEN_INTEREST', 'VOLUME', 'SPREAD', 'QUOTE_AGE', 'DELTA_UPPER_EDGE', 'DTE_MIN', 'DTE_MAX'];
const describe = (patch: Partial<QEntryFunnelPolicy>): string => Object.entries(patch).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(',');
const scenarios: Scenario[] = [{ name: 'BASELINE', group: 'BASELINE', policy: base, equityMultiplier: 1, note: 'frozen paper-bootstrap runtime policy' }];
const tighterPatches = tighter(base), looserPatches = looser(base);
parameterNames.forEach((name, index) => {
  scenarios.push({ name: `SLIGHTLY_TIGHTER:${name}`, group: 'SINGLE_PARAMETER', policy: { ...base, ...tighterPatches[index] }, equityMultiplier: 1, note: describe(tighterPatches[index] ?? {}) });
  scenarios.push({ name: `SLIGHTLY_LOOSER:${name}`, group: 'SINGLE_PARAMETER', policy: { ...base, ...looserPatches[index] }, equityMultiplier: 1, note: describe(looserPatches[index] ?? {}) });
});
scenarios.push({ name: 'SLIGHTLY_TIGHTER:ALL', group: 'COMBINED', policy: Object.assign({}, base, ...tighterPatches), equityMultiplier: 1, note: 'every parameter slightly tighter at once' });
scenarios.push({ name: 'SLIGHTLY_LOOSER:ALL', group: 'COMBINED', policy: Object.assign({}, base, ...looserPatches), equityMultiplier: 1, note: 'every parameter slightly looser at once' });
for (const floor of [0.02, 0.05, 0.1]) {
  scenarios.push({ name: `RESEARCH_ONLY:MIN_PREMIUM_${floor.toFixed(2)}`, group: 'PREMIUM_RESEARCH_ONLY',
    policy: { ...base, minimumPremiumPerShare: floor }, equityMultiplier: 1,
    note: 'Production Q has NO minimum-premium gate; this is a research probe, not a policy proposal' });
}
for (const multiplier of [1.25, 1.5, 2, 3, 4.7]) {
  scenarios.push({ name: `CAPITAL_SCENARIO:EQUITY_X${multiplier}`, group: 'CAPITAL_RESEARCH_ONLY', policy: base, equityMultiplier: multiplier,
    note: 'baseline strictness, equity and buying power scaled; diagnostic of the capital binding, not an account recommendation' });
}
scenarios.push({ name: 'DECOMPOSITION:LOOSER_ALL_AT_BASELINE_EQUITY', group: 'DECOMPOSITION', policy: Object.assign({}, base, ...looserPatches), equityMultiplier: 1, note: 'is relaxing every Q gate enough? (no)' });
scenarios.push({ name: 'DECOMPOSITION:BASELINE_GATES_AT_X4.7_EQUITY', group: 'DECOMPOSITION', policy: base, equityMultiplier: 4.7, note: 'is relaxing capital alone enough? (yes, if > 0)' });

function runScenario(scenario: Scenario): QEntryFunnelReceipt {
  const contracts = contractsFor(scenario.policy.candidateQuoteMaxAgeSeconds, scenario.policy.maxSpreadPct);
  const equity = extract.cycle.accountEquity * scenario.equityMultiplier;
  const buyingPower = extract.cycle.brokerBuyingPower * scenario.equityMultiplier;
  const candidates: QFunnelCandidateFacts[] = contracts.map((contract) => {
    const facts = qFunnelFactsFromContract(contract, { eventState: 'NOT_APPLICABLE', earningsDistanceSessions: null });
    const collateral = contract.strike * contract.multiplier;
    const aegisState = modelAegisConcentrationState({ collateral, equity, policy: scenario.policy });
    const affordable = modelAffordableContracts(buyingPower, collateral) ?? 0;
    const sizing = modelQFinalQuantity({ collateral, buyingPower, brokerAllowedQty: affordable, aegisState, policy: scenario.policy });
    return { ...facts, aegisState, finalQuantity: sizing.quantity, finalQuantityBinding: sizing.bindingConstraint };
  });
  return buildQEntryFunnel({
    policy: scenario.policy,
    account: { equity, buyingPower, instrumentApproval: { state: 'APPROVED', reason: null } },
    candidates,
  });
}

const percentile = (values: readonly number[], fraction: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] ?? null;
};

const results = scenarios.map((scenario) => {
  const receipt = runScenario(scenario);
  const violations = qFunnelInvariantViolations(receipt);
  if (violations.length > 0) throw new Error(`FUNNEL_INVARIANT_VIOLATION:${scenario.name}:${violations.slice(0, 3).join(',')}`);
  const stage = (id: string) => receipt.stages.find((item) => item.stageId === id);
  return {
    scenario: scenario.name, group: scenario.group, parameters: scenario.note, equityMultiplier: scenario.equityMultiplier,
    INPUT_CONTRACTS: receipt.totals.INPUT_CONTRACTS, Q_VALID: receipt.totals.Q_VALID,
    CAPITAL_FIT_BUYING_POWER: receipt.totals.CAPITAL_FIT, AEGIS_REACHED: receipt.totals.AEGIS_REACHED,
    AEGIS_PASS: receipt.totals.AEGIS_PASS, FINAL_QTY_POSITIVE: receipt.totals.FINAL_QTY_POSITIVE,
    extinctionStage: receipt.extinctionStage, dominantBlocker: receipt.dominantBlocker,
    aegisFailReasons: stage('AEGIS')?.reasonCounts ?? {}, categoryCounts: receipt.categoryCounts,
    independentGateFailures: Object.fromEntries(Object.entries(receipt.independentGates).map(([id, value]) =>
      [id, value.FAIL_COUNT + value.UNKNOWN_COUNT])),
  };
});

// Baseline exact-reason decomposition: what the production receipt called generic.
const baselineScenario = scenarios[0] as Scenario;
const baselineReceipt = runScenario(baselineScenario);
const terminalReasonCounts: Record<string, number> = {};
for (const record of baselineReceipt.candidates) {
  const key = `${record.terminalStage}:${record.terminalReasons.join('+') || 'COMPLETED'}`;
  terminalReasonCounts[key] = (terminalReasonCounts[key] ?? 0) + 1;
}

// Observed production receipt for the same cycle.
const conventionalRows = extract.rows.filter((row) => row.branch === 'THETA_CONVENTIONAL');
const observedReasons: Record<string, number> = {};
for (const row of conventionalRows) {
  const key = row.hardBlockers.length > 0 ? row.hardBlockers.join('+') : 'NONE';
  observedReasons[key] = (observedReasons[key] ?? 0) + 1;
}
const observedEvaluated = conventionalRows.filter((row) => !row.hardBlockers.includes('THETA_Q_NOT_EVALUATED_SHORTLIST_BOUND'));

// Finalist shortlist: previous ordering (delta-centre proximity only) versus the gate-aware ordering.
const baseContracts = contractsFor(base.candidateQuoteMaxAgeSeconds, base.maxSpreadPct);
const conventionalSymbols = new Set(conventionalRows.map((row) => row.optionSymbol));
const conventionalContracts = baseContracts.filter((contract) => conventionalSymbols.has(contract.optionSymbol));
const lattice = { minDte: base.minDte, maxDte: base.maxDte, deltaBands: base.deltaBands.map((band) => [...band]),
  minOpenInterest: base.minOpenInterest, minVolume: base.minVolume, maxSpreadPct: base.maxSpreadPct };
const finalistPolicy = { policyVersion: 'research', effectiveAt: '2026-09-01T00:00:00.000Z', maxFinalists: 5, maxAgeSeconds: 30 };
const centres = base.deltaBands.map(([low, high]) => (low + high) / 2);
const legacyScore = (contract: NormalizedOptionContract): readonly number[] => [
  contract.dte < base.minDte || contract.dte > base.maxDte ? 1 : 0,
  contract.delta === null ? Number.POSITIVE_INFINITY : Math.min(...centres.map((c) => Math.abs(Math.abs(contract.delta as number) - c))),
  Math.abs(contract.dte - (base.minDte + base.maxDte) / 2),
  contract.spreadPct ?? Number.POSITIVE_INFINITY, contract.dataAgeSeconds ?? Number.POSITIVE_INFINITY,
];
const legacyFinalists = baseContracts.filter((contract) => contract.occSymbol !== null && contract.multiplier === 100 && contract.bid !== null)
  .map((contract) => ({ contract, score: legacyScore(contract) }))
  .sort((l, r) => { for (let i = 0; i < l.score.length; i++) { const d = (l.score[i] as number) - (r.score[i] as number); if (d !== 0 && !Number.isNaN(d)) return d; }
    return l.contract.optionSymbol.localeCompare(r.contract.optionSymbol); })
  .slice(0, 5).map((item) => item.contract);
const patchedFinalists = selectFinalistContractsForRefresh({ contracts: baseContracts, latticeConfig: lattice, policy: finalistPolicy, asOf });
const observedEvaluatedSymbols = new Set(observedEvaluated.map((row) => row.optionSymbol));
const describeFinalists = (finalists: readonly NormalizedOptionContract[]) => {
  const receipt = buildQEntryFunnel({ policy: base,
    account: { equity: extract.cycle.accountEquity, buyingPower: extract.cycle.brokerBuyingPower, instrumentApproval: { state: 'APPROVED', reason: null } },
    candidates: finalists.map((contract) => {
      const facts = qFunnelFactsFromContract(contract, { eventState: 'NOT_APPLICABLE', earningsDistanceSessions: null });
      const collateral = contract.strike * contract.multiplier;
      const aegisState = modelAegisConcentrationState({ collateral, equity: extract.cycle.accountEquity, policy: base });
      const sizing = modelQFinalQuantity({ collateral, buyingPower: extract.cycle.brokerBuyingPower,
        brokerAllowedQty: modelAffordableContracts(extract.cycle.brokerBuyingPower, collateral) ?? 0, aegisState, policy: base });
      return { ...facts, aegisState, finalQuantity: sizing.quantity, finalQuantityBinding: sizing.bindingConstraint };
    }) });
  return { count: finalists.length, Q_VALID: receipt.totals.Q_VALID, AEGIS_REACHED: receipt.totals.AEGIS_REACHED,
    FINAL_QTY_POSITIVE: receipt.totals.FINAL_QTY_POSITIVE,
    terminal: receipt.candidates.map((record) => `${record.terminalStage}:${record.terminalReasons.join('+') || 'COMPLETED'}`).sort(),
    collateralDollars: finalists.map((contract) => contract.strike * contract.multiplier).sort((a, b) => a - b) };
};

// Capital arithmetic for the cheapest Q-valid put.
const qValidSymbols = new Set(baselineReceipt.candidates.filter((record) => record.terminalStage === 'AEGIS' || record.terminalStage === 'CAPITAL_FIT'
  || record.terminalStage === 'FINAL_QUANTITY' || record.terminalStage === 'COMPLETED' || record.terminalStage === 'ENTRY_ELIGIBILITY'
  || record.terminalStage === 'FINALIST_SHORTLIST').map((record) => record.optionSymbol));
const qValidCollateral = baseContracts.filter((contract) => qValidSymbols.has(contract.optionSymbol)).map((contract) => contract.strike * contract.multiplier);
const hardCapDollars = extract.cycle.accountEquity * base.aegisTickerSoftCapPct * base.aegisHardCapMultiplier;
const softCapDollars = extract.cycle.accountEquity * base.aegisTickerSoftCapPct;
const minQValidCollateral = qValidCollateral.length === 0 ? null : Math.min(...qValidCollateral);
const quoteAges = baseContracts.map((contract) => contract.dataAgeSeconds).filter((value): value is number => value !== null);

const baselineResult = results[0] as (typeof results)[number];
const output = {
  document: 'THETA_PHASE2_Q_FUNNEL_SENSITIVITY_20261002',
  classification: 'RESEARCH_ONLY_DERIVED_NUMBERS_NO_PRODUCTION_CHANGE',
  funnelContractVersion: baselineReceipt.contractVersion,
  source: {
    archivedCycle: extract.cycle.fusionSnapshotId.slice(0, 8), archiveFamily: 'CANONICAL_STRATEGY_CANDIDATE_EVIDENCE',
    extractSha256: createHash('sha256').update(bytes).digest('hex'),
    distinctPutsInArchive: rows.length, conventionalWindowPuts: conventionalRows.length,
    holdStrikeOnlyPuts: rows.length - conventionalRows.length,
    caveats: [
      'The archive persisted 1,263 distinct SPY puts for this cycle (961 in the 25-60 DTE Q window plus 302 DTE 4-5 hold-strike puts); the 2,619-put enumeration quoted in the 2026-10-01 audit is not reproducible from the archive and is not used here.',
      'Quote age is measured at the frontier asOf; the candidate-stage age was measured earlier, so ages here are an upper bound relative to the candidate stage.',
      'Instrument approval and event policy are not observable per row; SPY is a qualified non-company fund (event window NOT_APPLICABLE) and the account is assumed approved. Three archived candidates did reach AEGIS and were vetoed on a capital reason, which shows approval was not the stopping stage.',
      'AEGIS and quantity are modeled from the archived equity/buying power and the frozen concentration and quantity caps (parity-tested against the canonical sizing waterfall); no live AEGIS call was made.',
      'The archive holds no puts with DTE 6-28 or above 60, so DTE_MIN looser (21) and DTE_MAX looser (65) cannot add candidates here; the unchanged counts reflect archive coverage, not insensitivity.',
      'Baseline Q_VALID is one lower than the 2026-10-01 audit figure (363) because the frozen delta band is half-open: the single put with |delta| exactly 0.5 is excluded by theta_q_lattice.py (the audit counted |delta| <= 0.5).',
      'Premium and capital scenarios are diagnostics, not policy proposals; no Production threshold is changed by this document.',
    ],
    quoteAgeSecondsAtAsOf: { p50: percentile(quoteAges, 0.5), p95: percentile(quoteAges, 0.95), max: percentile(quoteAges, 1) },
    reproduction: 'Extract CANONICAL_STRATEGY_CANDIDATE_EVIDENCE rows (recordType BRANCH_CANDIDATE, branches THETA_CONVENTIONAL and THETA_HOLD_STRIKE) for the cycle from the local research parquet archive into a compact JSON, then run tools/theta-phase2-q-funnel-sensitivity.ts --input=<extract>.',
  },
  account: { equityDollars: extract.cycle.accountEquity, buyingPowerDollars: extract.cycle.brokerBuyingPower,
    tickerSoftCapDollars: Math.round(softCapDollars * 100) / 100, tickerHardVetoDollars: Math.round(hardCapDollars * 100) / 100 },
  observedProductionReceipt: {
    conventionalCandidates: conventionalRows.length,
    evaluatedByQAndAegis: observedEvaluated.length,
    receiptReasonCounts: observedReasons,
    interpretation: 'Production labeled the unevaluated candidates only NOT_EVALUATED_SHORTLIST_BOUND; the funnel below attributes the same candidates to their exact known blockers.',
  },
  baselineFunnel: {
    stages: baselineReceipt.stages.map((stage) => ({ stageId: stage.stageId, INPUT_COUNT: stage.INPUT_COUNT, PASS_COUNT: stage.PASS_COUNT,
      FAIL_COUNT: stage.FAIL_COUNT, UNKNOWN_COUNT: stage.UNKNOWN_COUNT, NOT_APPLICABLE_COUNT: stage.NOT_APPLICABLE_COUNT,
      reasonCounts: stage.reasonCounts })),
    terminalReasonCounts,
    totals: baselineReceipt.totals, extinctionStage: baselineReceipt.extinctionStage,
    dominantBlocker: baselineReceipt.dominantBlocker, contentHash: baselineReceipt.contentHash,
  },
  finalistShortlist: {
    maxFinalists: 5,
    observedProductionEvaluated: { count: observedEvaluatedSymbols.size },
    legacyOrderingReplica: { ...describeFinalists(legacyFinalists),
      overlapWithObservedProductionSet: legacyFinalists.filter((contract) => observedEvaluatedSymbols.has(contract.optionSymbol)).length,
      note: 'Replica ordered on frontier-asOf quotes/Greeks; production ordered on the earlier candidate-stage merge, so ties and near-ties can resolve differently.' },
    gateAwareOrdering: describeFinalists(patchedFinalists),
  },
  capitalArithmetic: {
    cheapestQValidPutCollateralDollars: minQValidCollateral,
    cheapestQValidPutPctOfEquity: minQValidCollateral === null ? null : Math.round((minQValidCollateral / extract.cycle.accountEquity) * 10000) / 10000,
    equityNeededForOneContractNotToBeHardVetoed: minQValidCollateral === null ? null : Math.ceil(minQValidCollateral / (base.aegisTickerSoftCapPct * base.aegisHardCapMultiplier)),
    equityNeededForFullSize: minQValidCollateral === null ? null : Math.ceil(minQValidCollateral / base.aegisTickerSoftCapPct),
  },
  variants: results,
  headline: {
    INPUT_CONTRACTS: baselineResult.INPUT_CONTRACTS, Q_VALID: baselineResult.Q_VALID, AEGIS_REACHED: baselineResult.AEGIS_REACHED,
    CAPITAL_FIT: baselineResult.CAPITAL_FIT_BUYING_POWER, FINAL_QTY_POSITIVE: baselineResult.FINAL_QTY_POSITIVE,
    DOMINANT_CURRENT_BLOCKER: baselineResult.dominantBlocker,
    DOMINANT_CURRENT_BLOCKER_EXPLANATION: 'CAPITAL via AEGIS single-underlying concentration: every Q-valid put needs more collateral than 22.5% of account equity (hard-veto threshold); relaxing every Q strictness gate together leaves qty-positive at 0, while scaling equity alone produces qty-positive candidates.',
  },
};
writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(output.headline)}\n`);
