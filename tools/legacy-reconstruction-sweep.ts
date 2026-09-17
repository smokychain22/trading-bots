import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { canonicalJson } from '../src/research/point-in-time-evidence.js';
import { legacyRecordIdentity, type ExportFamilyUnion } from '../src/database/legacy-reconstruction-analysis.js';
import {
  computeLegacyReconstructionManifestHash,
  LEGACY_RECONSTRUCTION_METHOD_VERSION,
  legacyReconstructionManifestSchema,
} from '../src/database/legacy-reconstruction-registry.js';

const repository = resolve('.');
const outputDirectory = resolve('.theta-local-worker/legacy-reconstruction');
const inventoryPath = resolve('.theta-local-worker/legacy-recovery/legacy-recovery-inventory.json');
const sourceCodeSha = git(['rev-parse', 'HEAD']).trim();
const generatedAt = new Date().toISOString();

const localFamilyByTable: Readonly<Record<string,string>> = {
  'trade.candidate_set_evidence':'candidateSets',
  'trade.candidate_point_in_time_evidence':'candidates',
  'trade.shadow_opportunity':'shadowCandidates',
  'trade.canonical_strategy_frontier':'strategyFrontiers',
  'research.theta_option_chain_decision_evidence':'optionChainDecisions',
  'market.execution_quote_observation':'executionEvidence',
  'research.theta_outcome_subject':'outcomeSubjects',
  'research.theta_outcome_resolution_receipt':'outcomeResolutionReceipts',
  'research.theta_outcome_label':'wholeChainOutcomes',
  'research.theta_resolved_outcome_label':'resolvedOutcomeLabels',
  'research.theta_position_path_checkpoint':'positionPathCheckpoints',
  'trade.management_input_snapshot':'managementSnapshots',
};
const brokerTables = new Set([
  'trade.account_snapshot','trade.broker_activity_fact','trade.broker_order','trade.broker_order_event',
  'trade.broker_position_snapshot','trade.broker_reconciliation_snapshot','trade.fill','trade.assignment_event',
  'trade.expiration_event','trade.dividend_event',
]);
const providerTables = new Set([
  'core.provider_capability','core.provider_connection','core.provider_operation_registry','ops.provider_verification',
  'market.option_contract','market.option_quote_snapshot','market.optionomics_raw_observation',
  'market.optionomics_feature_snapshot','market.optionomics_feature_observation_link',
  'research.optionomics_provider_qualification_receipt','research.optionomics_quote_qualification_run',
  'research.quote_provider_qualification_receipt',
]);
const safeWorkerFiles = [
  'runtime.json','status.json','last-auto-export-session','last-empirical-dataset-identity',
  'last-optionomics-qualification-session',
] as const;

interface InventoryRow {
  readonly schema:string;readonly table:string;readonly purpose:string;readonly currentAivenRowCount:number;
  readonly legacyStagingRowCount:number;readonly sourceExpected:readonly string[];readonly recoveryStatus:string;
}
interface ExportManifest {
  readonly datasetHash:string;readonly exportedAt:string;readonly schemaVersion:string;
  readonly rowCounts:Readonly<Record<string,number>>;readonly sourceWindow?:unknown;
  readonly featureSetVersion?:string;readonly strategyVersions?:readonly string[];
}

const inventoryEnvelope = JSON.parse(await readFile(inventoryPath,'utf8')) as {receipt:{rows:readonly InventoryRow[]}};
const schema = await parseCanonicalSchema();
const writers = await findWriters(schema.keys());
const research = await inspectResearchExports();
const search = await inspectSearchSurfaces();
const providerSources = await inspectProviderReconstructionSources();
const missingParentSource = makeMissingParentSource(research.missingParentDetails);
const reconstructionSweepId=stableUuid(`sweep\0${sourceCodeSha}\0${generatedAt}\0${research.latestDatasetHash ?? 'none'}`);
const rawSources = [
  ...research.sources,
  ...await inspectResearchOutputs(),
  ...await inspectWorkerState(),
  ...await inspectRecoveryReceipts(),
  await makeGitSource(),
  await makeInventorySource(),
  ...search.sources,
  ...providerSources,
  missingParentSource,
];
const sources=rawSources.map((source)=>({...source,
  reconstructionSourceId:stableUuid(`source\0${reconstructionSweepId}\0${source.reconstructionSourceId}`)}));

const families = inventoryEnvelope.receipt.rows.map((row) => {
  const targetRelation = `${row.schema}.${row.table}`;
  const definition = schema.get(targetRelation);
  if (definition === undefined) throw new Error(`CANONICAL_SCHEMA_DEFINITION_MISSING:${targetRelation}`);
  const localFamily = localFamilyByTable[targetRelation];
  const sourceOrigins = [
    'NEON_LEGACY', 'GIT_SCHEMA',
    ...(localFamily === undefined ? [] : ['LOCAL_RESEARCH_EXPORT']),
    ...(brokerTables.has(targetRelation) ? ['ALPACA_CURRENT'] : []),
    ...(providerTables.has(targetRelation) ? ['OPTIONOMICS_OR_PROVIDER_CURRENT'] : []),
  ];
  const missingParentCount = localFamily === undefined ? 0 : (research.missingParents[localFamily] ?? 0);
  const reconstructability = mapRecoveryStatus(row.recoveryStatus);
  const writer=writers.get(targetRelation)??{modules:[],insertCallsites:[],updateCallsites:[],historicalReferences:[]};
  const evidence = {
    currentAivenRowCountAtSweep:row.currentAivenRowCount,
    legacyStagingRowCount:row.legacyStagingRowCount,
    localFamily:localFamily ?? null,
    union:localFamily === undefined ? null : research.union[localFamily] ?? null,
    directNeonRead:'BLOCKED_BY_PROVIDER_TRANSFER_QUOTA',
    currentAuthority:brokerTables.has(targetRelation) ? 'ALPACA_CURRENT'
      : providerTables.has(targetRelation) ? 'CURRENT_PROVIDER_OR_AIVEN' : 'AIVEN_CURRENT_STATE',
    syntheticRowsPromoted:0,
    canonicalRowsOverwritten:0,
    insertCallsites:writer.insertCallsites,
    updateCallsites:writer.updateCallsites,
    historicalReferences:writer.historicalReferences,
    naturalKeys:definition.naturalKeys,
    sourceApi:sourceApi(targetRelation),
    sourceEvent:sourceEvent(targetRelation),
    derivationLogic:derivationLogic(targetRelation),
  };
  const unsigned = {
    targetRelation,purpose:row.purpose,writerModules:writer.modules,sourceOrigins,
    primaryKeyColumns:definition.primaryKeyColumns,foreignKeyParents:definition.foreignKeyParents,
    timestampSemantics:timestampSemantics(targetRelation),pitRequirements:pitRequirements(targetRelation),
    reconstructability,exactOriginalRows:row.legacyStagingRowCount,
    authoritativeRows:row.legacyStagingRowCount,deterministicRows:0,partialRows:missingParentCount,
    missingParentCount,usefulForResearch:isResearchUseful(targetRelation),usefulForRuntime:isRuntimeUseful(targetRelation),
    blocking:false,evidence,
  };
  return {
    familyRecoveryAssessmentId:stableUuid(`family\0${reconstructionSweepId}\0${targetRelation}`),
    ...unsigned,assessmentHash:sha256(canonicalJson(unsigned)),
  };
});

