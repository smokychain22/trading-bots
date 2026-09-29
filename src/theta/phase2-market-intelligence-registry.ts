import { thetaFeatureFamily } from './strategy-package.js';

export const phase2MarketIntelligenceRegistryVersion = 'theta-phase2-market-intelligence-registry-v1' as const;

export type PricingSuitability = 'MASTER_PAPER_EXECUTABLE_REFERENCE' | 'UNDERLYING_REFERENCE_ONLY' | 'NOT_PRICING_AUTHORITY';
export type ResearchSuitability = 'QUALIFIED' | 'QUALIFIED_WITH_LIMITS' | 'NOT_APPLICABLE';
export type CapabilityState = 'WIRED_PRODUCTION' | 'WIRED_SHADOW' | 'RESEARCH_ONLY' | 'PROVIDER_LIMITED';

export interface ProviderCapabilityAuthority {
  readonly logicalCapability: string;
  readonly provider: 'ALPACA' | 'OPTIONOMICS';
  readonly endpoint: string;
  readonly authentication: string;
  readonly entitlement: string;
  readonly feed: string;
  readonly requestSchema: string;
  readonly responseSchema: string;
  readonly timestamp: string;
  readonly retrievedAt: string;
  readonly units: string;
  readonly freshness: string;
  readonly rateLimit: string;
  readonly timeout: string;
  readonly retry: string;
  readonly fallback: string;
  readonly pricingSuitability: PricingSuitability;
  readonly researchSuitability: ResearchSuitability;
  readonly runtimeCaller: string;
  readonly persistence: string;
  readonly consumer: string;
  readonly state: CapabilityState;
}

const alpacaAuth = 'APCA-API-KEY-ID + APCA-API-SECRET-KEY from explicit THETA environment';
const optionomicsAuth = 'email + bearer token from explicit THETA environment';
const alpacaRate = 'provider-account limit, HTTP 429 is RATE_LIMITED';
const optionomicsRate = 'response headers/provider policy, HTTP 429 is RATE_LIMITED';
const noFallback = 'NONE, failure remains typed and cannot become empty market evidence';

