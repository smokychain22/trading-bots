import type { Pool } from 'pg';
import { AlpacaProviderError, fetchOptionContracts, fetchOptionSnapshots, type AlpacaProviderConfig } from './alpaca-provider.js';
import type { AlpacaOptionContractListing, AlpacaOptionSnapshot } from './option-chain-ingestion.js';
import { managementCandidateMaxQuoteAgeMs, type ManagementCandidate, type ManagementCandidateDiscovery,
  type ManagementCandidateRejection } from './management-candidate-evidence.js';
import { deterministicRuntimeUuid } from './postgres-theta-cycle-store.js';

const contractVersion = 'theta-management-candidate-discovery-v1' as const;
// A bounded Paper search universe, not a claim that longer-dated rolls are bad.
export const managementCandidateSearchHorizonDays = 90;

export interface OpenManagementCandidateSubject {
  readonly chainId: string;
  readonly underlyingId: string;
  readonly underlying: string;
  readonly lifecycleState: string;
  readonly currentContractSymbol: string | null;
  readonly currentContractId: string | null;
  readonly currentOptionType: 'PUT' | 'CALL' | null;
  readonly currentExpiration: string | null;
  readonly currentMultiplier: number | null;
  readonly optionQuantity: number | null;
  readonly stockShares: number;
}

export interface QualifiedManagementQuote {
  readonly contract: AlpacaOptionContractListing;
  readonly snapshot: AlpacaOptionSnapshot;
  readonly receivedAt: string;
}

const dateOnly = (value:string):string => value.slice(0,10);
const finitePositiveInteger = (value:number|null):value is number =>
  value!==null && Number.isSafeInteger(value) && value>0;