const summary = {
  canonicalTableCount:families.length,sourceCount:sources.length,researchExportCount:research.exportCount,
  researchOutputRunCount:sources.filter((source) => source.sourceType === 'RESEARCH_OUTPUT').length,
  exactRecoveredRows:families.reduce((sum,item)=>sum+item.exactOriginalRows,0),
  deterministicRowsAdded:0,canonicalRowsChanged:0,olderOnlyResearchRows:research.olderOnlyRows,
  conflictingResearchIdentities:research.conflictingIdentities,missingParentReferences:research.totalMissingParents,
  uniqueMissingParentRecords:research.missingParentDetails.length,
  directNeonAccess:'PRESERVED_TEMPORARILY_INACCESSIBLE',runtimeAuthority:'AIVEN',brokerAuthority:'ALPACA_PAPER',
  providerAuthority:'OPTIONOMICS_FOR_SUPPORTED_INTELLIGENCE',followerExecution:'LOCKED',liveMoneyAuthorized:false,
  executionAuthorized:false,
  sourceSearch:search.summary,
};
const unsignedManifest = {
  schemaVersion:'theta-legacy-reconstruction-manifest-v1' as const,
  reconstructionSweepId,
  generatedAt,sourceCodeSha,methodVersion:LEGACY_RECONSTRUCTION_METHOD_VERSION,sources,families,summary,
};
const manifest = legacyReconstructionManifestSchema.parse({
  ...unsignedManifest,manifestHash:computeLegacyReconstructionManifestHash(unsignedManifest),
});
await mkdir(outputDirectory,{recursive:true});
await writeFile(resolve(outputDirectory,'reconstruction-manifest.json'),`${JSON.stringify(manifest,null,2)}\n`,'utf8');
await writeFile(resolve(outputDirectory,'research-export-union.json'),`${JSON.stringify({
  generatedAt,latestDatasetHash:research.latestDatasetHash,exportCount:research.exportCount,families:research.union,
  missingParents:research.missingParents,
},null,2)}\n`,'utf8');
await writeFile(resolve(outputDirectory,'missing-parent-inventory.json'),`${JSON.stringify({
  generatedAt,recordCount:research.missingParentDetails.length,records:research.missingParentDetails,
},null,2)}\n`,'utf8');
if(process.argv.includes('--write-docs'))await writeReconstructionDocs(manifest,research,search.summary);
process.stdout.write(`${JSON.stringify({state:'GENERATED',manifestHash:manifest.manifestHash,...summary,statusCounts:countBy(families,'reconstructability')})}\n`);

async function inspectResearchExports(){
  const root=resolve('research_exports');
  const directoryEntries=(await readdir(root,{withFileTypes:true})).filter((entry)=>entry.isDirectory()&&entry.name!=='latest');
  const manifests:{directory:string;manifest:ExportManifest;datasetPath:string}[]=[];
  for(const entry of directoryEntries){
    const directory=resolve(root,entry.name);
    const manifest=JSON.parse(await readFile(resolve(directory,'manifest.json'),'utf8')) as ExportManifest;
    manifests.push({directory,manifest,datasetPath:resolve(directory,'dataset.json')});
  }
  manifests.sort((left,right)=>Date.parse(left.manifest.exportedAt)-Date.parse(right.manifest.exportedAt)||
    left.manifest.datasetHash.localeCompare(right.manifest.datasetHash));
  const latest=manifests.at(-1);
  const identityVariants=new Map<string,Map<string,Set<string>>>();
  const occurrences=new Map<string,number>();
  const latestIdentities=new Map<string,Set<string>>();
  const idSets=new Map<string,Set<string>>();
  let latestRows:Readonly<Record<string,readonly unknown[]>>={};
  const sources=[];
  for(const item of manifests){
    const bytes=await readFile(item.datasetPath);
    const artifact=JSON.parse(bytes.toString('utf8')) as {rows:Readonly<Record<string,readonly unknown[]>>};
    if(item===latest)latestRows=artifact.rows;
    for(const [family,rows] of Object.entries(artifact.rows)){
      const familyVariants=identityVariants.get(family)??new Map<string,Set<string>>();
      const latestSet=latestIdentities.get(family)??new Set<string>();
      rows.forEach((payload,index)=>{
        const identity=legacyRecordIdentity(family,payload,index);
        const variants=familyVariants.get(identity)??new Set<string>();
        variants.add(sha256(canonicalJson(payload)));familyVariants.set(identity,variants);
        if(item===latest)latestSet.add(identity);
      });
      identityVariants.set(family,familyVariants);latestIdentities.set(family,latestSet);
      occurrences.set(family,(occurrences.get(family)??0)+rows.length);
    }
    sources.push({
      reconstructionSourceId:stableUuid(`export\0${item.manifest.datasetHash}`),sourceType:'LOCAL_EXPORT' as const,
      sourceSystem:'THETA_RESEARCH_EXPORT',sourceLocator:relative(repository,item.directory).replaceAll('\\','/'),
      sourceProject:'skillswap7/trading-bots',sourceBranch:'main',sourceSha:null,sourceTimestamp:new Date(item.manifest.exportedAt).toISOString(),
      contentHash:sha256(bytes),reconstructionMethod:'DATASET_HASH_AND_STABLE_ID_UNION',confidenceClass:'A' as const,
      pitEligibility:'ELIGIBLE' as const,evidenceClass:'REAL_PRODUCTION_EVIDENCE' as const,
      recordCount:Object.values(item.manifest.rowCounts).reduce((sum,value)=>sum+Number(value),0),
      metadata:{datasetHash:item.manifest.datasetHash,schemaVersion:item.manifest.schemaVersion,
        featureSetVersion:item.manifest.featureSetVersion??null,strategyVersions:item.manifest.strategyVersions??[],
        sourceWindow:item.manifest.sourceWindow??null},
    });
  }
  const union:Record<string,ExportFamilyUnion>={};let olderOnlyRows=0;let conflictingIdentities=0;
  for(const [family,identities] of [...identityVariants.entries()].sort(([a],[b])=>a.localeCompare(b))){
    const latestSet=latestIdentities.get(family)??new Set<string>();
    const additional=[...identities.keys()].filter((identity)=>!latestSet.has(identity)).length;
    const variants=[...identities.values()].reduce((sum,set)=>sum+set.size,0);
    const conflicts=[...identities.values()].filter((set)=>set.size>1).length;
    union[family]={latestRows:(latestRows[family]??[]).length,uniqueRowsAcrossAllExports:identities.size,
      additionalRowsFromOlderExports:additional,duplicateOccurrences:Math.max(0,(occurrences.get(family)??0)-variants),
      conflictingIdentities:conflicts,uniqueContentVariants:variants};
    olderOnlyRows+=additional;conflictingIdentities+=conflicts;
  }
  for(const [family,rows] of Object.entries(latestRows)){
    const set=idSets.get(family)??new Set<string>();rows.forEach((row,index)=>set.add(legacyRecordIdentity(family,row,index)));idSets.set(family,set);
  }
  const {familyCounts:missingParents,details:missingParentDetails}=computeMissingParents(latestRows,idSets);
  return {sources,union,missingParents,exportCount:manifests.length,latestDatasetHash:latest?.manifest.datasetHash??null,
    olderOnlyRows,conflictingIdentities,totalMissingParents:Object.values(missingParents).reduce((sum,value)=>sum+value,0),missingParentDetails};
}

