import { createHash } from 'node:crypto';
import type { BrokerOrderRequest } from './broker.js';
import { multiLegPackageIdentity } from './broker.js';
import type { DurableMultiLegOrderEvidence, PaperOrderGate, PrepareIntentInput } from './paper-order-coordinator.js';
import type { DefinedRiskManagementDecision } from './defined-risk-management.js';
import { economicIdentitySeed, generateClientOrderId } from '../theta/order-intent-state.js';

export const definedRiskCloseCommandVersion = 'theta-defined-risk-close-command-v1' as const;

export interface DefinedRiskCloseQuote { readonly symbol: string; readonly bid: number; readonly ask: number; readonly observedAt: string }

export interface BuildDefinedRiskCloseCommandInput {
  /** the OPEN parent: its durable legs are the only source of contract identity (never re-derived from a symbol string) */
  readonly openIntentId: string;
  readonly openEvidence: DurableMultiLegOrderEvidence;
  readonly chainId: string;
  readonly underlyingId: string;
  readonly executionAccountId: string;
  /** trade.decision id recorded for this management decision */
  readonly decisionId: string;
  readonly decision: DefinedRiskManagementDecision;
  readonly shortQuote: DefinedRiskCloseQuote;
  readonly longQuote: DefinedRiskCloseQuote;
  readonly quoteFeed: 'OPRA' | 'INDICATIVE';
  readonly now: string;
  readonly decisionExpiresAt: string;
  readonly maximumQuoteAgeSeconds: number;
  /** 1 for the first close; incremented only after a previous close order is terminal WITHOUT a fill (never to retry an ambiguous submit) */
  readonly attempt: number;
  readonly aegisState: 'ALLOW_FULL' | 'ALLOW_REDUCED' | 'HOLD_ONLY' | 'HARD_VETO' | 'EMERGENCY_EXIT_ONLY' | null;
}

