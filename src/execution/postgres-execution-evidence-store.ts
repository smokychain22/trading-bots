import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { AdaptiveLimitDecision } from './adaptive-limit-policy.js';
import type { ExecutionOptionQuote } from './execution-option-quote.js';
import type { TransactionCostAnalysis } from './transaction-cost-analysis.js';

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export interface ExecutionPriceEventInput {
  readonly orderIntentId: string;
  readonly eventType: 'DECISION'|'ARRIVAL'|'INITIAL_LIMIT'|'REPLACEMENT'|'PARTIAL_FILL'|'FILL'|'CANCEL';
  readonly eventTime: string;
  readonly quote: ExecutionOptionQuote;
  readonly quoteAgeMs: number | null;
  readonly pricing: AdaptiveLimitDecision | null;
  readonly fillPrice: number | null;
  readonly filledQuantity: number | null;
  readonly attemptNo: number | null;
  readonly reasonCode: string;
}

export class PostgresExecutionEvidenceStore {
  constructor(private readonly pool: Pool) {}

  async recordPriceEvent(input: ExecutionPriceEventInput): Promise<string> {
    const contentHash = digest(input);
    await this.pool.query(
      `INSERT INTO trade.execution_price_event(
        order_intent_id,event_type,event_time,provider,source_semantics,provider_timestamp,received_at,
        quote_age_ms,bid,ask,bid_size,ask_size,mid,spread,microprice,limit_price,fill_price,filled_quantity,
        policy_version,attempt_no,reason_code,content_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT(content_hash) DO NOTHING`,
      [input.orderIntentId,input.eventType,input.eventTime,input.quote.provider,input.quote.sourceSemantics,
        input.quote.providerTimestamp,input.quote.receivedAtUtc,input.quoteAgeMs,input.quote.bid,input.quote.ask,
        input.quote.bidSize,input.quote.askSize,input.pricing?.mid??null,input.pricing?.spread??null,
        input.pricing?.microprice??null,input.pricing?.limitPrice??null,input.fillPrice,input.filledQuantity,
        input.pricing?.policyVersion??null,input.attemptNo,input.reasonCode,contentHash],
    );
    return contentHash;
  }

  async recordTca(orderIntentId: string, calculatedAt: string, tca: TransactionCostAnalysis): Promise<string> {
    const contentHash = digest({ orderIntentId, calculatedAt, tca });
    await this.pool.query(
      `INSERT INTO trade.transaction_cost_analysis(
        order_intent_id,contract_version,calculated_at,decision_mid,arrival_mid,fill_price,
        spread_at_decision,spread_at_arrival,spread_at_fill,limit_attempts,latency_ms,
        slippage_dollars,slippage_bps,spread_capture,fees,estimated_market_impact,post_fill_move_json,
        quote_provider,quote_semantics,provider_timestamp,received_at,quote_age_ms,unknown_reasons_json,content_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,$21,$22,$23,$24::jsonb,$25)
       ON CONFLICT(content_hash) DO NOTHING`,
      [orderIntentId,tca.contractVersion,calculatedAt,tca.decisionMid,tca.arrivalMid,tca.fillPrice,
        tca.spreadAtDecision,tca.spreadAtArrival,tca.spreadAtFill,tca.limitAttempts,tca.latencyMs,
        tca.slippageDollars,tca.slippageBps,tca.spreadCapture,tca.fees,tca.estimatedMarketImpact,
        JSON.stringify(tca.postFillMove),tca.quoteProvider,tca.quoteSemantics,tca.providerTimestamp,
        tca.receivedAt,tca.quoteAgeMs,JSON.stringify(tca.unknownReasons),contentHash],
    );
    return contentHash;
  }
}
