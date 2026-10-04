import { canonicalJson, sha256Hex } from './archive-manifest.js';

export const FINAL_CHAIN_RECEIPT_VERSION = 'theta-final-chain-receipt-v1' as const;

export type ResolutionState = 'RESOLVED' | 'NOT_APPLICABLE' | 'PROVIDER_LIMITED_UNKNOWN' | 'UNRESOLVED';

export interface FinalChainState {
  readonly chainId: string;
  readonly lifecycleTerminal: boolean;
  readonly openOptionExposure: boolean;
  readonly openStockExposure: boolean;
  readonly workingOrder: boolean;
  readonly partialFill: boolean;
  readonly unknownResultOrder: boolean;
  readonly reconciliationPending: boolean;
  readonly managementTerminal: boolean;
  readonly orders: ResolutionState;
  readonly fills: ResolutionState;
  readonly inventory: ResolutionState;
  readonly assignment: ResolutionState;
  readonly wholeChainEconomics: ResolutionState;
  readonly futureObservationLabels: ResolutionState;
}

export interface FinalChainReceipt {
  readonly version: typeof FINAL_CHAIN_RECEIPT_VERSION;
  readonly chainId: string;
  readonly finalizedAt: string;
  readonly state: FinalChainState;
  readonly archiveEligible: boolean;
  readonly blockers: readonly string[];
  readonly sourceSha: string;
  readonly policyVersion: string;
  readonly receiptHash: string;
}

const resolvedOrNotApplicable = (state: ResolutionState): boolean => state === 'RESOLVED' || state === 'NOT_APPLICABLE';

function acceptable(field: keyof Pick<FinalChainState, 'orders' | 'fills' | 'inventory' | 'assignment' | 'wholeChainEconomics' | 'futureObservationLabels'>,
  state: ResolutionState): boolean {
  // Provider limitations may censor optional future research labels. They may
  // never make broker/accounting truth terminal. Orders, fills, inventory,
  // assignment and whole-chain economics must be factually resolved or truly
  // not applicable before their hot operational rows can be retired.
  return resolvedOrNotApplicable(state)
    || (field === 'futureObservationLabels' && state === 'PROVIDER_LIMITED_UNKNOWN');
}

export function finalChainBlockers(state: FinalChainState): readonly string[] {
  const blockers: string[] = [];
  if (!state.lifecycleTerminal) blockers.push('LIFECYCLE_NOT_TERMINAL');
  if (state.openOptionExposure) blockers.push('OPEN_OPTION_EXPOSURE');
  if (state.openStockExposure) blockers.push('OPEN_STOCK_EXPOSURE');
  if (state.workingOrder) blockers.push('WORKING_ORDER');
  if (state.partialFill) blockers.push('PARTIAL_FILL');
  if (state.unknownResultOrder) blockers.push('UNKNOWN_RESULT_ORDER');
  if (state.reconciliationPending) blockers.push('RECONCILIATION_PENDING');
  if (!state.managementTerminal) blockers.push('MANAGEMENT_NOT_TERMINAL');
  for (const field of ['orders', 'fills', 'inventory', 'assignment', 'wholeChainEconomics', 'futureObservationLabels'] as const) {
    if (!acceptable(field, state[field])) blockers.push(`${field.toUpperCase()}_UNRESOLVED`);
  }
  return blockers;
}

export function buildFinalChainReceipt(input: { readonly state: FinalChainState; readonly finalizedAt: string; readonly sourceSha: string; readonly policyVersion: string }): FinalChainReceipt {
  const blockers = finalChainBlockers(input.state);
  const body = { version: FINAL_CHAIN_RECEIPT_VERSION, chainId: input.state.chainId, finalizedAt: input.finalizedAt, state: input.state, archiveEligible: blockers.length === 0, blockers, sourceSha: input.sourceSha, policyVersion: input.policyVersion } as const;
  return { ...body, receiptHash: sha256Hex(canonicalJson(body)) };
}

export function verifyFinalChainReceipt(receipt: FinalChainReceipt): readonly string[] {
  const { receiptHash, ...body } = receipt;
  const problems: string[] = [];
  if (sha256Hex(canonicalJson(body)) !== receiptHash) problems.push('FINAL_CHAIN_RECEIPT_HASH');
  const blockers = finalChainBlockers(receipt.state);
  if (blockers.join('|') !== receipt.blockers.join('|')) problems.push('FINAL_CHAIN_BLOCKERS');
  if (receipt.archiveEligible !== (blockers.length === 0)) problems.push('FINAL_CHAIN_ELIGIBILITY');
  return problems;
}