export const providerCapabilityAuthorityMatrix: readonly ProviderCapabilityAuthority[] = Object.freeze([
  { logicalCapability:'BROKER_ACCOUNT',provider:'ALPACA',endpoint:'GET /v2/account',authentication:alpacaAuth,
    entitlement:'PAPER_ACCOUNT',feed:'BROKER_STATE',requestSchema:'no body',responseSchema:'MasterAccountSnapshot',timestamp:'receivedAt supplied by caller',retrievedAt:'receivedAt',units:'USD, levels, booleans',freshness:'cycle-bound',rateLimit:alpacaRate,timeout:'AlpacaProviderConfig.requestTimeoutMs, default 15000ms',retry:'caller-governed only',fallback:noFallback,pricingSuitability:'NOT_PRICING_AUTHORITY',researchSuitability:'QUALIFIED',runtimeCaller:'theta-shadow-cycle',persistence:'FusionSnapshot/account evidence',consumer:'reconciliation, AEGIS, sizing, assignment capacity',state:'WIRED_PRODUCTION' },
  { logicalCapability:'BROKER_POSITIONS_ORDERS',provider:'ALPACA',endpoint:'GET /v2/positions and GET /v2/orders',authentication:alpacaAuth,
    entitlement:'PAPER_ACCOUNT',feed:'BROKER_STATE',requestSchema:'orders status=open',responseSchema:'AlpacaPositionSnapshot[] + AlpacaOpenOrderSnapshot[]',timestamp:'provider timestamps where supplied',retrievedAt:'receivedAt',units:'shares, contracts, USD',freshness:'cycle-bound',rateLimit:alpacaRate,timeout:'default 15000ms per request',retry:'caller-governed only',fallback:noFallback,pricingSuitability:'NOT_PRICING_AUTHORITY',researchSuitability:'QUALIFIED',runtimeCaller:'theta-shadow-cycle',persistence:'FusionSnapshot/reconciliation evidence',consumer:'lifecycle, reconciliation, management-first routing',state:'WIRED_PRODUCTION' },
  { logicalCapability:'BROKER_ACTIVITY_AND_FILL_HISTORY',provider:'ALPACA',endpoint:'GET /v2/account/activities',authentication:alpacaAuth,
    entitlement:'PAPER_ACCOUNT',feed:'BROKER_ACTIVITY',requestSchema:'bounded activity types, ascending pagination, page size 100',responseSchema:'BrokerActivity[]',timestamp:'transaction_time or date from the provider row',retrievedAt:'caller observation time',units:'contracts/shares, USD, RFC3339',freshness:'reconciliation and future-observation window',rateLimit:alpacaRate,timeout:'AlpacaPaperBrokerAdapter bounded request timeout',retry:'no hidden retry, pagination capped at 20 pages',fallback:noFallback,pricingSuitability:'NOT_PRICING_AUTHORITY',researchSuitability:'QUALIFIED',runtimeCaller:'autonomous reconciliation + future fill observation',persistence:'broker facts, lifecycle events, Command-5A factual outcomes',consumer:'reconciliation, partial/fill timing, BROKER_ACTUAL labels',state:'WIRED_PRODUCTION' },
  { logicalCapability:'MARKET_SESSION',provider:'ALPACA',endpoint:'GET /v2/clock and GET /v2/calendar',authentication:alpacaAuth,
    entitlement:'PAPER_ACCOUNT',feed:'EXCHANGE_CALENDAR',requestSchema:'bounded date range',responseSchema:'AlpacaMarketClock + AlpacaCalendarSession[]',timestamp:'clock timestamp/calendar dates',retrievedAt:'receivedAt',units:'RFC3339 and date-only',freshness:'cycle-bound',rateLimit:alpacaRate,timeout:'default 15000ms',retry:'caller-governed only',fallback:noFallback,pricingSuitability:'NOT_PRICING_AUTHORITY',researchSuitability:'QUALIFIED',runtimeCaller:'theta-shadow-cycle + Command5A',persistence:'provider state/cycle evidence',consumer:'supported-session gate and scheduler',state:'WIRED_PRODUCTION' },
  { logicalCapability:'UNIVERSE_AND_OPTION_CONTRACTS',provider:'ALPACA',endpoint:'GET /v2/assets and GET /v2/options/contracts',authentication:alpacaAuth,
    entitlement:'PAPER_ACCOUNT_OPTIONS',feed:'BROKER_REFERENCE',requestSchema:'status/type/expiry/underlying, bounded pagination',responseSchema:'AlpacaTradableAsset[] + AlpacaOptionContractListing[]',timestamp:'retrieval time, contract expiry',retrievedAt:'caller observation time',units:'strike USD/share, multiplier shares/contract',freshness:'cycle discovery',rateLimit:alpacaRate,timeout:'default 15000ms per page',retry:'no hidden retry',fallback:noFallback,pricingSuitability:'NOT_PRICING_AUTHORITY',researchSuitability:'QUALIFIED',runtimeCaller:'theta-shadow-cycle + AlpacaExecutionQuoteSource',persistence:'normalized contract/candidate evidence',consumer:'universe, candidate construction, exact pre-submit identity',state:'WIRED_PRODUCTION' },
  { logicalCapability:'OPTION_EXECUTABLE_BBO',provider:'ALPACA',endpoint:'GET /v1beta1/options/snapshots/{underlying}',authentication:alpacaAuth,
    entitlement:'OPRA when entitled, otherwise explicitly requested INDICATIVE for isolated Paper only',feed:'OPRA_OR_INDICATIVE_EXPLICIT',requestSchema:'underlying/type/expiry/strike/feed with bounded pagination',responseSchema:'AlpacaOptionSnapshot map',timestamp:'latestQuote.t',retrievedAt:'receivedAtUtc',units:'USD/share and contracts at level',freshness:'stage-specific candidate/finalist/pre-submit policy',rateLimit:alpacaRate,timeout:'default 15000ms per page',retry:'no silent feed downgrade and no hidden retry',fallback:noFallback,pricingSuitability:'MASTER_PAPER_EXECUTABLE_REFERENCE',researchSuitability:'QUALIFIED',runtimeCaller:'theta-shadow-cycle + AlpacaExecutionQuoteSource + Command5A',persistence:'quote ledger/frontier/pre-submit receipt',consumer:'executability, AEGIS, sizing, adaptive limit',state:'WIRED_PRODUCTION' },
  { logicalCapability:'UNDERLYING_BBO_TRADE',provider:'ALPACA',endpoint:'GET /v2/stocks/{symbol}/quotes/latest and /trades/latest',authentication:alpacaAuth,
    entitlement:'IEX or explicitly requested SIP',feed:'IEX_OR_SIP_EXPLICIT',requestSchema:'symbol + feed',responseSchema:'AlpacaStockQuote or AlpacaStockTrade',timestamp:'provider t',retrievedAt:'caller observation time',units:'USD/share and shares',freshness:'cycle/observation policy',rateLimit:alpacaRate,timeout:'default 15000ms',retry:'no silent SIP to IEX downgrade',fallback:noFallback,pricingSuitability:'UNDERLYING_REFERENCE_ONLY',researchSuitability:'QUALIFIED',runtimeCaller:'theta-shadow-cycle + Command5A',persistence:'underlying evidence/contract-path archive',consumer:'moneyness, features, future outcomes',state:'WIRED_PRODUCTION' },
  { logicalCapability:'UNDERLYING_HISTORY',provider:'ALPACA',endpoint:'GET /v2/stocks/bars',authentication:alpacaAuth,
    entitlement:'IEX or SIP as explicitly configured',feed:'EXPLICIT',requestSchema:'symbols/timeframe/start/end/adjustment/feed with bounded pagination',responseSchema:'HistoricalBar[]',timestamp:'bar.t',retrievedAt:'receivedAt',units:'USD/share, shares, count',freshness:'PIT availableAt <= decisionAt',rateLimit:alpacaRate,timeout:'default 15000ms per page',retry:'no hidden retry',fallback:noFallback,pricingSuitability:'NOT_PRICING_AUTHORITY',researchSuitability:'QUALIFIED',runtimeCaller:'theta-shadow-cycle/PIT materializer',persistence:'stock-bar history and feature snapshot',consumer:'trend, momentum, RV, gap, correlation',state:'WIRED_PRODUCTION' },
  { logicalCapability:'CORPORATE_ACTIONS',provider:'ALPACA',endpoint:'GET /v1/corporate-actions',authentication:alpacaAuth,
    entitlement:'MARKET_DATA_ACCOUNT',feed:'ALPACA_CORPORATE_ACTIONS',requestSchema:'up to 20 symbols, bounded 90-day window, data_quality=all, max 10 pages',responseSchema:'CorporateActionRead',timestamp:'process/ex/declaration dates plus THETA firstObservedAt, providerKnownAt unavailable',retrievedAt:'firstObservedAt',units:'event family, symbol and dates',freshness:'bounded query window',rateLimit:alpacaRate,timeout:'10000ms physical request',retry:'no hidden retry',fallback:'positive observations persist, empty response never proves absence',pricingSuitability:'NOT_PRICING_AUTHORITY',researchSuitability:'QUALIFIED_WITH_LIMITS',runtimeCaller:'theta-shadow-cycle',persistence:'market.alpaca_corporate_action_query + first-observation ledger',consumer:'entry safety, dividend/assignment context, management',state:'PROVIDER_LIMITED' },
  { logicalCapability:'HISTORICAL_OPTION_TRADES_BARS',provider:'ALPACA',endpoint:'GET /v1beta1/options/trades and /bars capability probes',authentication:alpacaAuth,
    entitlement:'feed-specific and account-specific',feed:'OPRA_OR_INDICATIVE_EXPLICIT',requestSchema:'single contract/date window/feed, bounded probe',responseSchema:'EvidenceCapabilityResult',timestamp:'provider trade/bar timestamp when returned',retrievedAt:'probe observedAt',units:'USD/share, contracts and OHLC',freshness:'historical requested interval',rateLimit:alpacaRate,timeout:'provider-readiness bounded request timeout',retry:'no silent feed downgrade',fallback:'NOT_SUPPORTED or NOT_ENTITLED remains typed',pricingSuitability:'NOT_PRICING_AUTHORITY',researchSuitability:'QUALIFIED_WITH_LIMITS',runtimeCaller:'provider readiness and historical research admission',persistence:'core.provider_capability sanitized receipt',consumer:'research dataset feasibility only',state:'PROVIDER_LIMITED' },
  { logicalCapability:'OPTION_CHAIN_ANALYTICS',provider:'OPTIONOMICS',endpoint:'GET /api/v1/stocks/{symbol}/options',authentication:optionomicsAuth,
    entitlement:'PAID_API, capability probe required',feed:'PROVIDER_SESSION_ANALYTICS',requestSchema:'symbol + optional requested date',responseSchema:'NormalizedOptionomicsChain',timestamp:'row as_of/served date',retrievedAt:'request completion',units:'typed per field, IV DECIMAL only when qualified',freshness:'provider date and request-time policy',rateLimit:optionomicsRate,timeout:'bounded Optionomics request policy',retry:'bounded provider adapter retry only',fallback:'UNKNOWN per field, never Alpaca execution replacement',pricingSuitability:'NOT_PRICING_AUTHORITY',researchSuitability:'QUALIFIED_WITH_LIMITS',runtimeCaller:'theta-shadow-cycle',persistence:'provider receipt + normalized feature snapshot',consumer:'Greeks/OI/volume fallback and research context',state:'WIRED_SHADOW' },
  { logicalCapability:'FLOW_EXPOSURE_SURFACE_CONTEXT',provider:'OPTIONOMICS',endpoint:'GET flow/metrics/heatmap context operations',authentication:optionomicsAuth,
    entitlement:'PAID_API/MCP, capability-specific',feed:'PROVIDER_DERIVED_ANALYTICS',requestSchema:'symbol/date/window/metric',responseSchema:'NormalizedOptionomicsFlowWindow + ContextObservation',timestamp:'provider known/published/served date when present',retrievedAt:'request completion',units:'capability-specific, UNKNOWN until qualified',freshness:'family-specific',rateLimit:optionomicsRate,timeout:'bounded Optionomics request policy',retry:'bounded provider adapter retry only',fallback:noFallback,pricingSuitability:'NOT_PRICING_AUTHORITY',researchSuitability:'QUALIFIED_WITH_LIMITS',runtimeCaller:'theta-shadow-cycle/research diagnostics',persistence:'normalized context receipt/archive',consumer:'soft evidence and shadow research only',state:'RESEARCH_ONLY' },
  { logicalCapability:'EVENT_EARNINGS_CONTEXT',provider:'OPTIONOMICS',endpoint:'GET events/earnings/news context operations',authentication:optionomicsAuth,
    entitlement:'capability probe required',feed:'PROVIDER_EVENT_CONTEXT',requestSchema:'symbol + bounded date range/pagination',responseSchema:'NormalizedOptionomicsContextObservation',timestamp:'providerKnownAt/publishedAt/observedAt',retrievedAt:'request completion',units:'event identity and timestamps',freshness:'valid-through and coverage semantics',rateLimit:optionomicsRate,timeout:'bounded Optionomics request policy',retry:'bounded provider adapter retry only',fallback:'PROVIDER_LIMITED when negative assurance is absent',pricingSuitability:'NOT_PRICING_AUTHORITY',researchSuitability:'QUALIFIED_WITH_LIMITS',runtimeCaller:'theta-shadow-cycle/event normalizer',persistence:'event evidence receipt',consumer:'event policy, AEGIS context, management',state:'PROVIDER_LIMITED' },
]);

