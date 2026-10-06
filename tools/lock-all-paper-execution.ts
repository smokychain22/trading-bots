import { loadEnvironmentFile } from '../src/config/environment.js';
import { assertPostMigrationExecutionLocked } from '../src/database/post-migration-resume.js';
import {
  fullPaperExecutionLockConfirmation,
  PostgresPaperExecutionAuthorizationStore,
} from '../src/execution/paper-execution-authorization.js';
import { createRuntimePostgresPool } from '../src/theta/runtime-postgres-pool.js';

// The emergency lock must lock the database the PRODUCTION worker uses (.theta-local-worker/production.env). There is no default: .env.local may
// point at a non-Production database, and a lock written there would leave Production executing.
const environmentFile=process.argv.find((value)=>value.startsWith('--environment-file='))?.split('=',2)[1];
if(environmentFile===undefined||environmentFile.trim()==='')throw new Error('LOCK_REQUIRES_EXPLICIT_ENVIRONMENT_FILE');
const confirmation=process.argv.find((value)=>value.startsWith('--confirmation='))?.split('=',2)[1]??'';
const environment=loadEnvironmentFile(environmentFile);
if(!environment.AIVEN_DATABASE_URL)throw new Error('AIVEN_DATABASE_URL_NOT_CONFIGURED');
assertPostMigrationExecutionLocked(environment);
if(confirmation!==fullPaperExecutionLockConfirmation)
  throw new Error('FULL_PAPER_EXECUTION_LOCK_CONFIRMATION_REQUIRED');

const pool=createRuntimePostgresPool(environment.AIVEN_DATABASE_URL,undefined,{
  maximumConnections:1,
  applicationName:'theta-lock-all-paper-execution',
});
try{
  const store=new PostgresPaperExecutionAuthorizationStore(pool);
  const prior=await store.current();
  const locked=await store.lockAllExecution({
    confirmation,
    lockedAt:new Date().toISOString(),
    sourceRef:'OWNER_DIRECTIVE_PHASE_1_FULL_EXECUTION_LOCK',
  });
  console.log(JSON.stringify({
    contractVersion:'theta-full-paper-execution-lock-v1',
    state:'LOCKED',
    prior:{
      pauseNewOrders:prior.pauseNewOrders,
      masterExecutionEnabled:prior.masterExecutionEnabled,
      followerExecutionEnabled:prior.followerExecutionEnabled,
      authorizationLineagePresent:prior.authorizationEventId!==null,
    },
    current:{
      pauseNewOrders:locked.pauseNewOrders,
      masterExecutionEnabled:locked.masterExecutionEnabled,
      followerExecutionEnabled:locked.followerExecutionEnabled,
      authorizationLineagePreserved:locked.authorizationEventId===prior.authorizationEventId,
    },
    orderSubmissions:0,
    brokerMutations:0,
    liveMoneyAuthorized:false,
  }));
}finally{
  await pool.end();
}