export interface DefinedRiskCloseCommand extends PrepareIntentInput {
  readonly action: 'CLOSE_DEFINED_RISK';
  readonly gate: PaperOrderGate;
}

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const deterministicUuid = (value: string): string => {
  const bytes = Buffer.from(hash(value).slice(0, 32), 'hex');
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/**
 * ONE native closing package: buy_to_close the short leg and sell_to_close the long leg, each leg identity copied from the durable opening parent. Both exact legs must have a
 * fresh, uncrossed quote at command creation; the debit limit is marketable (short ask - long bid, rounded UP to the cent), and can never exceed the spread width.
 * Closing reduces risk, so it is not a new entry, but it is still persisted before submission and submitted only by PaperOrderCoordinator.
 */
export function buildDefinedRiskCloseCommand(input: BuildDefinedRiskCloseCommandInput): DefinedRiskCloseCommand {
  if (input.quoteFeed !== 'OPRA' && input.quoteFeed !== 'INDICATIVE') throw new Error('DEFINED_RISK_CLOSE_QUOTE_PROVENANCE_UNKNOWN');
  if (input.decision.action !== 'CLOSE_FULL' || input.decision.orderIntentId !== input.openIntentId || input.decision.chainId !== input.chainId) throw new Error('DEFINED_RISK_CLOSE_REQUIRES_MATCHING_CLOSE_DECISION');
  if (!input.decision.quotesExecutable) throw new Error('DEFINED_RISK_CLOSE_QUOTES_NOT_EXECUTABLE');
  if (!Number.isSafeInteger(input.decision.closeQuantity) || input.decision.closeQuantity <= 0) throw new Error('DEFINED_RISK_CLOSE_QUANTITY_INVALID');
  const [shortOpen, longOpen] = input.openEvidence.legs;
  if (input.openEvidence.legs.length !== 2 || shortOpen === undefined || longOpen === undefined || shortOpen.positionIntent !== 'sell_to_open' || longOpen.positionIntent !== 'buy_to_open'
    || shortOpen.expiration !== longOpen.expiration || shortOpen.multiplier !== longOpen.multiplier || shortOpen.strike <= longOpen.strike) throw new Error('DEFINED_RISK_CLOSE_STRUCTURE_INVALID');
  if (input.shortQuote.symbol !== shortOpen.occSymbol || input.longQuote.symbol !== longOpen.occSymbol) throw new Error('DEFINED_RISK_CLOSE_QUOTE_IDENTITY_MISMATCH');
  const nowMs = Date.parse(input.now), expiryMs = Date.parse(input.decisionExpiresAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiryMs) || expiryMs <= nowMs) throw new Error('DEFINED_RISK_CLOSE_DECISION_EXPIRED');
  for (const quote of [input.shortQuote, input.longQuote]) {
    const age = (nowMs - Date.parse(quote.observedAt)) / 1000;
    if (!Number.isFinite(age) || age < 0 || age > input.maximumQuoteAgeSeconds || quote.bid < 0 || quote.ask <= 0 || quote.ask < quote.bid) throw new Error('DEFINED_RISK_CLOSE_QUOTE_NOT_EXECUTABLE');
  }
  const width = shortOpen.strike - longOpen.strike;
  const marketableDebit = Math.ceil(Math.max(0.01, input.shortQuote.ask - input.longQuote.bid) * 100 - 1e-9) / 100;
  const limitDebit = Number(Math.min(marketableDebit, width).toFixed(2));
  if (!(limitDebit > 0)) throw new Error('DEFINED_RISK_CLOSE_LIMIT_INVALID');
  const legs = [
    { symbol: shortOpen.occSymbol, side: 'buy' as const, ratio_qty: 1, position_intent: 'buy_to_close' as const },
    { symbol: longOpen.occSymbol, side: 'sell' as const, ratio_qty: 1, position_intent: 'sell_to_close' as const },
  ] as const;
  const packageIdentity = multiLegPackageIdentity(legs);
  const identitySeed = economicIdentitySeed({ candidateId: input.openIntentId, strategyVersion: definedRiskCloseCommandVersion, action: 'CLOSE_DEFINED_RISK', chainId: input.chainId });
  const clientOrderId = generateClientOrderId(input.decisionId, identitySeed, input.attempt);
  const quantity = input.decision.closeQuantity;
  // Alpaca signs the parent price from the account's perspective: a debit is POSITIVE.
  const request: BrokerOrderRequest = { symbol: packageIdentity, side: 'buy', qty: quantity, type: 'limit', time_in_force: 'day', limit_price: limitDebit.toFixed(2), client_order_id: clientOrderId, order_class: 'mleg', legs };
  const orderIntentId = deterministicUuid(JSON.stringify(['theta-defined-risk-close-intent-v1', input.executionAccountId, input.openIntentId, input.attempt]));
  // AEGIS gates NEW risk only; a close must never be blocked or relabelled by it, but the recorded state must be the real one (unknown / exit-only never becomes ALLOW_FULL)
  const aegisState: 'ALLOW_FULL' | 'ALLOW_REDUCED' | 'HOLD_ONLY' | 'HARD_VETO' = input.aegisState === 'ALLOW_FULL' || input.aegisState === 'ALLOW_REDUCED' || input.aegisState === 'HOLD_ONLY'
    ? input.aegisState : input.aegisState === 'HARD_VETO' || input.aegisState === 'EMERGENCY_EXIT_ONLY' ? 'HARD_VETO' : 'HOLD_ONLY';
  return {
    orderIntentId, executionAccountId: input.executionAccountId, request, action: 'CLOSE_DEFINED_RISK', decisionId: input.decisionId, persistedAt: input.now,
    chainId: input.chainId, optionContractId: null, underlyingId: input.underlyingId,
    multiLegEvidence: { orderClass: 'mleg', creditDebitDirection: 'DEBIT', packageIdentity, legs: [
      { ...shortOpen, positionIntent: 'buy_to_close' as const }, { ...longOpen, positionIntent: 'sell_to_close' as const }] },
    executionEvidence: { quoteSource: 'ALPACA', quoteFeed: input.quoteFeed,
      quoteSemantics: input.quoteFeed === 'INDICATIVE' ? 'PAPER_INDICATIVE_REFERENCE' : 'CONSOLIDATED_NBBO',
      quoteAsOf: new Date(Math.max(Date.parse(input.shortQuote.observedAt), Date.parse(input.longQuote.observedAt))).toISOString(),
      decisionExpiresAt: input.decisionExpiresAt, quoteContentHash: hash([input.shortQuote, input.longQuote]), aegisState },
    // a close is sized by the position, not by AEGIS/risk sizing: canonical == evidence == the exact open quantity (never rounded up, never "at least 1")
    authorizationEvidence: { executionTier: 'PAPER_EVIDENCE', canonicalQuantity: quantity, paperEvidenceQuantity: quantity, empiricalEconomicsReady: false, expectedAfterCostEv: null },
    gate: { baseHostname: 'paper-api.alpaca.markets', accountVerified: true, optionsCapabilityVerified: true, aegisState, quoteFresh: true,
      priceEvidence: 'QUALIFIED_OPTION_BBO', decisionExpiresAt: input.decisionExpiresAt, now: input.now, isNewEntry: false },
  } as DefinedRiskCloseCommand;
}
