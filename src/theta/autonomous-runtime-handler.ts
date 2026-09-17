import type { IncomingMessage, ServerResponse } from 'node:http';
import { Pool } from 'pg';
import { loadEnvironment } from '../config/environment.js';
import { matchesOperatorToken } from '../providers/readiness-handler.js';
import {
  checkAlpacaEvidenceCapabilities,
  checkOptionomics,
  checkOptionomicsEvidenceCapabilities,
  type CheckResult,
  type EvidenceCapabilityResult,
} from '../providers/readiness.js';
import { persistProviderCapabilities } from '../providers/capability-registry.js';
import { customerStore } from '../customer/customer-store.js';
import { verifyStoredMasterPaperConnection } from '../customer/master-paper-runtime.js';
import { PostgresRuntimeCycleStore, runAutonomousRuntimeCycle } from './autonomous-runtime.js';
import { PostgresWorkerRuntimeStore } from '../worker/postgres-worker-runtime-store.js';
import { runOptionomicsQuoteQualification, sanitizeQualificationReport } from './optionomics-quote-qualification-runtime.js';
import { qualifyOptionomicsProductionSurfaces } from '../providers/optionomics-mcp-qualification.js';
import { qualifyOptionomicsProvider, persistOptionomicsQualification } from '../providers/optionomics-qualification.js';
import { optionomicsConfigFromEnvironment } from './theta-shadow-once.js';
import {
  classifyDatabaseTargetError,
  describeDatabaseEndpoint,
  preflightDatabaseSource,
  preflightDatabaseTarget,
} from '../database/target-preflight.js';
import { matchesAivenBootstrapConfirmation, migrateDatabaseTarget } from '../database/target-migration.js';
import { validateDatabaseTarget } from '../database/target-validation.js';
import { applyLegacyImportRequest } from '../database/legacy-import.js';
import { bootstrapAivenMasterPaperAccount, matchesMasterRecoveryConfirmation } from '../database/master-paper-bootstrap.js';
import { inventoryLegacyRecovery } from '../database/legacy-recovery-inventory.js';
import { matchesLegacyPromotionConfirmation, promoteLegacyRecovery } from '../database/legacy-promotion.js';
import {
  importLegacyReconstructionManifest,
  matchesLegacyReconstructionConfirmation,
} from '../database/legacy-reconstruction-registry.js';
import {
  importLocalForensicChunk,
  matchesLocalForensicConfirmation,
} from '../database/local-forensic-recovery.js';
import {
  masterPaperAuthorizationConfirmation, PostgresPaperExecutionAuthorizationStore,
} from '../execution/paper-execution-authorization.js';
import { fetchMarketClock, fetchOptionContracts, fetchOptionSnapshots } from './alpaca-provider.js';
import { executionOptionQuoteContractVersion, type ExecutionOptionQuote } from '../execution/execution-option-quote.js';
import { persistQuoteProviderQualification, qualifyQuoteProvider } from '../execution/quote-provider-qualification.js';

let runtimePool: Pool | null = null;

export interface LocalWorkerIdentity {
  readonly workerId: string;
  readonly hostId: string;
  readonly buildSha: string;
}

export type LocalWorkerIdentityResult =
  | { readonly kind: 'ABSENT' }
  | { readonly kind: 'INVALID' }
  | { readonly kind: 'VALID'; readonly identity: LocalWorkerIdentity };

export type LocalWorkerOperation = 'RUNTIME_CYCLE' | 'RUNTIME_CORE_CYCLE' | 'RUNTIME_BROKER_CYCLE' | 'RUNTIME_LIFECYCLE_CYCLE' | 'RUNTIME_MANAGEMENT_CYCLE' | 'RUNTIME_OBSERVATION_CYCLE' | 'RUNTIME_EVIDENCE_CYCLE' | 'PROVIDER_EVIDENCE_READINESS' | 'ALPACA_INDICATIVE_QUOTE_QUALIFICATION' | 'OPTIONOMICS_PROVIDER_QUALIFICATION' | 'OPTIONOMICS_QUOTE_QUALIFICATION' | 'OPTIONOMICS_MCP_QUALIFICATION' | 'MASTER_PAPER_AUTHORIZE' | 'DATABASE_SOURCE_PREFLIGHT' | 'DATABASE_TARGET_PREFLIGHT' | 'DATABASE_TARGET_MIGRATE' | 'DATABASE_TARGET_VALIDATE' | 'DATABASE_LEGACY_IMPORT' | 'DATABASE_LEGACY_INVENTORY' | 'DATABASE_LEGACY_PROMOTE' | 'DATABASE_LEGACY_RECONSTRUCTION_IMPORT' | 'DATABASE_LOCAL_FORENSIC_IMPORT' | 'DATABASE_TARGET_BOOTSTRAP_MASTER' | 'INVALID';