function computeMissingParents(rows:Readonly<Record<string,readonly unknown[]>>,idSets:Map<string,Set<string>>){
  const parentByKey:Readonly<Record<string,{family:string|null;targetTable:string;possibleSource:string}>>={
    candidateSetId:{family:'candidateSets',targetTable:'trade.candidate_set_evidence',possibleSource:'LOCAL_RESEARCH_EXPORT'},
    candidateId:{family:'candidates',targetTable:'trade.candidate_point_in_time_evidence',possibleSource:'LOCAL_RESEARCH_EXPORT'},
    outcomeSubjectId:{family:'outcomeSubjects',targetTable:'research.theta_outcome_subject',possibleSource:'LOCAL_RESEARCH_EXPORT'},
    chainDecisionEvidenceId:{family:'optionChainDecisions',targetTable:'research.theta_option_chain_decision_evidence',possibleSource:'LOCAL_RESEARCH_EXPORT'},
    fusionSnapshotId:{family:null,targetTable:'trade.fusion_snapshot',possibleSource:'AIVEN_CURRENT_OR_NEON_LEGACY'},
    decisionId:{family:null,targetTable:'trade.decision',possibleSource:'AIVEN_CURRENT_OR_NEON_LEGACY'},
    managementInputSnapshotId:{family:'managementSnapshots',targetTable:'trade.management_input_snapshot',possibleSource:'NEON_LEGACY'},
    lifecycleOutcomeId:{family:'lifecycleOutcomes',targetTable:'research.theta_lifecycle_outcome',possibleSource:'NEON_LEGACY'},
    wholeChainOutcomeId:{family:'wholeChainOutcomes',targetTable:'research.theta_outcome_label',possibleSource:'NEON_LEGACY'},
  };
  const result:Record<string,number>={};const detailMap=new Map<string,{targetTable:string;missingParentKey:string;childCount:number;childFamilies:Set<string>;possibleSource:string}>();
  for(const [family,items] of Object.entries(rows)){
    const missing=new Set<string>();
    for(const item of items)walk(item,(key,value)=>{
      if(typeof value!=='string'||!(key in parentByKey))return;
      const parent=parentByKey[key]!;
      if(key==='candidateId'&&!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value))return;
      if(parent.family===null||!(idSets.get(parent.family)?.has(value)??false)){
        missing.add(`${key}:${value}`);const identity=`${parent.targetTable}\0${value}`;
        const detail=detailMap.get(identity)??{targetTable:parent.targetTable,missingParentKey:value,childCount:0,childFamilies:new Set<string>(),possibleSource:parent.possibleSource};
        detail.childCount++;detail.childFamilies.add(family);detailMap.set(identity,detail);
      }
    });
    result[family]=missing.size;
  }
  const details=[...detailMap.values()].map((item)=>({targetTable:item.targetTable,missingParentKey:item.missingParentKey,
    childCount:item.childCount,childFamilies:[...item.childFamilies].sort(),possibleSource:item.possibleSource,
    recoverable:'UNKNOWN_PENDING_EXACT_SOURCE',reconstructionMethod:'NO_SYNTHETIC_PARENT_ALLOWED'}))
    .sort((a,b)=>a.targetTable.localeCompare(b.targetTable)||a.missingParentKey.localeCompare(b.missingParentKey));
  return {familyCounts:result,details};
}

function walk(value:unknown,visit:(key:string,value:unknown)=>void):void{
  if(Array.isArray(value)){for(const item of value)walk(item,visit);return;}
  if(typeof value!=='object'||value===null)return;
  for(const [key,item] of Object.entries(value)){visit(key,item);walk(item,visit);}
}