const occIdentity=(symbol:string):{root:string;expiration:string;optionType:'PUT'|'CALL';strike:number}|null=>{
  const matched=/^([A-Z0-9.]{1,16})\s*(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(symbol);
  if(matched===null)return null;
  const expiration=`20${matched[2]}-${matched[3]}-${matched[4]}`;
  const parsed=Date.parse(`${expiration}T00:00:00.000Z`);
  if(!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==expiration)return null;
  return {root:matched[1] as string,expiration,optionType:matched[5]==='P'?'PUT':'CALL',
    strike:Number(matched[6])/1000};
};

/** Qualifies a complete, unranked broker contract lattice. No trade selection. */
export function qualifyManagementContractLattice(input:{
  readonly subject:OpenManagementCandidateSubject;
  readonly contracts:readonly AlpacaOptionContractListing[];
  readonly snapshots:ReadonlyMap<string,AlpacaOptionSnapshot>;
  readonly receivedAt:string;
}):{readonly quotes:readonly QualifiedManagementQuote[];readonly rejections:readonly ManagementCandidateRejection[]} {
  const {subject,contracts,snapshots,receivedAt}=input;
  const at=Date.parse(receivedAt);
  const quotes:QualifiedManagementQuote[]=[];
  const rejections:ManagementCandidateRejection[]=[];
  const seen=new Set<string>();
  for(const contract of contracts){
    const reject=(reason:string):void=>{rejections.push({symbol:contract.symbol,reason});};
    if(seen.has(contract.symbol)){reject('DUPLICATE_CONTRACT_SYMBOL');continue;}
    seen.add(contract.symbol);
    if(contract.symbol===subject.currentContractSymbol){reject('SAME_AS_CURRENT_CONTRACT');continue;}
    const identity=occIdentity(contract.symbol);
    if(identity===null||identity.root!==subject.underlying||identity.expiration!==contract.expirationDate
      ||identity.optionType!==contract.optionType||identity.strike!==contract.strikePrice){
      reject('CONTRACT_IDENTITY_INVALID');continue;
    }
    if(contract.tradable!==true){reject('BROKER_TRADABILITY_NOT_CONFIRMED');continue;}
    if(!finitePositiveInteger(contract.multiplier)){reject('MULTIPLIER_MISSING_OR_INVALID');continue;}
    if(subject.currentMultiplier!==null && contract.multiplier!==subject.currentMultiplier){reject('MULTIPLIER_MISMATCH');continue;}
    if(contract.rootSymbol!==subject.underlying||contract.underlyingSymbol!==subject.underlying
      ||contract.exerciseStyle?.toLowerCase()!=='american'){
      reject('BROKER_CONTRACT_TERMS_UNVERIFIED');continue;
    }
    const deliverable=contract.deliverables;
    if(deliverable===null||deliverable===undefined||deliverable.length!==1
      ||deliverable[0]?.type.toLowerCase()!=='equity'
      ||deliverable[0].symbol!==subject.underlying
      ||deliverable[0].amount!==contract.multiplier
      ||deliverable[0].allocationPercentage!==100){
      reject('STANDARD_DELIVERABLE_UNVERIFIED');continue;
    }
    if(subject.lifecycleState==='CSP_OPEN' && (contract.optionType!=='PUT'
      || subject.currentExpiration===null || contract.expirationDate<dateOnly(subject.currentExpiration))){
      reject('ROLL_PUT_EXPIRATION_OR_TYPE_INVALID');continue;
    }
    if(subject.lifecycleState==='CC_OPEN' && (contract.optionType!=='CALL'
      || subject.currentExpiration===null || contract.expirationDate<dateOnly(subject.currentExpiration))){
      reject('ROLL_CALL_EXPIRATION_OR_TYPE_INVALID');continue;
    }
    if((subject.lifecycleState==='RECOVERY_WAIT'||subject.lifecycleState==='STOCK_HELD')
      && contract.optionType!=='CALL'){reject('COVERED_CALL_TYPE_INVALID');continue;}
    if((subject.lifecycleState==='RECOVERY_WAIT'||subject.lifecycleState==='STOCK_HELD')
      && Math.floor(subject.stockShares/contract.multiplier)<1){reject('INSUFFICIENT_COVERED_SHARES');continue;}
    const snapshot=snapshots.get(contract.symbol);
    if(snapshot===undefined){reject('QUOTE_MISSING');continue;}
    if(snapshot.bid===null||!Number.isFinite(snapshot.bid)||snapshot.bid<=0){reject('BID_MISSING_OR_INVALID');continue;}
    if(snapshot.ask===null||!Number.isFinite(snapshot.ask)||snapshot.ask<=0){reject('ASK_MISSING_OR_INVALID');continue;}
    if(snapshot.bid>snapshot.ask){reject('QUOTE_CROSSED');continue;}
    const quoteAt=snapshot.quoteTimestamp===null?NaN:Date.parse(snapshot.quoteTimestamp);
    if(!Number.isFinite(quoteAt)){reject('QUOTE_TIMESTAMP_MISSING_OR_INVALID');continue;}
    if(!Number.isFinite(at)||quoteAt>at||at-quoteAt>managementCandidateMaxQuoteAgeMs){reject('QUOTE_STALE_OR_FUTURE');continue;}
    quotes.push({contract,snapshot,receivedAt});
  }
  return {quotes,rejections};
}

function emptyDiscovery(state:ManagementCandidateDiscovery['state'],observedAt:string,reason:string|null,
  contractsComplete=false,quotesComplete=false,rejections:readonly ManagementCandidateRejection[]=[]):ManagementCandidateDiscovery{
  return {contractVersion,state,provider:'ALPACA',quoteSemantics:'PAPER_INDICATIVE_REFERENCE',observedAt,
    contractsComplete,quotesComplete,rollCandidates:[],ccCandidates:[],rollCcCandidates:[],rejections,reason};
}

export function classifyEmptyManagementLattice(rejections:readonly ManagementCandidateRejection[]):
  ManagementCandidateDiscovery['state']{
  if(rejections.length===0)return 'VALID_EMPTY';
  if(rejections.every((item)=>item.reason==='QUOTE_STALE_OR_FUTURE'))return 'STALE';
  if(rejections.some((item)=>['QUOTE_MISSING','BID_MISSING_OR_INVALID','ASK_MISSING_OR_INVALID',
    'QUOTE_TIMESTAMP_MISSING_OR_INVALID','QUOTE_STALE_OR_FUTURE'].includes(item.reason)))return 'PARTIAL_COVERAGE';
  if(rejections.some((item)=>['CONTRACT_IDENTITY_INVALID','BROKER_TRADABILITY_NOT_CONFIRMED',
    'MULTIPLIER_MISSING_OR_INVALID','MULTIPLIER_MISMATCH','QUOTE_CROSSED',
    'BROKER_CONTRACT_TERMS_UNVERIFIED','STANDARD_DELIVERABLE_UNVERIFIED'].includes(item.reason)))return 'INVALID';
  return 'VALID_EMPTY';
}

/** The only production management candidate producer. It reads Alpaca Paper
 * contracts/BBO, records exact quote lineage, and never ranks or mutates an order. */
export class ProductionPaperManagementCandidateSource {
  constructor(private readonly pool:Pool,private readonly alpaca:AlpacaProviderConfig){}

  async loadSubjects(connectionId:string,reconciliationSnapshotId:string):Promise<readonly OpenManagementCandidateSubject[]>{
    const result=await this.pool.query(`
      SELECT ec.chain_id,u.underlying_id,u.symbol AS underlying,ec.lifecycle_state,
        oc.contract_symbol AS current_contract_symbol,oc.option_contract_id AS current_contract_id,
        oc.option_type AS current_option_type,
        oc.expiration_date::text AS current_expiration,oc.multiplier AS current_multiplier,
        ol.remaining_quantity AS option_quantity,COALESCE(stocks.open_stock_shares,0) AS stock_shares
      FROM trade.economic_chain ec
      JOIN market.underlying u ON u.underlying_id=ec.underlying_id
      JOIN core.bot_instance bi ON bi.bot_instance_id=ec.bot_instance_id AND bi.bot_code='THETA'
      JOIN core.trading_account ta ON ta.account_id=bi.account_id AND ta.environment='PAPER'
      JOIN core.provider_connection pc ON pc.provider_connection_id=ta.provider_connection_id
        AND pc.provider_code='ALPACA' AND pc.environment='PAPER'
      JOIN copy.follower_account master ON master.follower_account_id=$1
        AND master.account_role='MASTER_THETA_PAPER' AND master.environment='PAPER'
        AND master.workspace_id=ta.workspace_id AND master.provider_account_ref=ta.provider_account_id
      JOIN trade.broker_reconciliation_snapshot brs ON brs.reconciliation_snapshot_id=$2
        AND brs.connection_id=master.follower_account_id
      LEFT JOIN LATERAL (
        SELECT l.option_contract_id,l.quantity-COALESCE((SELECT sum(p.closed_quantity)
          FROM trade.option_partial_close_realization p WHERE p.option_leg_id=l.option_leg_id),0) AS remaining_quantity
        FROM trade.option_leg l WHERE l.chain_id=ec.chain_id AND l.closed_at IS NULL
        ORDER BY l.opened_at DESC LIMIT 1
      ) ol ON true
      LEFT JOIN market.option_contract oc ON oc.option_contract_id=ol.option_contract_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(sum(s.shares),0) AS open_stock_shares FROM trade.stock_lot s
        WHERE s.chain_id=ec.chain_id AND s.disposed_at IS NULL
      ) stocks ON true
      WHERE ec.closed_at IS NULL ORDER BY ec.opened_at,ec.chain_id`,[connectionId,reconciliationSnapshotId]);
    return result.rows.map((row)=>({chainId:String(row.chain_id),underlyingId:String(row.underlying_id),
      underlying:String(row.underlying),lifecycleState:String(row.lifecycle_state),
      currentContractSymbol:row.current_contract_symbol==null?null:String(row.current_contract_symbol),
      currentContractId:row.current_contract_id==null?null:String(row.current_contract_id),
      currentOptionType:row.current_option_type==='PUT'?'PUT':row.current_option_type==='CALL'?'CALL':null,
      currentExpiration:row.current_expiration==null?null:dateOnly(String(row.current_expiration)),
      currentMultiplier:row.current_multiplier==null?null:Number(row.current_multiplier),
      optionQuantity:row.option_quantity==null?null:Number(row.option_quantity),
      stockShares:Number(row.stock_shares)}));
  }

  async discover(connectionId:string,reconciliationSnapshotId:string):Promise<ReadonlyMap<string,ManagementCandidateDiscovery>>{
    const subjects=await this.loadSubjects(connectionId,reconciliationSnapshotId);
    const discoveries=new Map<string,ManagementCandidateDiscovery>();
    const requestCache=new Map<string,Promise<{
      contracts:Awaited<ReturnType<typeof fetchOptionContracts>>;
      snapshots:Awaited<ReturnType<typeof fetchOptionSnapshots>>;
      receivedAt:string;
    }>>();
    for(const subject of subjects){
      const observedAt=new Date().toISOString();
      const optionType=subject.lifecycleState==='CSP_OPEN'?'put'
        :['CC_OPEN','RECOVERY_WAIT','STOCK_HELD'].includes(subject.lifecycleState)?'call':null;
      const quantity=subject.lifecycleState==='CSP_OPEN'||subject.lifecycleState==='CC_OPEN'
        ? subject.optionQuantity : null;
      if(optionType===null||(quantity!==null&&!finitePositiveInteger(quantity))
        ||(quantity===null&&subject.stockShares<=0)){
        discoveries.set(subject.chainId,emptyDiscovery('VALID_EMPTY',observedAt,'NO_APPLICABLE_MANAGEMENT_LATTICE',true,true));
        continue;
      }
      const cacheKey=`${subject.underlying}:${optionType}`;
      let request=requestCache.get(cacheKey);
      if(request===undefined){
        const today=new Date().toISOString().slice(0,10);
        const end=new Date(Date.now()+managementCandidateSearchHorizonDays*86_400_000).toISOString().slice(0,10);
        request=(async()=>{
          const contracts=await fetchOptionContracts(this.alpaca,{underlyingSymbol:subject.underlying,optionType,
            expirationDateGte:today,expirationDateLte:end,showDeliverables:true,limit:1000,maxPages:20});
          const snapshots=await fetchOptionSnapshots(this.alpaca,{underlyingSymbol:subject.underlying,feed:'indicative',
            optionType,expirationDateGte:today,expirationDateLte:end,limit:1000,maxPages:20});
          return {contracts,snapshots,receivedAt:new Date().toISOString()};
        })();
        requestCache.set(cacheKey,request);
      }
      let fetched:Awaited<typeof request>;
      try{fetched=await request;
      }catch(error){
        const state=error instanceof AlpacaProviderError&&error.errorClass==='NOT_ENTITLED'?'NOT_ENTITLED':'PROVIDER_ERROR';
        discoveries.set(subject.chainId,emptyDiscovery(state,new Date().toISOString(),
          error instanceof AlpacaProviderError?error.errorClass:'MANAGEMENT_CANDIDATE_PROVIDER_FAILED'));
        continue;
      }
      {
        const {contracts,snapshots,receivedAt}=fetched;
        if(!contracts.complete||!snapshots.complete){
          discoveries.set(subject.chainId,emptyDiscovery('PARTIAL_COVERAGE',receivedAt,
            'ALPACA_CONTRACT_OR_QUOTE_PAGINATION_INCOMPLETE',contracts.complete,snapshots.complete));
          continue;
        }
        const qualified=qualifyManagementContractLattice({subject,contracts:contracts.items,
          snapshots:snapshots.snapshots,receivedAt});
        const candidates=await this.persistQualifiedQuotes(subject,qualified.quotes,quantity,
          subject.currentContractSymbol===null?null:snapshots.snapshots.get(subject.currentContractSymbol)??null,receivedAt);
        const state=candidates.length>0?'READY':classifyEmptyManagementLattice(qualified.rejections);
        discoveries.set(subject.chainId,{contractVersion,state,provider:'ALPACA',
          quoteSemantics:'PAPER_INDICATIVE_REFERENCE',observedAt:new Date().toISOString(),
          contractsComplete:true,quotesComplete:true,
          rollCandidates:subject.lifecycleState==='CSP_OPEN'?candidates:[],
          ccCandidates:['RECOVERY_WAIT','STOCK_HELD'].includes(subject.lifecycleState)?candidates:[],
          rollCcCandidates:subject.lifecycleState==='CC_OPEN'?candidates:[],
          rejections:qualified.rejections,reason:state==='READY'||state==='VALID_EMPTY'?null:`LATTICE_${state}`});
      }
    }
    return discoveries;
  }

  private async persistQualifiedQuotes(subject:OpenManagementCandidateSubject,
    quotes:readonly QualifiedManagementQuote[],quantity:number|null,
    currentSnapshot:AlpacaOptionSnapshot|null,receivedAt:string):Promise<readonly ManagementCandidate[]>{
    if(quotes.length===0&&currentSnapshot===null)return [];
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['theta-option-quote-snapshot']);
      const contractRows=quotes.map(({contract})=>({
        id:deterministicRuntimeUuid(`option-contract:${contract.symbol}`),symbol:contract.symbol,
        underlyingId:subject.underlyingId,type:contract.optionType,strike:contract.strikePrice,
        expiration:contract.expirationDate,multiplier:contract.multiplier,
      }));
      if(contractRows.length>0){
        await client.query(`INSERT INTO market.option_contract(option_contract_id,provider_contract_id,contract_symbol,
          underlying_id,option_type,strike,expiration_date,multiplier,tradable,status)
          SELECT x.id::uuid,x.symbol,x.symbol,x.underlying_id::uuid,x.type::core.option_type,
            x.strike,x.expiration::date,x.multiplier,true,'ACTIVE'
          FROM jsonb_to_recordset($1::jsonb) AS x(id text,symbol text,underlying_id text,type text,
            strike numeric,expiration text,multiplier numeric)
          ON CONFLICT(contract_symbol) DO NOTHING`,[JSON.stringify(contractRows.map((row)=>({
            id:row.id,symbol:row.symbol,underlying_id:row.underlyingId,type:row.type,
            strike:row.strike,expiration:row.expiration,multiplier:row.multiplier,
          })))]);
      }
      const stored=contractRows.length===0?{rows:[]}:await client.query(`SELECT option_contract_id,contract_symbol,
        underlying_id,option_type,strike,expiration_date::text AS expiration_date,multiplier
        FROM market.option_contract WHERE contract_symbol=ANY($1::text[])`,[contractRows.map((row)=>row.symbol)]);
      const contractsBySymbol=new Map(stored.rows.map((row)=>[String(row.contract_symbol),row]));
      for(const contract of contractRows){
        const row=contractsBySymbol.get(contract.symbol);
        if(row===undefined||String(row.underlying_id)!==subject.underlyingId
          ||String(row.option_type)!==contract.type||Number(row.strike)!==contract.strike
          ||dateOnly(String(row.expiration_date))!==contract.expiration
          ||Number(row.multiplier)!==contract.multiplier)throw new Error('MANAGEMENT_CONTRACT_IDENTITY_CONFLICT');
      }
      if(contractRows.length>0){
        await client.query(`UPDATE market.option_contract SET tradable=true,status='ACTIVE',updated_at=$2::timestamptz
          WHERE contract_symbol=ANY($1::text[]) AND (tradable=false OR status<>'ACTIVE')`,
        [contractRows.map((row)=>row.symbol),receivedAt]);
      }
      const quoteRows=quotes.map(({contract,snapshot})=>({
        symbol:contract.symbol,id:String(contractsBySymbol.get(contract.symbol)?.option_contract_id),
        bid:snapshot.bid,ask:snapshot.ask,bidSize:snapshot.bidSize,askSize:snapshot.askSize,
        asOf:snapshot.quoteTimestamp,receivedAt,
      }));
      if(currentSnapshot!==null&&subject.currentContractId!==null&&subject.currentContractSymbol!==null){
        const quoteAt=currentSnapshot.quoteTimestamp===null?NaN:Date.parse(currentSnapshot.quoteTimestamp);
        const age=Date.parse(receivedAt)-quoteAt;
        if(currentSnapshot.bid!==null&&currentSnapshot.bid>0&&currentSnapshot.ask!==null
          &&currentSnapshot.ask>=currentSnapshot.bid&&Number.isFinite(age)
          &&age>=0&&age<=managementCandidateMaxQuoteAgeMs){
          quoteRows.push({symbol:subject.currentContractSymbol,id:subject.currentContractId,
            bid:currentSnapshot.bid,ask:currentSnapshot.ask,bidSize:currentSnapshot.bidSize,
            askSize:currentSnapshot.askSize,asOf:currentSnapshot.quoteTimestamp,receivedAt});
        }
      }
      const quoteInput=JSON.stringify(quoteRows.map((row)=>({symbol:row.symbol,id:row.id,bid:row.bid,
        ask:row.ask,bid_size:row.bidSize,ask_size:row.askSize,as_of:row.asOf,received_at:row.receivedAt})));
      if(quoteRows.length>0){
        await client.query(`INSERT INTO market.option_quote_snapshot(option_contract_id,bid,ask,bid_size,ask_size,
          as_of,retrieved_at,feed,quality)
          SELECT x.id::uuid,x.bid,x.ask,x.bid_size,x.ask_size,x.as_of::timestamptz,
            x.received_at::timestamptz,'INDICATIVE','GOOD'::core.data_quality
          FROM jsonb_to_recordset($1::jsonb) AS x(symbol text,id text,bid numeric,ask numeric,
            bid_size numeric,ask_size numeric,as_of text,received_at text)
          WHERE NOT EXISTS(SELECT 1 FROM market.option_quote_snapshot q
            WHERE q.option_contract_id=x.id::uuid AND q.as_of=x.as_of::timestamptz AND q.feed='INDICATIVE'
              AND q.bid IS NOT DISTINCT FROM x.bid AND q.ask IS NOT DISTINCT FROM x.ask
              AND q.bid_size IS NOT DISTINCT FROM x.bid_size AND q.ask_size IS NOT DISTINCT FROM x.ask_size)`,[quoteInput]);
      }
      const persistedQuotes=quoteRows.length===0?{rows:[]}:await client.query(`SELECT DISTINCT ON (x.symbol)
        x.symbol,q.snapshot_id FROM jsonb_to_recordset($1::jsonb) AS x(symbol text,id text,bid numeric,
          ask numeric,bid_size numeric,ask_size numeric,as_of text,received_at text)
        JOIN market.option_quote_snapshot q ON q.option_contract_id=x.id::uuid
          AND q.as_of=x.as_of::timestamptz AND q.feed='INDICATIVE'
          AND q.bid IS NOT DISTINCT FROM x.bid AND q.ask IS NOT DISTINCT FROM x.ask
          AND q.bid_size IS NOT DISTINCT FROM x.bid_size AND q.ask_size IS NOT DISTINCT FROM x.ask_size
        ORDER BY x.symbol,q.retrieved_at DESC,q.snapshot_id DESC`,[quoteInput]);
      const quoteIdsBySymbol=new Map(persistedQuotes.rows.map((row)=>[String(row.symbol),Number(row.snapshot_id)]));
      if(quoteIdsBySymbol.size!==quoteRows.length)throw new Error('MANAGEMENT_QUOTE_PERSISTENCE_INCOMPLETE');
      const candidates:ManagementCandidate[]=quotes.map(({contract,snapshot})=>{
        const contractId=contractsBySymbol.get(contract.symbol)?.option_contract_id;
        const quoteSnapshotId=quoteIdsBySymbol.get(contract.symbol);
        const candidateQuantity=quantity??Math.floor(subject.stockShares/(contract.multiplier as number));
        if(contractId===undefined||quoteSnapshotId===undefined||!finitePositiveInteger(candidateQuantity))
          throw new Error('MANAGEMENT_CANDIDATE_PERSISTENCE_INCOMPLETE');
        return {optionContractId:String(contractId),symbol:contract.symbol,optionType:contract.optionType,
          strike:contract.strikePrice,expiration:contract.expirationDate,multiplier:contract.multiplier as number,
          quantity:candidateQuantity,bid:snapshot.bid,ask:snapshot.ask,quoteSnapshotId,
          quoteTimestamp:snapshot.quoteTimestamp as string,quoteReceivedAt:receivedAt,
          quoteFeed:'PAPER_INDICATIVE_REFERENCE',bidSize:snapshot.bidSize,askSize:snapshot.askSize,
          delta:snapshot.greeks?.delta ?? null};
      });
      await client.query('COMMIT');
      return candidates;
    }catch(error){await client.query('ROLLBACK');throw error;
    }finally{client.release();}
  }
}
