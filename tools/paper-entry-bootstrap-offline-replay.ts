import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface DiagnosticTotals {
  readonly candidates:number; readonly quoteUsable:number; readonly hardRejected:number;
  readonly aegisUnknown:number; readonly aegisVetoed:number;
}

/** Aggregate-only replay of the preserved September 18 diagnostic.
 * It cannot reconstruct per-candidate model outputs, and says so explicitly.
 * It performs no network, database, or broker operation. */
export function replayBootstrapFromDiagnostic(totals:DiagnosticTotals){
  const ownershipExplicitReject=Math.min(totals.quoteUsable,Math.max(0,totals.hardRejected));
  const bootstrapEligible=Math.max(0,totals.quoteUsable-ownershipExplicitReject);
  const reachedAegis=bootstrapEligible;
  const aegisBlock=Math.min(reachedAegis,Math.max(0,totals.aegisVetoed));
  const aegisHoldOnly=Math.min(reachedAegis-aegisBlock,Math.max(0,totals.aegisUnknown));
  return {
    replayClass:'PRESERVED_AGGREGATE_DIAGNOSTIC',totalCandidates:totals.candidates,
    quoteUsable:totals.quoteUsable,bootstrapEligible,ownershipExplicitReject,reachedAegis,
    aegisAllowFull:0,aegisAllowReduced:0,aegisHoldOnly,aegisBlock,
    qtyPositive:0,actionPlanEligible:0,brokerSubmissions:0,
    limitations:['PER_CANDIDATE_OWNERSHIP_OUTPUT_NOT_PRESERVED','AEGIS_MISSING_FAMILY_VALUES_NOT_RECONSTRUCTED'],
  } as const;
}

if(process.argv[1]?.endsWith('paper-entry-bootstrap-offline-replay.ts')){
  const path=resolve(process.argv[2]??'.theta-local-worker/zero-trade-diagnostic-2026-09-18.json');
  const parsed=JSON.parse(await readFile(path,'utf8')) as {targetOpenSessionSample?:{totals?:DiagnosticTotals}};
  const totals=parsed.targetOpenSessionSample?.totals;
  if(totals===undefined)throw new Error('OPEN_SESSION_DIAGNOSTIC_TOTALS_MISSING');
  process.stdout.write(`${JSON.stringify(replayBootstrapFromDiagnostic(totals),null,2)}\n`);
}