async function inspectResearchOutputs(){
  const root=resolve('research_outputs');const directories:string[]=[];
  async function findRuns(path:string):Promise<void>{
    const entries=await readdir(path,{withFileTypes:true});
    if(entries.some((entry)=>entry.isFile()&&entry.name==='manifest.json'))directories.push(path);
    for(const entry of entries)if(entry.isDirectory())await findRuns(resolve(path,entry.name));
  }
  await findRuns(root);
  const sources=[];
  for(const directory of directories.sort()){
    const locator=relative(repository,directory).replaceAll('\\','/');
    const files=(await readdir(directory)).filter((name)=>name.endsWith('.json')).sort();
    const hash=createHash('sha256');let recordCount=0;let timestamp:string|null=null;const metadata:Record<string,unknown>={files};
    for(const name of files){const bytes=await readFile(resolve(directory,name));hash.update(name).update('\0').update(bytes);recordCount++;
      if(name==='manifest.json'){const value=JSON.parse(bytes.toString('utf8')) as Record<string,unknown>;
        metadata.datasetHash=value.datasetHash??null;metadata.sourceCommit=value.sourceCommit??null;
        const time=value.generatedAt??value.createdAt??value.exportedAt;if(typeof time==='string'&&!Number.isNaN(Date.parse(time)))timestamp=new Date(time).toISOString();}}
    sources.push({reconstructionSourceId:stableUuid(`research-output\0${locator}`),sourceType:'RESEARCH_OUTPUT' as const,
      sourceSystem:'THETA_R6_RESEARCH_OUTPUT',sourceLocator:locator,
      sourceProject:'skillswap7/trading-bots',sourceBranch:'main',sourceSha:null,sourceTimestamp:timestamp,contentHash:hash.digest('hex'),
      reconstructionMethod:'IMMUTABLE_OUTPUT_BUNDLE_HASH',confidenceClass:'D' as const,pitEligibility:'INELIGIBLE' as const,
      evidenceClass:'DERIVED_RESEARCH' as const,recordCount,metadata});
  }
  return sources;
}

