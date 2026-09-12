import type { DatasetExportArtifact } from './point-in-time-evidence.js';

export const researchHandoffVersion='theta-research-handoff-v1' as const;

export function buildResearchHandoff(input:{artifact:DatasetExportArtifact;exportPath:string;manifestPath:string}){
  return {
    handoffVersion:researchHandoffVersion,
    exportPath:input.exportPath,
    manifestPath:input.manifestPath,
    datasetHash:input.artifact.datasetHash,
    schemaVersion:input.artifact.schemaVersion,
    sourceClass:'REAL_POINT_IN_TIME_SHADOW',
    sourceWindow:input.artifact.sourceWindow,
    rowCounts:input.artifact.rowCounts,
    analysisCommand:'npm run theta:research-export -- --latest',
  } as const;
}
