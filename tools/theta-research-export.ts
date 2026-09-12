import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { PostgresDatasetExporter } from '../src/research/postgres-dataset-export.js';
import { buildR6ReadinessReceipt } from '../src/research/r6-readiness.js';
import { buildResearchHandoff } from '../src/research/research-handoff.js';

const args=process.argv.slice(2);
const value=(name:string):string|null => {
  const index=args.indexOf(name);
  return index>=0 ? args[index+1]??null : null;
};
const parsedDate=(raw:string|null,name:string):string|null => {
  if (raw===null) return null;
  const epoch=Date.parse(raw);
  if (Number.isNaN(epoch)) throw new Error(`${name}_INVALID`);
  return new Date(epoch).toISOString();
};
async function main():Promise<void>{
  const connectionString=process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_CONNECTION_NOT_CONFIGURED');
  const featureSetVersion=value('--feature-set-version')??'theta-r6-feature-set-v1';
  const pool=new Pool({connectionString,max:2});
  try {
  const exporter=new PostgresDatasetExporter(pool);
  const newest=args.includes('--latest')||(!args.includes('--from')&&!args.includes('--to'))
    ? await exporter.newestEvidenceWindow() : null;
  const start=parsedDate(value('--from'),'EXPORT_FROM')??newest?.start??null;
  const end=parsedDate(value('--to'),'EXPORT_TO')??newest?.end??null;
  if (start===null||end===null) throw new Error('NO_POINT_IN_TIME_EVIDENCE_TO_EXPORT');
  const exportedAt=new Date().toISOString();
  const artifact=await exporter.export({start,end,exportedAt,featureSetVersion});
  if (artifact.rowCounts.candidates===0) throw new Error('NO_POINT_IN_TIME_EVIDENCE_IN_WINDOW');
  const readiness=await buildR6ReadinessReceipt(pool);
  const root=resolve('research_exports');
  const destination=resolve(root,artifact.datasetHash);
  const latest=resolve(root,'latest');
  const manifest={schemaVersion:artifact.schemaVersion,datasetHash:artifact.datasetHash,
    sourceWindow:artifact.sourceWindow,exportedAt:artifact.exportedAt,featureSetVersion:artifact.featureSetVersion,
    strategyVersions:artifact.strategyVersions,rowCounts:artifact.rowCounts};
  const handoff=buildResearchHandoff({artifact,exportPath:resolve(destination,'dataset.json'),
    manifestPath:resolve(destination,'manifest.json')});
  await mkdir(destination,{recursive:true});
  await writeFile(resolve(destination,'dataset.json'),`${JSON.stringify(artifact,null,2)}\n`,'utf8');
  await writeFile(resolve(destination,'manifest.json'),`${JSON.stringify(manifest,null,2)}\n`,'utf8');
  await writeFile(resolve(destination,'data-quality.json'),`${JSON.stringify(readiness,null,2)}\n`,'utf8');
  await writeFile(resolve(destination,'handoff.json'),`${JSON.stringify(handoff,null,2)}\n`,'utf8');
  await rm(latest,{recursive:true,force:true});
  await mkdir(latest,{recursive:true});
  await Promise.all([
    writeFile(resolve(latest,'dataset.json'),`${JSON.stringify(artifact,null,2)}\n`,'utf8'),
    writeFile(resolve(latest,'manifest.json'),`${JSON.stringify(manifest,null,2)}\n`,'utf8'),
    writeFile(resolve(latest,'data-quality.json'),`${JSON.stringify(readiness,null,2)}\n`,'utf8'),
    writeFile(resolve(latest,'handoff.json'),`${JSON.stringify(handoff,null,2)}\n`,'utf8'),
  ]);
  process.stdout.write(`${JSON.stringify({state:'EXPORTED',datasetHash:artifact.datasetHash,
    sourceWindow:artifact.sourceWindow,rowCounts:artifact.rowCounts,latest:'research_exports/latest',
    readiness:{pointInTimeDataset:readiness.POINT_IN_TIME_DATASET_READY,shadowCapture:readiness.SHADOW_CAPTURE_READY,
      wholeChainLabels:readiness.WHOLE_CHAIN_LABELS_READY,managementLabels:readiness.MANAGEMENT_LABELS_READY,
      executionReplay:readiness.EXECUTION_REPLAY_READY,datasetExport:readiness.DATASET_EXPORT_READY},
    dataQuality:{completeScans:readiness.dataQuality.completeScans,partialScans:readiness.dataQuality.partialScans,
      missedObservations:readiness.dataQuality.missedObservations,providerFailures:readiness.dataQuality.providerFailures,
      invalidQuotes:readiness.dataQuality.invalidQuotes,staleCandidates:readiness.dataQuality.staleCandidates,
      resolvedLabels:readiness.dataQuality.resolvedLabels,unresolvedLabels:readiness.dataQuality.unresolvedLabels}})}\n`);
  } finally { await pool.end(); }
}

try { await main(); }
catch(error){
  const code=error instanceof Error?error.message:'RESEARCH_EXPORT_FAILED';
  process.stdout.write(`${JSON.stringify({state:'BLOCKED',code})}\n`);
  process.exitCode=2;
}