export function parseLocalWorkerOperation(request: Pick<IncomingMessage, 'headers'>): LocalWorkerOperation {
  const value = request.headers['x-theta-operation'];
  if (value === undefined) return 'RUNTIME_CYCLE';
  if (value === 'runtime-core-cycle') return 'RUNTIME_CORE_CYCLE';
  if (value === 'runtime-broker-cycle') return 'RUNTIME_BROKER_CYCLE';
  if (value === 'runtime-lifecycle-cycle') return 'RUNTIME_LIFECYCLE_CYCLE';
  if (value === 'runtime-management-cycle') return 'RUNTIME_MANAGEMENT_CYCLE';
  if (value === 'runtime-observation-cycle') return 'RUNTIME_OBSERVATION_CYCLE';
  if (value === 'runtime-evidence-cycle') return 'RUNTIME_EVIDENCE_CYCLE';
  if (value === 'provider-evidence-readiness') return 'PROVIDER_EVIDENCE_READINESS';
  if (value === 'alpaca-indicative-quote-qualification') return 'ALPACA_INDICATIVE_QUOTE_QUALIFICATION';
  if (value === 'optionomics-provider-qualification') return 'OPTIONOMICS_PROVIDER_QUALIFICATION';
  if (value === 'optionomics-quote-qualification') return 'OPTIONOMICS_QUOTE_QUALIFICATION';
  if (value === 'optionomics-mcp-qualification') return 'OPTIONOMICS_MCP_QUALIFICATION';
  if (value === 'master-paper-authorize') return 'MASTER_PAPER_AUTHORIZE';
  if (value === 'database-source-preflight') return 'DATABASE_SOURCE_PREFLIGHT';
  if (value === 'database-target-preflight') return 'DATABASE_TARGET_PREFLIGHT';
  if (value === 'database-target-migrate') return 'DATABASE_TARGET_MIGRATE';
  if (value === 'database-target-validate') return 'DATABASE_TARGET_VALIDATE';
  if (value === 'database-legacy-import') return 'DATABASE_LEGACY_IMPORT';
  if (value === 'database-legacy-inventory') return 'DATABASE_LEGACY_INVENTORY';
  if (value === 'database-legacy-promote') return 'DATABASE_LEGACY_PROMOTE';
  if (value === 'database-legacy-reconstruction-import') return 'DATABASE_LEGACY_RECONSTRUCTION_IMPORT';
  if (value === 'database-local-forensic-import') return 'DATABASE_LOCAL_FORENSIC_IMPORT';
  if (value === 'database-target-bootstrap-master') return 'DATABASE_TARGET_BOOTSTRAP_MASTER';
  return 'INVALID';
}

export function parseLocalWorkerIdentity(request: Pick<IncomingMessage, 'headers'>): LocalWorkerIdentityResult {
  const rawWorkerId = request.headers['x-theta-worker-id'];
  const rawHostId = request.headers['x-theta-host-id'];
  const rawBuildSha = request.headers['x-theta-build-sha'];
  const supplied = [rawWorkerId, rawHostId, rawBuildSha].filter((value) => value !== undefined).length;
  if (supplied === 0) return { kind: 'ABSENT' };
  if (supplied !== 3) return { kind: 'INVALID' };

  const workerId = validHeader(rawWorkerId, /^[A-Za-z0-9_.:-]{8,160}$/);
  const hostId = validHeader(rawHostId, /^[A-Za-z0-9_.-]{1,128}$/);
  const buildSha = validHeader(rawBuildSha, /^[0-9a-f]{7,40}$/);
  if (workerId === null || hostId === null || buildSha === null) return { kind: 'INVALID' };
  return { kind: 'VALID', identity: { workerId, hostId, buildSha } };
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(JSON.stringify(body));
}