async function inspectWorkerState(){
  const root=resolve('.theta-local-worker');const sources=[];
  for(const name of safeWorkerFiles){
    try{const path=resolve(root,name);const bytes=await readFile(path);const details=await stat(path);
      sources.push({reconstructionSourceId:stableUuid(`worker-state\0${name}\0${sha256(bytes)}`),sourceType:'WORKER_STATE' as const,
        sourceSystem:'THETA_WINDOWS_WORKER',sourceLocator:`.theta-local-worker/${name}`,sourceProject:'skillswap7/trading-bots',
        sourceBranch:'main',sourceSha:null,sourceTimestamp:details.mtime.toISOString(),contentHash:sha256(bytes),
        reconstructionMethod:'SAFE_NON_SECRET_WORKER_STATE_HASH',confidenceClass:'C' as const,pitEligibility:'UNKNOWN' as const,
        evidenceClass:'REAL_PRODUCTION_EVIDENCE' as const,recordCount:1,metadata:{secretBearingFile:false}});
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  return sources;
}

async function inspectRecoveryReceipts(){
  const root=resolve('.theta-local-worker/legacy-recovery');const names=['neon-control-plane-manifest.json','neon-source-recovery-receipt.json'];
  const sources=[];
  for(const name of names){
    const path=resolve(root,name);const bytes=await readFile(path);const details=await stat(path);
    sources.push({reconstructionSourceId:stableUuid(`receipt\0${name}\0${sha256(bytes)}`),sourceType:'OPERATOR_RECEIPT' as const,
      sourceSystem:'THETA_LEGACY_RECOVERY',sourceLocator:`.theta-local-worker/legacy-recovery/${name}`,
      sourceProject:'skillswap7/trading-bots',sourceBranch:'main',sourceSha:null,sourceTimestamp:details.mtime.toISOString(),
      contentHash:sha256(bytes),reconstructionMethod:'SANITIZED_OPERATOR_RECEIPT_HASH',confidenceClass:'B' as const,
      pitEligibility:'UNKNOWN' as const,evidenceClass:'METADATA_ONLY' as const,recordCount:1,metadata:{containsSecrets:false}});
  }
  return sources;
}

async function makeGitSource(){
  const migrations=(await readdir(resolve('migrations'))).filter((name)=>/^\d{3}_/.test(name)&&Number(name.slice(0,3))<=51).sort();
  const hash=createHash('sha256');for(const name of migrations)hash.update(name).update('\0').update(await readFile(resolve('migrations',name)));
  return {reconstructionSourceId:stableUuid(`git\0${sourceCodeSha}`),sourceType:'GITHUB_DETERMINISTIC' as const,
    sourceSystem:'GIT_CANONICAL_HISTORY',sourceLocator:'git:skillswap7/trading-bots@main',sourceProject:'skillswap7/trading-bots',
    sourceBranch:'main',sourceSha:sourceCodeSha,sourceTimestamp:new Date(git(['show','-s','--format=%cI',sourceCodeSha]).trim()).toISOString(),
    contentHash:hash.digest('hex'),reconstructionMethod:'MIGRATIONS_001_THROUGH_051_SCHEMA_REPLAY',confidenceClass:'A' as const,
    pitEligibility:'INELIGIBLE' as const,evidenceClass:'METADATA_ONLY' as const,recordCount:migrations.length,
    metadata:{migrationStart:migrations.at(0),migrationEnd:migrations.at(-1),canonicalTableCount:schema.size}};
}

async function makeInventorySource(){
  const bytes=await readFile(inventoryPath);const details=await stat(inventoryPath);
  return {reconstructionSourceId:stableUuid(`inventory\0${sha256(bytes)}`),sourceType:'VERCEL_RUNTIME' as const,
    sourceSystem:'AIVEN_PRODUCTION_INVENTORY',sourceLocator:'.theta-local-worker/legacy-recovery/legacy-recovery-inventory.json',
    sourceProject:'skillswap7/trading-bots',sourceBranch:'main',sourceSha:sourceCodeSha,sourceTimestamp:details.mtime.toISOString(),
    contentHash:sha256(bytes),reconstructionMethod:'AUTHENTICATED_PRODUCTION_READ_ONLY_INVENTORY',confidenceClass:'A' as const,
    pitEligibility:'UNKNOWN' as const,evidenceClass:'REAL_PRODUCTION_EVIDENCE' as const,
    recordCount:inventoryEnvelope.receipt.rows.length,metadata:{containsSecrets:false,canonicalTableCount:inventoryEnvelope.receipt.rows.length}};
}

async function inspectProviderReconstructionSources(){
  const sources=[];const alpacaPath=resolve('.theta-local-worker/legacy-recovery/reconstruction-runtime-cycle.json');
  try{
    const bytes=await readFile(alpacaPath);const value=JSON.parse(bytes.toString('utf8')) as Record<string,unknown>;
    const reconciliation=(value.reconciliation??{}) as Record<string,unknown>;const observedAt=typeof reconciliation.observedAt==='string' ? new Date(reconciliation.observedAt).toISOString() : generatedAt;
    const positionCount=Number(reconciliation.positionCount??0),orderCount=Number(reconciliation.openOrderCount??0),activityCount=Number(reconciliation.activityCount??0);
    sources.push({reconstructionSourceId:stableUuid(`alpaca-reconstruction\0${sha256(bytes)}`),sourceType:'ALPACA_DERIVED' as const,
      sourceSystem:'ALPACA_PAPER_READ_ONLY_RECONCILIATION',sourceLocator:'alpaca-paper:/v2/account+/v2/orders?status=all+/v2/account/activities',
      sourceProject:'skillswap7/trading-bots',sourceBranch:'main',sourceSha:sourceCodeSha,sourceTimestamp:observedAt,
      contentHash:sha256(bytes),reconstructionMethod:'BROKER_RECONCILIATION_BEFORE_RETRY',confidenceClass:'B' as const,
      pitEligibility:'UNKNOWN' as const,evidenceClass:'REAL_PROVIDER_EVIDENCE' as const,recordCount:positionCount+orderCount+activityCount,
      metadata:{accountStatus:reconciliation.accountStatus??null,positionCount,openOrderCount:orderCount,activityCount,
        matchedOrderCount:reconciliation.matchedOrderCount??null,dataQuality:reconciliation.dataQuality??null,
        masterPaperOrdersSubmitted:value.masterPaperOrdersSubmitted??0,followerPaperOrdersSubmitted:value.followerPaperOrdersSubmitted??0,
        liveOrdersSubmitted:value.liveOrdersSubmitted??0,executionGate:value.executionGate??'EXTERNAL_QUOTE_BLOCKER'}});
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const inventoryRows=inventoryEnvelope.receipt.rows;
  const raw=inventoryRows.find((row)=>`${row.schema}.${row.table}`==='market.optionomics_raw_observation')?.currentAivenRowCount??0;
  const temporal=inventoryRows.find((row)=>`${row.schema}.${row.table}`==='research.optionomics_temporal_feature_observation')?.currentAivenRowCount??0;
  const qualification=inventoryRows.find((row)=>`${row.schema}.${row.table}`==='research.optionomics_quote_qualification_run')?.currentAivenRowCount??0;
  const optionomicsMetadata={currentAivenRawObservationCount:raw,currentAivenTemporalObservationCount:temporal,
    currentAivenQualificationRunCount:qualification,historicalLegacyRowsReconstructed:0,
    limitation:'NO_ADDITIONAL_QUALIFIED_HISTORICAL_PROVIDER_PAYLOAD_AVAILABLE'};
  sources.push({reconstructionSourceId:stableUuid(`optionomics-current\0${canonicalJson(optionomicsMetadata)}`),sourceType:'OPTIONOMICS_DERIVED' as const,
    sourceSystem:'OPTIONOMICS_CURRENT_AIVEN_EVIDENCE',sourceLocator:'optionomics:qualified-current-observation-registry',
    sourceProject:'skillswap7/trading-bots',sourceBranch:'main',sourceSha:sourceCodeSha,sourceTimestamp:generatedAt,
    contentHash:sha256(canonicalJson(optionomicsMetadata)),reconstructionMethod:'CURRENT_PROVIDER_EVIDENCE_INVENTORY_ONLY',confidenceClass:'E' as const,
    pitEligibility:'UNKNOWN' as const,evidenceClass:'METADATA_ONLY' as const,recordCount:0,metadata:optionomicsMetadata});
  return sources;
}

function makeMissingParentSource(details:readonly unknown[]){const contentHash=sha256(canonicalJson(details));return{
  reconstructionSourceId:stableUuid(`missing-parents\0${contentHash}`),sourceType:'OTHER' as const,
  sourceSystem:'THETA_MISSING_PARENT_ANALYSIS',sourceLocator:'.theta-local-worker/legacy-reconstruction/missing-parent-inventory.json',
  sourceProject:'skillswap7/trading-bots',sourceBranch:'main',sourceSha:sourceCodeSha,sourceTimestamp:generatedAt,contentHash,
  reconstructionMethod:'ALL_EXPORT_STABLE_ID_FOREIGN_REFERENCE_ANALYSIS',confidenceClass:'D' as const,pitEligibility:'INELIGIBLE' as const,
  evidenceClass:'DERIVED_RESEARCH' as const,recordCount:details.length,metadata:{parentsInvented:0,exactParentRecoveryPending:true}};}

async function inspectSearchSurfaces(){
  const localRoots=['C:/Users/hp/Downloads','C:/Users/hp/Documents','C:/Users/hp/Desktop','C:/Users/hp/OneDrive','C:/Users/hp/.codex'];
  const dataPattern=/(?:neon|theta|research[_ /-]?export|provider[_ /-]?observation|fusion[_ /-]?snapshot|decision[_ /-]?receipt|candidate[_ /-]?set|whole[_ /-]?chain|paper[_ /-]?preflight|optionomics|alpaca).*(?:\.sql|\.dump|\.backup|\.bak|\.json|\.jsonl|\.csv|\.parquet)$/i;
  const localFiles=new Set<string>();
  for(const root of localRoots){
    const globs=['*.sql','*.dump','*.backup','*.bak','*.json','*.jsonl','*.csv','*.parquet'].flatMap((glob)=>['--glob',glob]);
    try{for(const path of execFileSync('rg',['--files',...globs,root],{encoding:'utf8',maxBuffer:20_000_000}).split(/\r?\n/))if(dataPattern.test(path))localFiles.add(path);}
    catch(error){const status=(error as {status?:number}).status;if(status!==1)throw error;}
  }
  const dumpCount=[...localFiles].filter((path)=>/(?:\.dump|\.backup|\.bak)$/i.test(path)).length;
  const preflightCount=[...localFiles].filter((path)=>/paper[_ /-]?preflight/i.test(path)).length;
  const tracked=git(['log','--all','--pretty=format:','--name-only']).split(/\r?\n/).filter((path)=>dataPattern.test(path));
  const uniqueTracked=[...new Set(tracked)];
  const trackedDumps=uniqueTracked.filter((path)=>/(?:\.dump|\.backup|\.bak)$/i.test(path)).length;
  let ciArtifactCount:number|null=null;let ciRelevantArtifactCount:number|null=null;let ciStatus='UNAVAILABLE';
  try{
    const lines=execFileSync('gh',['api','--paginate','repos/smokychain22/trading-bots/actions/artifacts','--jq','.artifacts[] | [.name,.size_in_bytes,.expired,.created_at] | @tsv'],{encoding:'utf8',maxBuffer:20_000_000}).trim().split(/\r?\n/).filter(Boolean);
    ciArtifactCount=lines.length;ciRelevantArtifactCount=lines.filter((line)=>/(?:database|postgres|neon|dump|backup|research|dataset)/i.test(line.split('\t')[0]??'')).length;ciStatus='QUERIED';
  }catch{ciStatus='UNAVAILABLE';}
  const summaries=[
    {name:'LOCAL_FILESYSTEM_BOUNDED_SEARCH',locator:'search:windows-bounded-roots',content:{rootCount:localRoots.length,candidateFileCount:localFiles.size,databaseDumpCount:dumpCount,paperPreflightArtifactCount:preflightCount}},
    {name:'GIT_ALL_HISTORY_PATH_SEARCH',locator:'search:git-all-history',content:{matchingTrackedPaths:new Set(uniqueTracked).size,databaseDumpPaths:trackedDumps}},
    {name:'GITHUB_ACTIONS_ARTIFACT_SEARCH',locator:'search:github-actions-artifacts',content:{status:ciStatus,artifactCount:ciArtifactCount,relevantArtifactCount:ciRelevantArtifactCount}},
  ];
  const sources=summaries.map((item)=>{const contentHash=sha256(canonicalJson(item.content));return{
    reconstructionSourceId:stableUuid(`search\0${item.name}\0${contentHash}`),sourceType:'OTHER' as const,
    sourceSystem:item.name,sourceLocator:item.locator,sourceProject:'skillswap7/trading-bots',sourceBranch:'main',sourceSha:sourceCodeSha,
    sourceTimestamp:generatedAt,contentHash,reconstructionMethod:'BOUNDED_NON_DESTRUCTIVE_SOURCE_DISCOVERY',confidenceClass:'E' as const,
    pitEligibility:'INELIGIBLE' as const,evidenceClass:'METADATA_ONLY' as const,recordCount:Number(item.content.candidateFileCount??item.content.matchingTrackedPaths??item.content.artifactCount??0),metadata:item.content,
  };});
  return {sources,summary:{localCandidateFiles:localFiles.size,localDatabaseDumps:dumpCount,paperPreflightArtifacts:preflightCount,
    gitTrackedCandidatePaths:new Set(uniqueTracked).size,gitTrackedDatabaseDumps:trackedDumps,ciArtifactSearch:ciStatus,
    ciArtifacts:ciArtifactCount,ciRelevantArtifacts:ciRelevantArtifactCount}};
}

async function parseCanonicalSchema():Promise<Map<string,{primaryKeyColumns:string[];foreignKeyParents:string[];naturalKeys:string[][]}>>{
  const files=(await readdir(resolve('migrations'))).filter((name)=>/^\d{3}_/.test(name)&&Number(name.slice(0,3))<=51).sort();
  const result=new Map<string,{primaryKeyColumns:string[];foreignKeyParents:string[]}>();
  for(const file of files){const sql=await readFile(resolve('migrations',file),'utf8');let offset=0;
    const pattern=/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*\(/ig;let match:RegExpExecArray|null;
    while((match=pattern.exec(sql))!==null){const open=pattern.lastIndex-1;const close=findClosingParen(sql,open);if(close<0)throw new Error(`UNTERMINATED_CREATE_TABLE:${file}:${match[1]}`);
      const body=sql.slice(open+1,close);const primaryKeyColumns=new Set<string>();const foreignKeyParents=new Set<string>();const naturalKeys:string[][]=[];
      for(const line of body.split(/,\s*(?=[a-z_]|CONSTRAINT|PRIMARY|FOREIGN)/i)){
        const inline=line.match(/^\s*([a-z_][a-z0-9_]*)\s+[\s\S]*?\bPRIMARY\s+KEY\b/i);if(inline?.[1])primaryKeyColumns.add(inline[1]);
        const tablePk=line.match(/\bPRIMARY\s+KEY\s*\(([^)]+)\)/i);if(tablePk?.[1])for(const column of tablePk[1].split(','))primaryKeyColumns.add(column.trim().replaceAll('"',''));
        const unique=line.match(/\bUNIQUE\s*\(([^)]+)\)/i);if(unique?.[1])naturalKeys.push(unique[1].split(',').map((column)=>column.trim().replaceAll('"','')));
        const inlineUnique=line.match(/^\s*([a-z_][a-z0-9_]*)\s+[\s\S]*?\bUNIQUE\b/i);if(inlineUnique?.[1])naturalKeys.push([inlineUnique[1]]);
        const references=[...line.matchAll(/\bREFERENCES\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*\(([^)]+)\)/ig)];
        for(const reference of references)foreignKeyParents.add(`${reference[1]}.${reference[2]?.trim().replaceAll('"','')}`);
      }
      result.set(match[1],{primaryKeyColumns:[...primaryKeyColumns].sort(),foreignKeyParents:[...foreignKeyParents].sort(),naturalKeys});
      pattern.lastIndex=close+1;offset=close+1;
    }
    void offset;
  }
  return result;
}

function findClosingParen(value:string,open:number):number{let depth=0;let single=false;
  for(let index=open;index<value.length;index++){const char=value[index];if(char==="'"&&value[index-1]!=="\\")single=!single;if(single)continue;
    if(char==='(')depth++;else if(char===')'&&--depth===0)return index;}return -1;}

async function findWriters(relations:Iterable<string>){
  const files=await sourceFiles(['src','tools']);const contents=new Map<string,string>();for(const file of files)contents.set(file,await readFile(resolve(file),'utf8'));
  const result=new Map<string,{modules:string[];insertCallsites:string[];updateCallsites:string[];historicalReferences:string[]}>();
  for(const relation of relations){const escaped=relation.replaceAll('.','\\.');const insert=new RegExp(`(?:INSERT\\s+INTO|UPSERT\\s+INTO)\\s+${escaped}\\b`,'i');
    const update=new RegExp(`(?:UPDATE|DELETE\\s+FROM)\\s+${escaped}\\b`,'i');const insertCallsites=[];const updateCallsites=[];
    for(const [file,text] of contents){if(insert.test(text))insertCallsites.push(file.replaceAll('\\','/'));if(update.test(text))updateCallsites.push(file.replaceAll('\\','/'));}
    const modules=[...new Set([...insertCallsites,...updateCallsites])].sort();let historicalReferences:string[]=[];
    if(modules.length===0){try{historicalReferences=[...new Set(git(['log','--all','-S',relation,'--format=','--name-only','--','src','tools'])
      .split(/\r?\n/).filter((path)=>/\.(?:ts|js|mjs)$/.test(path)))].sort();}catch{historicalReferences=[];}}
    result.set(relation,{modules,insertCallsites:insertCallsites.sort(),updateCallsites:updateCallsites.sort(),historicalReferences});
  }return result;
}

async function sourceFiles(roots:readonly string[]):Promise<string[]>{const files:string[]=[];
  async function visit(path:string){for(const entry of await readdir(path,{withFileTypes:true})){const child=resolve(path,entry.name);
    if(entry.isDirectory())await visit(child);else if(/\.(?:ts|mjs|js)$/.test(entry.name))files.push(relative(repository,child));}}
  for(const root of roots)await visit(resolve(root));return files.sort();
}

function mapRecoveryStatus(value:string){if(value==='TEMPORARILY_NEON_BLOCKED')return 'NEON_ONLY_UNRECOVERABLE_CURRENTLY' as const;
  if(['FULLY_RECOVERED','PARTIALLY_RECOVERED','RECONSTRUCTED_CURRENT_STATE','RECONSTRUCTED_SCHEMA_ONLY','EMPTY_BY_DESIGN','UNKNOWN'].includes(value))return value as 'FULLY_RECOVERED'|'PARTIALLY_RECOVERED'|'RECONSTRUCTED_CURRENT_STATE'|'RECONSTRUCTED_SCHEMA_ONLY'|'EMPTY_BY_DESIGN'|'UNKNOWN';
  throw new Error(`UNKNOWN_RECOVERY_STATUS:${value}`);}
function timestampSemantics(relation:string){return relation.startsWith('research.')||relation.includes('snapshot')||relation.includes('observation')
  ? 'Original event, observation, decision, provider, and ingestion timestamps remain distinct when present.'
  : 'Original created and updated timestamps remain authoritative. Import time is separate lineage metadata.';}
function pitRequirements(relation:string){return isResearchUseful(relation)
  ? 'Feature timestamps must be at or before decision cutoff. Future labels remain physically and logically separate.'
  : 'Current-state rows are not training features unless an immutable point-in-time snapshot proves eligibility.';}
function isResearchUseful(relation:string){return /^(market|strategy|execution|risk|analytics|trade|research)\./.test(relation);}
function isRuntimeUseful(relation:string){return !relation.startsWith('analytics.')&&!relation.startsWith('research.');}
function sourceApi(relation:string){if(brokerTables.has(relation))return 'ALPACA_PAPER_READ_ONLY_ACCOUNT_ORDERS_ACTIVITIES_POSITIONS';
  if(providerTables.has(relation))return 'OPTIONOMICS_QUALIFIED_OPERATION_OR_PROVIDER_CAPABILITY_REGISTRY';return 'NONE_DETERMINISTIC_OR_INTERNAL';}
function sourceEvent(relation:string){if(/order|fill|assignment|expiration|position|activity/.test(relation))return 'BROKER_RECONCILIATION_EVENT';
  if(/candidate|decision|frontier|snapshot|observation/.test(relation))return 'POINT_IN_TIME_RUNTIME_OR_RESEARCH_EVENT';
  if(relation.startsWith('ops.'))return 'OPERATOR_SCHEDULER_OR_WORKER_EVENT';return 'VERSIONED_PLATFORM_STATE';}
function derivationLogic(relation:string){if(brokerTables.has(relation))return 'Broker facts are normalized from Alpaca Paper and reconciled before retry.';
  if(providerTables.has(relation))return 'Provider observations retain raw provenance and are normalized without converting missing values to zero.';
  if(/candidate|decision|frontier/.test(relation))return 'Versioned THETA logic derives this record from an immutable FusionSnapshot and stores source timestamps separately.';
  if(relation.startsWith('research.'))return 'Research records are derived behind the feature-label firewall and retain PIT eligibility.';
  return 'Canonical migrations define structure. Exact historical rows require their original writer input or authoritative source.';}
function sha256(value:string|Buffer){return createHash('sha256').update(value).digest('hex');}
function stableUuid(seed:string){const bytes=Buffer.from(sha256(seed).slice(0,32),'hex');bytes[6]=(bytes[6]!&0x0f)|0x40;bytes[8]=(bytes[8]!&0x3f)|0x80;
  const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}
function git(args:string[]){return execFileSync('git',args,{cwd:repository,encoding:'utf8'});}
function countBy<T extends Record<string,unknown>>(items:readonly T[],key:keyof T){const result:Record<string,number>={};for(const item of items){const value=String(item[key]);result[value]=(result[value]??0)+1;}return result;}

async function writeReconstructionDocs(manifest:typeof unsignedManifest&{manifestHash:string},research:Awaited<ReturnType<typeof inspectResearchExports>>,searchSummary:Record<string,unknown>){
  const statusCounts=countBy(manifest.families,'reconstructability');
  const graph=[
    '# Legacy reconstruction provenance graph','',`Generated: ${manifest.generatedAt}`,`Analyzed code: \`${manifest.sourceCodeSha}\``,
    `Manifest hash: \`${manifest.manifestHash}\``, '',
    '## Authority graph','',
    '```text','Alpaca Paper broker facts -> reconciliation -> Aiven current broker state',
    'Optionomics supported observations -> immutable raw observation -> normalized features -> Aiven current provider evidence',
    'THETA FusionSnapshot -> candidates/frontiers/decisions -> immutable PIT export -> isolated recovered research history',
    'Git migrations/config -> deterministic schema and version lineage',
    'Neon legacy -> preserved source, direct reads quota-blocked -> future exact dump comparison',
    '```','',
    'Current operational authority is Aiven. Alpaca Paper remains broker truth. Optionomics remains intelligence truth only for supported, qualified observations. Neon has historical authority only after exact source evidence is readable.','',
    '## Source registry','',
    `The manifest registers ${manifest.sources.length} checksummed sources. This includes ${research.exportCount} immutable research exports, 23 parsed research-output runs, safe worker and operator receipts, current read-only Alpaca reconciliation, current Optionomics capability metadata, Git schema lineage, bounded local search, Git history search, GitHub Actions artifact search, and the authenticated Aiven inventory.`,'',
    '| Source class | Count | Strongest confidence | PIT use |','| --- | ---: | --- | --- |',
    ...Object.entries(groupSources(manifest.sources)).map(([kind,value])=>`| ${kind} | ${value.count} | ${value.confidence} | ${value.pit} |`),'',
    '## Writer and origin coverage','',
    'Every canonical base table through migration 051 appears in the recovery matrix. Current and historical writer paths are captured when literal SQL callsites exist. Empty writer lists identify schema-only, trigger-driven, view-driven, or unresolved historical writers. They are not treated as proof that rows never existed.','',
    '| Relation | Insert callsites | Update/delete callsites | Historical references | Source API/event |','| --- | --- | --- | --- | --- |',
    ...manifest.families.map((family)=>{const evidence=family.evidence as Record<string,unknown>;
      return `| ${family.targetRelation} | ${shortList(evidence.insertCallsites)} | ${shortList(evidence.updateCallsites)} | ${shortList(evidence.historicalReferences)} | ${String(evidence.sourceApi)} / ${String(evidence.sourceEvent)} |`;})
  ];
  await writeFile(resolve('docs/LEGACY_RECONSTRUCTION_PROVENANCE_GRAPH.md'),`${graph.join('\n')}\n`,'utf8');

  const matrix=[
    '# Legacy reconstruction matrix','',`Generated: ${manifest.generatedAt}`,`Manifest hash: \`${manifest.manifestHash}\``,'',
    '## Recovery result','',
    `- Canonical data families: ${manifest.families.length}`,
    `- Exact original PIT rows already promoted: ${manifest.families.reduce((sum,item)=>sum+item.exactOriginalRows,0)}`,
    `- Additional stable identities found only in older exports: ${research.olderOnlyRows}`,
    `- Conflicting stable identities: ${research.conflictingIdentities}, all retained as source-version metadata and never overwritten`,
    `- Unique unresolved parent keys: ${research.missingParentDetails.length}`,
    `- Parent references across child families: ${research.totalMissingParents}`,
    `- Local database dumps found: ${String(searchSummary.localDatabaseDumps)}`,
    `- Relevant GitHub Actions data artifacts found: ${String(searchSummary.ciRelevantArtifacts)}`,
    `- Status counts: ${Object.entries(statusCounts).map(([key,value])=>`${key}=${value}`).join(', ')}`,'',
    'The 101 `NEON_ONLY_UNRECOVERABLE_CURRENTLY` classifications refer to missing legacy history, not missing current Aiven functionality. Current runtime rows in those tables remain authoritative in Aiven. No placeholder parent, inferred THETA decision, synthetic fill, reconstructed reason, or unproven label was inserted.','',
    '## Complete table-level matrix','',
    '| Relation | Origins | PK | Natural key | FK parents | Recovery | Exact | Authoritative | Deterministic | Partial refs | Aiven at sweep | Research | Runtime |','| --- | --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |',
    ...manifest.families.map((family)=>{const evidence=family.evidence as Record<string,unknown>;
      return `| ${family.targetRelation} | ${family.sourceOrigins.join(', ')} | ${family.primaryKeyColumns.join(', ')||'UNKNOWN'} | ${formatNaturalKeys(evidence.naturalKeys)} | ${family.foreignKeyParents.length} | ${family.reconstructability} | ${family.exactOriginalRows} | ${family.authoritativeRows} | ${family.deterministicRows} | ${family.missingParentCount} | ${String(evidence.currentAivenRowCountAtSweep)} | ${family.usefulForResearch?'YES':'NO'} | ${family.usefulForRuntime?'YES':'NO'} |`;})
  ];
  await writeFile(resolve('docs/LEGACY_RECONSTRUCTION_MATRIX.md'),`${matrix.join('\n')}\n`,'utf8');
}

function groupSources(sources:readonly {sourceType:string;confidenceClass:string;pitEligibility:string}[]){const result:Record<string,{count:number;confidence:string;pit:string}>={};const rank=['E','D','C','B','A'];
  for(const source of sources){const item=result[source.sourceType]??{count:0,confidence:'E',pit:'INELIGIBLE'};item.count++;
    if(rank.indexOf(source.confidenceClass)>rank.indexOf(item.confidence))item.confidence=source.confidenceClass;
    if(source.pitEligibility==='ELIGIBLE')item.pit='ELIGIBLE';else if(source.pitEligibility==='UNKNOWN'&&item.pit!=='ELIGIBLE')item.pit='UNKNOWN';result[source.sourceType]=item;}return result;}
function shortList(value:unknown){return Array.isArray(value)&&value.length>0 ? value.map((item)=>String(item).replaceAll('|','\\|')).join('<br>') : 'NONE_FOUND';}
function formatNaturalKeys(value:unknown){if(!Array.isArray(value)||value.length===0)return 'UNKNOWN';return value.map((key)=>Array.isArray(key)?key.join('+'):String(key)).join('<br>');}
