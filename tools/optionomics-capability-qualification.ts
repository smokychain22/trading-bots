import { Pool } from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import {
  persistOptionomicsCapabilityQualification,
  qualifyOptionomicsProductionSurfaces,
} from '../src/providers/optionomics-mcp-qualification.js';

const environmentFile = process.argv
  .find((value) => value.startsWith('--environment-file='))
  ?.slice('--environment-file='.length);
if (!environmentFile) throw new Error('EXPLICIT_ENVIRONMENT_FILE_REQUIRED');

const environment = loadEnvironmentFile(environmentFile);
const report = await qualifyOptionomicsProductionSurfaces(environment);
let persistenceState: 'NOT_CONFIGURED' | 'PERSISTED' | 'FAILED' = 'NOT_CONFIGURED';
let persistenceErrorCode: string | null = null;
let reportHash: string | null = null;

if (environment.DATABASE_URL) {
  const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 1 });
  try {
    reportHash = await persistOptionomicsCapabilityQualification(pool, report, [
      environment.OPTIONOMICS_EMAIL ?? '',
      environment.OPTIONOMICS_API_KEY ?? '',
    ]);
    persistenceState = 'PERSISTED';
  } catch (error) {
    persistenceState = 'FAILED';
    persistenceErrorCode = typeof error === 'object' && error !== null
      && 'code' in error && typeof error.code === 'string'
      ? error.code
      : error instanceof Error ? error.name : 'UNCLASSIFIED';
  } finally {
    await pool.end();
  }
}

process.stdout.write(`${JSON.stringify({
  generatedAt: report.generatedAt,
  authenticatedSurface: report.authenticatedSurface,
  secretShapeValid: report.secretShape.EMAIL_FORMAT_VALID && report.secretShape.TOKEN_FORMAT_VALID,
  restCapabilities: report.rest.capabilities.map((capability) => ({
    operationAlias: capability.operationAlias,
    path: capability.path,
    status: capability.status,
    dataState: capability.dataState,
    requestedDate: capability.requestedDate,
    servedDate: capability.servedDate,
    exactRequestedDateServed: capability.exactRequestedDateServed,
    requestedMetric: capability.requestedMetric,
    returnedMetric: capability.returnedMetric,
    metricMatchesRequest: capability.metricMatchesRequest,
    paginationComplete: capability.paginationComplete,
    rateLimitHeadersPresent: capability.rateLimitHeadersPresent,
    fieldTypes: capability.fieldTypes,
  })),
  mcp: {
    authenticatedScheme: report.mcp.authenticatedScheme,
    toolCount: report.mcp.toolCount,
    toolCatalogHash: report.mcp.toolCatalogHash,
    evidence: report.mcp.evidence,
  },
  publicApiContractHash: report.publicApiContractHash,
  orderSubmission: report.orderSubmission,
  persistenceState,
  persistenceErrorCode,
  reportHash,
})}\n`);