export default async function autonomousRuntimeHandler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'POST' && request.method !== 'DELETE') {
    response.setHeader('Allow', 'POST, DELETE');
    send(response, 405, { error: 'method_not_allowed' });
    return;
  }
  const environment = loadEnvironment();
  const secret = environment.CRON_SECRET ?? '';
  if (secret.length < 32 || !matchesOperatorToken(request.headers.authorization ?? '', secret)) {
    send(response, 401, { error: 'unauthorized' });
    return;
  }
  if (!environment.THETA_AUTONOMOUS_WORKER_ENABLED) {
    send(response, 503, { error: 'worker_disabled', orderSubmission: 'EXTERNAL_QUOTE_BLOCKER' });
    return;
  }
  const operation = parseLocalWorkerOperation(request);
  if (operation === 'INVALID') {
    send(response, 400, { error: 'invalid_local_worker_operation', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
    return;
  }
  const localIdentity = parseLocalWorkerIdentity(request);
  if (localIdentity.kind === 'INVALID') {
    send(response, 400, { error: 'invalid_local_worker_identity', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
    return;
  }
  if (operation === 'MASTER_PAPER_AUTHORIZE') {
    if (localIdentity.kind !== 'VALID') {
      send(response, 400, { error: 'local_worker_identity_required', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    if (request.headers['x-theta-confirmation'] !== masterPaperAuthorizationConfirmation) {
      send(response, 403, { error: 'master_paper_authorization_confirmation_required', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    if (!environment.DATABASE_URL) {
      send(response, 503, { error: 'database_not_configured', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    runtimePool ??= new Pool({ connectionString: environment.DATABASE_URL, max: 2, connectionTimeoutMillis: 8_000 });
    const control=await new PostgresPaperExecutionAuthorizationStore(runtimePool).authorizeManagementOnly({
      confirmation:masterPaperAuthorizationConfirmation,authorizedAt:new Date().toISOString(),
      sourceRef:'OWNER_DIRECTIVE_2026_09_17_MASTER_THETA_PAPER',
    });
    send(response,200,{accountRole:'MASTER_THETA_PAPER',environment:'PAPER',
      masterManagementAuthorized:control.masterExecutionEnabled,newRiskPaused:control.pauseNewOrders,
      followerExecution:'LOCKED',liveMoneyAuthorized:false,executionGate:'LOCKED',ordersSubmitted:0});
    return;
  }
  if (operation === 'DATABASE_TARGET_PREFLIGHT') {
    if (localIdentity.kind !== 'VALID') {
      send(response, 400, { error: 'local_worker_identity_required', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    if (!environment.AIVEN_DATABASE_URL) {
      send(response, 503, { error: 'aiven_database_not_configured', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    try {
      const preflight = await preflightDatabaseTarget(environment.AIVEN_DATABASE_URL);
      send(response, 200, {
        target: 'AIVEN_POSTGRESQL', preflight, migrationAuthorized: false,
        cutoverAuthorized: false, executionGate: 'EXTERNAL_QUOTE_BLOCKER', ordersSubmitted: 0,
      });
    } catch (error) {
      const failure = classifyDatabaseTargetError(error);
      send(response, 503, {
        error: 'AIVEN_DATABASE_PREFLIGHT_FAILED', ...failure,
        endpoint: describeDatabaseEndpoint(environment.AIVEN_DATABASE_URL),
        target: 'AIVEN_POSTGRESQL', migrationAuthorized: false,
        cutoverAuthorized: false, executionGate: 'EXTERNAL_QUOTE_BLOCKER', ordersSubmitted: 0,
      });
    }
    return;
  }
  if (operation === 'DATABASE_TARGET_MIGRATE') {
    if (localIdentity.kind !== 'VALID') {
      send(response, 400, { error: 'local_worker_identity_required', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    if (!matchesAivenBootstrapConfirmation(request.headers['x-theta-database-change'])) {
      send(response, 403, { error: 'aiven_bootstrap_confirmation_required', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    if (!environment.AIVEN_DATABASE_URL) {
      send(response, 503, { error: 'aiven_database_not_configured', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    try {
      const receipt = await migrateDatabaseTarget(environment.AIVEN_DATABASE_URL);
      send(response, 200, {
        target: 'AIVEN_POSTGRESQL', receipt, cutoverAuthorized: false,
        executionGate: 'EXTERNAL_QUOTE_BLOCKER', ordersSubmitted: 0,
      });
    } catch (error) {
      const failure = classifyDatabaseTargetError(error);
      send(response, 503, {
        error: 'AIVEN_DATABASE_MIGRATION_FAILED', ...failure, target: 'AIVEN_POSTGRESQL', cutoverAuthorized: false,
        executionGate: 'EXTERNAL_QUOTE_BLOCKER', ordersSubmitted: 0,
      });
    }
    return;
  }
  if (operation === 'DATABASE_TARGET_VALIDATE') {
    if (localIdentity.kind !== 'VALID') {
      send(response, 400, { error: 'local_worker_identity_required', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    if (!environment.AIVEN_DATABASE_URL) {
      send(response, 503, { error: 'aiven_database_not_configured', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    try {
      const receipt = await validateDatabaseTarget(environment.AIVEN_DATABASE_URL);
      send(response, 200, {
        target: 'AIVEN_POSTGRESQL', receipt, cutoverAuthorized: false,
        executionGate: 'EXTERNAL_QUOTE_BLOCKER', ordersSubmitted: 0,
      });
    } catch (error) {
      const failure = classifyDatabaseTargetError(error);
      send(response, 503, {
        error: 'AIVEN_DATABASE_VALIDATION_FAILED', ...failure, target: 'AIVEN_POSTGRESQL', cutoverAuthorized: false,
        executionGate: 'EXTERNAL_QUOTE_BLOCKER', ordersSubmitted: 0,
      });
    }
    return;
  }
  if (operation === 'DATABASE_LEGACY_IMPORT') {
    if (localIdentity.kind !== 'VALID') {
      send(response, 400, { error: 'local_worker_identity_required', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    if (!matchesAivenBootstrapConfirmation(request.headers['x-theta-database-change'])) {
      send(response, 403, { error: 'aiven_bootstrap_confirmation_required', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    if (!environment.AIVEN_DATABASE_URL) {
      send(response, 503, { error: 'aiven_database_not_configured', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    try {
      const input = await readBoundedJson(request, 1_500_000);
      const receipt = await applyLegacyImportRequest(environment.AIVEN_DATABASE_URL, input);
      send(response, 200, { target: 'AIVEN_LEGACY_STAGING', receipt, cutoverAuthorized: false,
        executionGate: 'EXTERNAL_QUOTE_BLOCKER', ordersSubmitted: 0 });
    } catch (error) {
      const failure = classifyDatabaseTargetError(error);
      send(response, 400, { error: 'AIVEN_LEGACY_IMPORT_FAILED', ...failure, target: 'AIVEN_LEGACY_STAGING',
        cutoverAuthorized: false, executionGate: 'EXTERNAL_QUOTE_BLOCKER', ordersSubmitted: 0 });
    }
    return;
  }
  if (operation === 'DATABASE_TARGET_BOOTSTRAP_MASTER') {
    if (localIdentity.kind !== 'VALID') {
      send(response, 400, { error: 'local_worker_identity_required', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    if (!matchesMasterRecoveryConfirmation(request.headers['x-theta-database-change'])) {
      send(response, 403, { error: 'master_recovery_confirmation_required', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    if (!environment.AIVEN_DATABASE_URL) {
      send(response, 503, { error: 'aiven_database_not_configured', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    try {
      const receipt = await bootstrapAivenMasterPaperAccount(environment);
      send(response, 200, { target: 'AIVEN_POSTGRESQL', receipt, cutoverAuthorized: false,
        executionGate: 'EXTERNAL_QUOTE_BLOCKER', followerExecution: 'LOCKED', liveMoneyAuthorized: false,
        masterPaperOrders: 0, followerPaperOrders: 0, liveOrders: 0 });
    } catch (error) {
      const failure = classifyDatabaseTargetError(error);
      send(response, 400, { error: 'AIVEN_MASTER_RECOVERY_FAILED', ...failure, target: 'AIVEN_POSTGRESQL',
        cutoverAuthorized: false, executionGate: 'EXTERNAL_QUOTE_BLOCKER', ordersSubmitted: 0 });
    }
    return;
  }
  if (operation === 'DATABASE_LEGACY_INVENTORY') {
    if (localIdentity.kind !== 'VALID') {
      send(response, 400, { error: 'local_worker_identity_required', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    if (!environment.AIVEN_DATABASE_URL) {
      send(response, 503, { error: 'aiven_database_not_configured', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    try {
      const receipt = await inventoryLegacyRecovery(environment.AIVEN_DATABASE_URL);
      send(response, 200, { target: 'AIVEN_LEGACY_INVENTORY', receipt, runtimeAuthority: 'AIVEN',
        legacyRuntimeAuthority: false, executionGate: 'EXTERNAL_QUOTE_BLOCKER', ordersSubmitted: 0 });
    } catch (error) {
      const failure = classifyDatabaseTargetError(error);
      send(response, 503, { error: 'AIVEN_LEGACY_INVENTORY_FAILED', ...failure,
        target: 'AIVEN_LEGACY_INVENTORY', runtimeAuthority: 'AIVEN', legacyRuntimeAuthority: false,
        executionGate: 'EXTERNAL_QUOTE_BLOCKER', ordersSubmitted: 0 });
    }
    return;
  }
  if (operation === 'DATABASE_LEGACY_PROMOTE') {
    if (localIdentity.kind !== 'VALID') {
      send(response, 400, { error: 'local_worker_identity_required', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    if (!matchesLegacyPromotionConfirmation(request.headers['x-theta-database-change'])) {
      send(response, 403, { error: 'legacy_promotion_confirmation_required', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    if (!environment.AIVEN_DATABASE_URL) {
      send(response, 503, { error: 'aiven_database_not_configured', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    try {
      const body = await readBoundedJson(request, 10_000) as { importBatchId?: unknown };
      const importBatchId = typeof body.importBatchId === 'string' ? body.importBatchId : undefined;
      const receipt = await promoteLegacyRecovery(environment.AIVEN_DATABASE_URL, importBatchId);
      send(response, 200, { target: 'AIVEN_LEGACY_RESEARCH_HISTORY', receipt, runtimeAuthority: 'AIVEN',
        legacyRuntimeAuthority: false, canonicalRowsChanged: 0, executionGate: 'EXTERNAL_QUOTE_BLOCKER',
        followerExecution: 'LOCKED', liveMoneyAuthorized: false, ordersSubmitted: 0 });
    } catch (error) {
      const failure = classifyDatabaseTargetError(error);
      send(response, 400, { error: 'AIVEN_LEGACY_PROMOTION_FAILED', ...failure,
        target: 'AIVEN_LEGACY_RESEARCH_HISTORY', runtimeAuthority: 'AIVEN', legacyRuntimeAuthority: false,
        executionGate: 'EXTERNAL_QUOTE_BLOCKER', ordersSubmitted: 0 });
    }
    return;
  }
  if (operation === 'DATABASE_LEGACY_RECONSTRUCTION_IMPORT') {
    if (localIdentity.kind !== 'VALID') {
      send(response, 400, { error: 'local_worker_identity_required', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    if (!matchesLegacyReconstructionConfirmation(request.headers['x-theta-database-change'])) {
      send(response, 403, { error: 'legacy_reconstruction_confirmation_required', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    if (!environment.AIVEN_DATABASE_URL) {
      send(response, 503, { error: 'aiven_database_not_configured', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    try {
      const body = await readBoundedJson(request, 1_500_000);
      const receipt = await importLegacyReconstructionManifest(environment.AIVEN_DATABASE_URL, body);
      send(response, 200, { target: 'AIVEN_LEGACY_RECONSTRUCTION_REGISTRY', receipt, runtimeAuthority: 'AIVEN',
        legacyRuntimeAuthority: false, canonicalRowsChanged: 0, executionGate: 'EXTERNAL_QUOTE_BLOCKER',
        followerExecution: 'LOCKED', liveMoneyAuthorized: false, ordersSubmitted: 0 });
    } catch (error) {
      const failure = classifyDatabaseTargetError(error);
      send(response, 400, { error: 'AIVEN_LEGACY_RECONSTRUCTION_IMPORT_FAILED', ...failure,
        target: 'AIVEN_LEGACY_RECONSTRUCTION_REGISTRY', runtimeAuthority: 'AIVEN', legacyRuntimeAuthority: false,
        executionGate: 'EXTERNAL_QUOTE_BLOCKER', ordersSubmitted: 0 });
    }
    return;
  }
  if (operation === 'DATABASE_LOCAL_FORENSIC_IMPORT') {
    if (localIdentity.kind !== 'VALID') {
      send(response, 400, { error: 'local_worker_identity_required', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    if (!matchesLocalForensicConfirmation(request.headers['x-theta-database-change'])) {
      send(response, 403, { error: 'local_forensic_confirmation_required', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    if (!environment.AIVEN_DATABASE_URL) {
      send(response, 503, { error: 'aiven_database_not_configured', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    try {
      const body = await readBoundedJson(request, 1_500_000);
      const receipt = await importLocalForensicChunk(environment.AIVEN_DATABASE_URL, body);
      send(response, 200, { target: 'AIVEN_LOCAL_FORENSIC_RECOVERY', receipt, runtimeAuthority: 'AIVEN',
        legacyRuntimeAuthority: false, canonicalRowsChanged: 0, executionGate: 'EXTERNAL_QUOTE_BLOCKER',
        followerExecution: 'LOCKED', liveMoneyAuthorized: false, ordersSubmitted: 0 });
    } catch (error) {
      const failure = classifyDatabaseTargetError(error);
      send(response, 400, { error: 'AIVEN_LOCAL_FORENSIC_IMPORT_FAILED', ...failure,
        target: 'AIVEN_LOCAL_FORENSIC_RECOVERY', runtimeAuthority: 'AIVEN', legacyRuntimeAuthority: false,
        executionGate: 'EXTERNAL_QUOTE_BLOCKER', ordersSubmitted: 0 });
    }
    return;
  }
  if (operation === 'DATABASE_SOURCE_PREFLIGHT') {
    if (localIdentity.kind !== 'VALID') {
      send(response, 400, { error: 'local_worker_identity_required', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    if (!environment.LEGACY_NEON_DATABASE_URL) {
      send(response, 503, { error: 'database_not_configured', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
      return;
    }
    try {
      const preflight = await preflightDatabaseSource(environment.LEGACY_NEON_DATABASE_URL);
      send(response, 200, {
        source: 'NEON_LEGACY', preflight, mutationAuthorized: false, runtimeAuthority: false,
        executionGate: 'EXTERNAL_QUOTE_BLOCKER', ordersSubmitted: 0,
      });
    } catch (error) {
      const failure = classifyDatabaseTargetError(error);
      send(response, 503, {
        error: 'NEON_DATABASE_PREFLIGHT_FAILED', ...failure, source: 'NEON_LEGACY', mutationAuthorized: false,
        runtimeAuthority: false, executionGate: 'EXTERNAL_QUOTE_BLOCKER', ordersSubmitted: 0,
      });
    }
    return;
  }
  if (!environment.DATABASE_URL) {
    send(response, 503, { error: 'database_not_configured', orderSubmission: 'EXTERNAL_QUOTE_BLOCKER' });
    return;
  }
  runtimePool ??= new Pool({ connectionString: environment.DATABASE_URL, max: 2, connectionTimeoutMillis: 8_000 });
  const localWorkerId = localIdentity.kind === 'VALID' ? localIdentity.identity.workerId : null;
  const workerStore=new PostgresWorkerRuntimeStore(runtimePool);
  if(request.method==='DELETE'){
    if(localWorkerId===null){send(response,400,{error:'local_worker_identity_required'});return;}
    await workerStore.stop(localWorkerId,new Date().toISOString(),'OFFLINE');
    send(response,200,{state:'OFFLINE',executionGate:'LOCKED'});
    return;
  }
  try {
    if (operation === 'ALPACA_INDICATIVE_QUOTE_QUALIFICATION') {
      if (localIdentity.kind !== 'VALID') {
        send(response, 400, { error: 'local_worker_identity_required', executionGate: 'LOCKED' });
        return;
      }
      const cycleStore = new PostgresRuntimeCycleStore(runtimePool);
      const master = await cycleStore.resolveMasterContext(environment);
      const requestedAt = new Date().toISOString();
      const from = requestedAt.slice(0, 10);
      const through = new Date(Date.parse(requestedAt) + 60 * 86_400_000).toISOString().slice(0, 10);
      const contracts = await fetchOptionContracts(master.alpaca, { underlyingSymbol:'SPY', expirationDateGte:from,
        expirationDateLte:through, optionType:'put', limit:100, maxPages:3 });
      const snapshots = await fetchOptionSnapshots(master.alpaca, { underlyingSymbol:'SPY', feed:'indicative',
        optionType:'put', limit:1000, maxPages:3 });
      const clock = await fetchMarketClock(master.alpaca,new Date().toISOString());
      const listing = [...contracts.items].filter((item) => {
        const snapshot=snapshots.snapshots.get(item.symbol);
        return snapshot?.bid!==null&&snapshot?.ask!==null&&snapshot?.quoteTimestamp!==null
          && Number.isFinite(snapshot?.bid)&&Number.isFinite(snapshot?.ask)
          && (snapshot?.bid??0)>0&&(snapshot?.ask??0)>=(snapshot?.bid??0);
      }).sort((left,right)=>Date.parse(snapshots.snapshots.get(right.symbol)?.quoteTimestamp??'')
        -Date.parse(snapshots.snapshots.get(left.symbol)?.quoteTimestamp??''))[0];
      if (listing === undefined) {
        send(response, 207, { provider:'ALPACA', semantics:'PAPER_INDICATIVE_REFERENCE', qualified:false,
          blockers:['NO_FRESH_TWO_SIDED_EXACT_CONTRACT_QUOTE'], contractDiscoveryComplete:contracts.complete,
          snapshotPaginationComplete:snapshots.complete, executionAuthorized:false, ordersSubmitted:0 });
        return;
      }
      const snapshot=snapshots.snapshots.get(listing.symbol);
      if(snapshot===undefined||snapshot.bid===null||snapshot.ask===null||snapshot.quoteTimestamp===null)
        throw new Error('QUALIFICATION_SNAPSHOT_ALIGNMENT_FAILED');
      const attemptedAt = new Date().toISOString();
      const quote:ExecutionOptionQuote={contractVersion:executionOptionQuoteContractVersion,contractId:listing.symbol,
        providerContractId:listing.symbol,bid:snapshot.bid,ask:snapshot.ask,bidSize:snapshot.bidSize,
        askSize:snapshot.askSize,providerTimestamp:snapshot.quoteTimestamp,receivedAtUtc:attemptedAt,
        receivedAtMonotonic:performance.now(),sequence:1,provider:'ALPACA',source:'BROKER_INDICATIVE',
        entitlementState:'QUALIFIED',sourceSemantics:'PAPER_INDICATIVE_REFERENCE',connectionState:'CONNECTED',
        subscriptionState:'ACTIVE',provenance:{authenticated:true,exactContractMapping:true,
          documentedForOrderPricing:false,feed:'INDICATIVE',paperOnly:true,semanticUse:'MASTER_THETA_PAPER_LIMIT_REFERENCE'}};
      const receipt=qualifyQuoteProvider({quote,expectedContractId:listing.symbol,attemptedAt,maximumAgeMs:10_000,marketOpen:clock.isOpen===true});
      await persistQuoteProviderQualification(runtimePool,receipt);
      send(response,receipt.qualified?200:207,{provider:receipt.provider,source:receipt.source,
        semantics:receipt.semantics,entitlementState:receipt.entitlementState,qualified:receipt.qualified,
        blockers:receipt.blockers,httpStatus:200,exactContractIdentity:true,bidPresent:true,askPresent:true,
        bidSizePresent:snapshot.bidSize!==null,askSizePresent:snapshot.askSize!==null,
        providerTimestampPresent:true,quoteAgeMs:Date.parse(attemptedAt)-Date.parse(snapshot.quoteTimestamp),
        marketOpen:clock.isOpen,
        contractDiscoveryComplete:contracts.complete,snapshotPaginationComplete:snapshots.complete,
        evidenceHash:receipt.evidenceHash,executionAuthorized:false,ordersSubmitted:0});
      return;
    }
    if (operation === 'OPTIONOMICS_PROVIDER_QUALIFICATION') {
      if (localIdentity.kind !== 'VALID') {
        send(response, 400, { error: 'local_worker_identity_required', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
        return;
      }
      const receipt=await qualifyOptionomicsProvider({mode:'REAL_AUTHENTICATED',at:new Date().toISOString(),symbol:'SPY',
        config:optionomicsConfigFromEnvironment(environment)});
      await persistOptionomicsQualification(runtimePool,receipt);
      send(response,receipt.secretState==='AUTH_VALID'?200:207,{version:receipt.version,secretState:receipt.secretState,
        families:receipt.families.map(({family,state,blockers})=>({family,state,blockers})),realPayloadCount:receipt.realPayloadCount,
        staleCapabilityCount:receipt.staleCapabilityCount,receiptHash:receipt.receiptHash,executionGate:'EXTERNAL_QUOTE_BLOCKER',
        executionAuthorized:false,ordersSubmitted:0});
      return;
    }
    if (operation === 'OPTIONOMICS_MCP_QUALIFICATION') {
      if (localIdentity.kind !== 'VALID') {
        send(response, 400, { error: 'local_worker_identity_required', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
        return;
      }
      const report = await qualifyOptionomicsProductionSurfaces(environment);
      send(response, 200, { ...report, executionGate: 'EXTERNAL_QUOTE_BLOCKER', ordersSubmitted: 0 });
      return;
    }
    if (operation === 'OPTIONOMICS_QUOTE_QUALIFICATION') {
      if (localIdentity.kind !== 'VALID') {
        send(response, 400, { error: 'local_worker_identity_required', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
        return;
      }
      const report = await runOptionomicsQuoteQualification(environment, runtimePool);
      send(response, 200, { ...sanitizeQualificationReport(report), executionGate: 'EXTERNAL_QUOTE_BLOCKER', ordersSubmitted: 0 });
      return;
    }
    if (operation === 'PROVIDER_EVIDENCE_READINESS') {
      if (localIdentity.kind !== 'VALID') {
        send(response, 400, { error: 'local_worker_identity_required', executionGate: 'EXTERNAL_QUOTE_BLOCKER' });
        return;
      }
      const cycleStore = new PostgresRuntimeCycleStore(runtimePool);
      const [masterContext, masterReadiness] = await Promise.all([
        cycleStore.resolveMasterContext(environment),
        verifyStoredMasterPaperConnection(environment, customerStore(environment.DATABASE_URL)),
      ]);
      const [alpaca, optionomicsCurrent, optionomicsEvidence] = await Promise.all([
        checkAlpacaEvidenceCapabilities(masterContext.alpaca),
        checkOptionomics(environment),
        checkOptionomicsEvidenceCapabilities(environment),
      ]);
      const optionomics = [...optionomicsCurrent, ...optionomicsEvidence];
      const [alpacaPersistence, optionomicsPersistence, counts] = await Promise.all([
        persistProviderCapabilities(runtimePool, 'ALPACA', alpaca),
        persistProviderCapabilities(runtimePool, 'OPTIONOMICS', optionomics),
        runtimePool.query(`SELECT
          (SELECT count(broker_order_id)::int FROM trade.broker_order) AS broker_orders,
          (SELECT count(fill_id)::int FROM trade.fill) AS broker_fills`),
      ]);
      send(response, 200, {
        generatedAt: new Date().toISOString(), trading: 'PAPER_QUOTE_BLOCKED', executionGate: 'EXTERNAL_QUOTE_BLOCKER',
        master: {
          accountRole: masterReadiness.accountRole, brokerHost: masterReadiness.brokerHost,
          brokerIdentityVerified: masterReadiness.brokerIdentityVerified,
          connectionState: masterReadiness.connectionState, accountStatus: masterReadiness.accountStatus,
          optionsApprovedLevel: masterReadiness.optionsApprovedLevel,
          optionsTradingLevel: masterReadiness.optionsTradingLevel,
          openPositions: masterReadiness.openPositions, openOrders: masterReadiness.openOrders,
          marketOpen: masterReadiness.marketOpen,
          calendarSessionConfirmed: masterReadiness.calendarSessionConfirmed,
        },
        alpaca: alpaca.map((result) => ({
          capability: result.capability, operationAlias: result.operationAlias,
          availability: result.availability, httpStatus: result.httpStatus,
          observedAt: result.observedAt, details: result.details,
        })),
        optionomics: optionomics.map((result) => ({
          capability: result.capability, operationAlias: result.operationAlias,
          availability: optionomicsAvailability(result),
          state: 'state' in result ? result.state : capabilityState(result),
          httpStatus: result.httpStatus, observedAt: result.observedAt, details: result.details,
        })),
        persistence: {
          alpacaCapabilities: alpacaPersistence.capabilityCount,
          optionomicsCapabilities: optionomicsPersistence.capabilityCount,
        },
        orders: {
          brokerOrders: Number(counts.rows[0]?.broker_orders ?? 0),
          brokerFills: Number(counts.rows[0]?.broker_fills ?? 0),
        },
      });
      return;
    }
    if(localIdentity.kind === 'ABSENT'){
      const active=await workerStore.activeLeaseOwner(new Date().toISOString());
      if(active!==null){send(response,409,{error:'local_primary_worker_active',executionGate:'LOCKED'});return;}
    }else{
      const at=new Date();
      const identity = localIdentity.identity;
      const previous=await workerStore.register({
        workerId: identity.workerId,
        hostId: identity.hostId,
        buildSha: identity.buildSha,
        startedAt:at.toISOString(),strategyVersions:['theta-shadow-once-v1']});
      const lease=await workerStore.acquireLease(identity.workerId,at.toISOString(),new Date(at.getTime()+150_000).toISOString());
      if(lease==='HELD_BY_OTHER'){send(response,409,{error:'primary_master_paper_worker_lease_held',executionGate:'LOCKED'});return;}
      if(previous!==null&&at.getTime()-Date.parse(previous)>120_000)
        await workerStore.recordResumeGap(identity.workerId,previous,at.toISOString());
      await workerStore.cycleStarted(identity.workerId,at.toISOString());
    }
    const scope=operation==='RUNTIME_CORE_CYCLE'?'CORE':operation==='RUNTIME_BROKER_CYCLE'?'BROKER'
      :operation==='RUNTIME_LIFECYCLE_CYCLE'?'LIFECYCLE':operation==='RUNTIME_MANAGEMENT_CYCLE'?'MANAGEMENT'
        :operation==='RUNTIME_OBSERVATION_CYCLE'?'OBSERVATION':operation==='RUNTIME_EVIDENCE_CYCLE'?'EVIDENCE':'FULL';
    const report = await runAutonomousRuntimeCycle(environment, runtimePool, new Date(),{scope});
    if(localWorkerId!==null)await workerStore.cycleCompleted(localWorkerId,report,new Date().toISOString());
    send(response, report.status === 'FAILED' || report.status === 'QUARANTINED' ? 503 : report.status === 'DEGRADED' ? 207 : 200, report);
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message)
      ? error.message : 'AUTONOMOUS_RUNTIME_FAILED';
    if (localWorkerId !== null && operation === 'RUNTIME_CYCLE') {
      await workerStore.stop(localWorkerId, new Date().toISOString(), 'ERROR', code).catch(() => undefined);
    }
    send(response, 503, {
      error: code, executionGate: 'LOCKED', masterPaperOrdersSubmitted: 0,
      followerPaperOrdersSubmitted: 0, liveOrdersSubmitted: 0,
    });
  }
}

async function readBoundedJson(request: IncomingMessage, maximumBytes: number): Promise<unknown> {
  const parsed = (request as IncomingMessage & { body?: unknown }).body;
  if (parsed !== undefined) {
    const serialized = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
    if (Buffer.byteLength(serialized, 'utf8') > maximumBytes) throw Object.assign(new Error('BODY_TOO_LARGE'), { code: 'BODY_TOO_LARGE' });
    return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > maximumBytes) throw Object.assign(new Error('BODY_TOO_LARGE'), { code: 'BODY_TOO_LARGE' });
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function optionomicsAvailability(result: CheckResult | EvidenceCapabilityResult): string {
  if ('availability' in result) return result.availability;
  if (result.state === 'GOOD') return 'AVAILABLE';
  if (result.state === 'NOT_ENTITLED') return 'NOT_ENTITLED';
  return 'UNVERIFIED';
}

function capabilityState(result: EvidenceCapabilityResult): CheckResult['state'] {
  if (result.availability === 'AVAILABLE' || result.availability === 'AVAILABLE_WITH_LIMITS') return 'GOOD';
  if (result.availability === 'NOT_ENTITLED') return 'NOT_ENTITLED';
  return 'UNKNOWN';
}

function validHeader(value: IncomingMessage['headers'][string], pattern: RegExp): string | null {
  return typeof value==='string'&&pattern.test(value)?value:null;
}
