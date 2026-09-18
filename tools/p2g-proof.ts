import pg from 'pg';
import {loadEnvironment} from '../src/config/environment.js';
import {buildPaperOrderPreview} from '../src/execution/paper-order-preview.js';
import {persistPaperOrderPreview,persistSyntheticLifecycleReceipt} from '../src/research/p2g-receipt-store.js';
import {canonicalFullChainScenario,simulateLifecycle} from '../src/theta/p2g-lifecycle-simulator.js';
const environment=loadEnvironment();
const databaseUrl=environment.DATABASE_MIGRATION_URL??environment.DATABASE_URL;
if(!databaseUrl)throw new Error('DATABASE_CONNECTION_NOT_CONFIGURED');
const asOf=new Date().toISOString();const lifecycle=simulateLifecycle(canonicalFullChainScenario());
const preview=buildPaperOrderPreview({previewId:`p2g-${asOf}`,asOf,strategyBranch:'THETA_CONVENTIONAL',strategyVersion:'NOT_PROMOTED',legs:[],
  orderType:'LIMIT',limitPrice:null,quoteProvider:null,quoteSemantics:'UNKNOWN',quoteObservedAt:null,quoteAgeMs:null,maximumQuoteAgeMs:10000,
  bid:null,ask:null,creditDebit:null,maximumRisk:null,buyingPowerEffect:null,capitalRequired:null,aegisResult:'HOLD_ONLY',portfolioEffects:{},
  operatorPaused:true,emergencyLocked:false,executionQuoteQualified:false,persistenceReady:true,idempotencyReady:false,clientOrderId:null});
const pool=new pg.Pool({connectionString:databaseUrl,max:1});
try{await persistSyntheticLifecycleReceipt(pool,lifecycle,asOf);await persistPaperOrderPreview(pool,preview);
  process.stdout.write(JSON.stringify({simulation:'COMPLETE',scenario:lifecycle.scenarioId,terminalState:lifecycle.terminalState,
    receiptHash:lifecycle.contentHash,dryRun:preview.result,blockers:preview.blockers,executionAuthorized:false,
    submitToBroker:false,paperOrderCreated:false})+'\n');}finally{await pool.end();}