export type FeatureRole = 'HARD_SAFETY' | 'STRATEGY_APPLICABILITY' | 'ECONOMIC_OBJECTIVE' | 'UNCERTAINTY_MODIFIER' | 'INFORMATIONAL' | 'RESEARCH_ONLY';
export type FeatureProducerState = 'PRODUCTION' | 'SHADOW' | 'RESEARCH' | 'PROVIDER_LIMITED';
export interface FeatureFamilyAuthority {
  readonly family: typeof thetaFeatureFamily.options[number];
  readonly role: FeatureRole;
  readonly producerState: FeatureProducerState;
  readonly producer: string;
  readonly consumer: string;
  readonly units: string;
  readonly timestampSemantics: string;
  readonly unknownBehavior: string;
}

const f=(family:FeatureFamilyAuthority['family'],role:FeatureRole,producerState:FeatureProducerState,producer:string,consumer:string,units:string,unknownBehavior:string):FeatureFamilyAuthority=>({family,role,producerState,producer,consumer,units,timestampSemantics:'observed_at + available_at + retrieved_at, all <= decisionAt for decision use',unknownBehavior});

export const featureFamilyAuthorityMatrix: readonly FeatureFamilyAuthority[] = Object.freeze([
  f('LIQUIDITY','HARD_SAFETY','PRODUCTION','Alpaca exact BBO + execution-quality','executability, AEGIS, sizing','USD/share, ratio','required current evidence blocks execution only'),
  f('OWNERSHIP','STRATEGY_APPLICABILITY','PRODUCTION','ownership contract/account state','Q/H applicability and assignment decision','score/components','unknown applicability remains UNKNOWN'),
  f('DRAWDOWN_RECOVERY','UNCERTAINTY_MODIFIER','SHADOW','PIT price/equity path + lifecycle evidence','management and recovery research','USD and decimal fraction','does not globally block new-risk Q'),
  f('TREND','UNCERTAINTY_MODIFIER','PRODUCTION','Alpaca PIT bars/underlying features','regime and qualified soft evidence','slope/return','missing stays optional UNKNOWN'),
  f('MOMENTUM','UNCERTAINTY_MODIFIER','SHADOW','Alpaca PIT bars/underlying features','shadow evaluation','decimal return','no Production veto'),
  f('REALIZED_VOLATILITY','ECONOMIC_OBJECTIVE','SHADOW','Alpaca PIT bars','VRP and risk research','annualized decimal','no Production veto'),
  f('IV','UNCERTAINTY_MODIFIER','PRODUCTION','Alpaca snapshot or qualified Optionomics observation','AEGIS IV stress and volatility context','decimal','required only for the specific IV stress assessment, maturity stays explicit'),
  f('SKEW','UNCERTAINTY_MODIFIER','RESEARCH','qualified Optionomics chain','strategy-quality research','decimal IV difference','no Production veto'),
  f('TERM_STRUCTURE','UNCERTAINTY_MODIFIER','RESEARCH','qualified Optionomics chain','strategy-quality and management research','decimal IV difference','no Production veto'),
  f('VOLATILITY_SURFACE','RESEARCH_ONLY','RESEARCH','qualified Optionomics surface points','research export/modeling','decimal IV grid','no Production veto'),
  f('FLOW','INFORMATIONAL','RESEARCH','qualified Optionomics flow','shadow diagnostics','provider-qualified units only','no Production veto'),
  f('UNUSUAL_ACTIVITY','RESEARCH_ONLY','PROVIDER_LIMITED','Optionomics capability when entitled','research only','provider-defined','not present is provider-limited, never false'),
  f('VOLUME_OPEN_INTEREST','ECONOMIC_OBJECTIVE','PRODUCTION','Alpaca volume + qualified Optionomics OI fallback','Q lattice/liquidity diagnostics','contracts','missing remains UNKNOWN and cannot be zero'),
  f('EVENT_CONTEXT','HARD_SAFETY','PRODUCTION','normalized event/corporate-action evidence','entry safety, AEGIS, management','timestamps/distance sessions','missing required coverage fails safe with exact reason'),
  f('SECTOR','STRATEGY_APPLICABILITY','PROVIDER_LIMITED','sector metadata provider not fully qualified','AEGIS applicability audit','classification','single-name/non-applicable distinguished from missing'),
  f('CORRELATION','HARD_SAFETY','PRODUCTION','synchronized Alpaca PIT returns','AEGIS when portfolio cluster is applicable','correlation coefficient','not applicable for absent comparison set'),
  f('PORTFOLIO_EXPOSURE','HARD_SAFETY','PRODUCTION','Alpaca account/positions + account exposure','AEGIS and sizing','USD, shares, contracts, percent','required broker evidence fails safe'),
  f('FUNDAMENTAL_QUALITY','INFORMATIONAL','PROVIDER_LIMITED','no qualified canonical provider','ownership research only','provider-defined','explicit provider-limited, no Production veto'),
  f('REGIME','STRATEGY_APPLICABILITY','PRODUCTION','PIT market/volatility/liquidity state','strategy applicability router','categorical','unknown applicability stays UNKNOWN, no fabricated regime'),
  f('EXECUTION_QUALITY','HARD_SAFETY','PRODUCTION','Alpaca exact BBO + latency/freshness','finalist refresh and pre-submit handoff','USD/share, milliseconds, ratio','unqualified quote blocks that contract'),
]);

export function validatePhase2MarketIntelligenceRegistry(): readonly string[] {
  const issues:string[]=[];
  const featureNames=featureFamilyAuthorityMatrix.map((item)=>item.family);
  if(featureNames.length!==20||new Set(featureNames).size!==20)issues.push('FEATURE_FAMILY_CARDINALITY_INVALID');
  for(const family of thetaFeatureFamily.options)if(!featureNames.includes(family))issues.push(`FEATURE_FAMILY_MISSING:${family}`);
  const quoteAuthorities=providerCapabilityAuthorityMatrix.filter((item)=>item.pricingSuitability==='MASTER_PAPER_EXECUTABLE_REFERENCE');
  if(quoteAuthorities.length!==1||quoteAuthorities[0]?.provider!=='ALPACA')issues.push('EXECUTION_QUOTE_AUTHORITY_NOT_UNIQUE');
  if(providerCapabilityAuthorityMatrix.some((item)=>item.fallback.trim()===''))issues.push('PROVIDER_FALLBACK_UNCLASSIFIED');
  if(featureFamilyAuthorityMatrix.some((item)=>item.timestampSemantics.trim()===''||item.units.trim()===''))issues.push('FEATURE_SEMANTICS_INCOMPLETE');
  return issues;
}
