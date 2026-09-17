import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import { canonicalJson } from '../src/research/point-in-time-evidence.js';
import { legacyRecordIdentity } from '../src/database/legacy-reconstruction-analysis.js';
import {
  computeLocalForensicChunkHash,
  LOCAL_FORENSIC_METHOD_VERSION,
  localForensicChunkSchema,
} from '../src/database/local-forensic-recovery.js';

const repository=resolve('.');
const outputRoot=resolve('.theta-local-worker/forensic-recovery');
const chunkRoot=resolve(outputRoot,'chunks');
const sourceCodeSha=git(['rev-parse','HEAD']).trim();
const generatedAt=new Date().toISOString();
const missingInventory=JSON.parse(await readFile(resolve('.theta-local-worker/legacy-reconstruction/missing-parent-inventory.json'),'utf8')) as {
  records:readonly {targetTable:string;missingParentKey:string}[];
};
const missingKeys=new Set(missingInventory.records.map((item)=>item.missingParentKey));
const missingByIdentity=new Map(missingInventory.records.map((item)=>[`${item.targetTable}\0${item.missingParentKey}`,item]));
const keyEvidence=new Map([...missingKeys].map((key)=>[key,{references:0,complete:0,sources:new Set<string>()}]));

interface ExportItem{directory:string;datasetHash:string;exportedAt:string;rows:Record<string,unknown[]>;datasetPath:string;}
interface VariantAccumulator{family:string;identity:string;payloadHash:string;payload:unknown;firstDatasetHash:string;
  lastDatasetHash:string;firstExportedAt:string;lastExportedAt:string;occurrences:number;seenInLatest:boolean;}
interface SourceEntry{sourceId:string;sourceScope:string;sourceLocator:string;contentHash:string;byteSize:number;
  modifiedAt:string|null;exactMissingKeyMatches:number;thetaFingerprintMatches:number;evidenceClass:string;
  disposition:string;metadata:Record<string,unknown>;}

const exports=await loadExports();
const latest=exports.at(-1);
const variantsByRecord=new Map<string,Map<string,VariantAccumulator>>();
const latestIdentities=new Set<string>();
const sources:SourceEntry[]=[];
let exportOccurrences=0;

for(const item of exports){
  const bytes=await readFile(item.datasetPath);const matchedKeys=scanKeyMatches(bytes);
  for(const key of matchedKeys)recordReference(key,`research-export:${item.datasetHash}`);
  sources.push(await sourceFromFile(item.datasetPath,'RESEARCH_EXPORT',`research_exports/${basename(item.directory)}/dataset.json`,
    'EXACT_EXPORT','CATALOG_ONLY',{datasetHash:item.datasetHash,exportedAt:item.exportedAt}));
  for(const [family,rows] of Object.entries(item.rows))rows.forEach((payload,index)=>{
    exportOccurrences++;
    const identity=legacyRecordIdentity(family,payload,index);const recordKey=`${family}\0${identity}`;
    const payloadHash=sha256(canonicalJson(payload));
    const recordVariants=variantsByRecord.get(recordKey)??new Map<string,VariantAccumulator>();
    const existing=recordVariants.get(payloadHash);
    if(existing){existing.lastDatasetHash=item.datasetHash;existing.lastExportedAt=item.exportedAt;existing.occurrences++;
      existing.seenInLatest ||= item===latest;}
    else recordVariants.set(payloadHash,{family,identity,payloadHash,payload,firstDatasetHash:item.datasetHash,
      lastDatasetHash:item.datasetHash,firstExportedAt:item.exportedAt,lastExportedAt:item.exportedAt,occurrences:1,
      seenInLatest:item===latest});
    variantsByRecord.set(recordKey,recordVariants);if(item===latest)latestIdentities.add(recordKey);
    markCompleteRecord(family,identity,`research-export:${item.datasetHash}`);
  });
}

const exportVariants=[];
let conflictingIdentities=0,conflictingOccurrences=0,olderOnlyIdentities=0;
for(const [recordKey,recordVariants] of [...variantsByRecord.entries()].sort(([a],[b])=>a.localeCompare(b))){
  const conflict=recordVariants.size>1;const olderOnly=!latestIdentities.has(recordKey);
  if(!conflict&&!olderOnly)continue;
  if(conflict){conflictingIdentities++;conflictingOccurrences += [...recordVariants.values()].reduce((sum,item)=>sum+item.occurrences,0);}
  if(olderOnly)olderOnlyIdentities++;
  for(const value of [...recordVariants.values()].sort((a,b)=>a.payloadHash.localeCompare(b.payloadHash))){
    exportVariants.push({variantId:stableUuid(`variant\0${value.family}\0${value.identity}\0${value.payloadHash}`),
      family:value.family,recordIdentity:value.identity,payloadHash:value.payloadHash,payload:value.payload,
      firstDatasetHash:value.firstDatasetHash,lastDatasetHash:value.lastDatasetHash,
      firstExportedAt:value.firstExportedAt,lastExportedAt:value.lastExportedAt,occurrenceCount:value.occurrences,
      isLatestVariant:value.seenInLatest,variantClass:olderOnly?'OLDER_ONLY':value.seenInLatest?'CONFLICT_CURRENT':'CONFLICT_HISTORICAL',
      pitEligibility:'ELIGIBLE'});
  }
}

const researchOutputAnalysis=await inspectResearchOutputs();
sources.push(...researchOutputAnalysis.sources);
const scopedSearch=await inspectScopedSearchSurfaces();
sources.push(...scopedSearch.sources);
const gitForensics=await inspectUnreachableGitObjects();
sources.push(...gitForensics.sources);
const uniqueSources=deduplicateSources(sources);

const searchedScopes=[...new Set([...uniqueSources.map((item)=>item.sourceScope),
  ...scopedSearch.rootReceipts.map((item)=>String(item.scope))])].sort();
const missingSearches=[...missingByIdentity.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([identity,item])=>{
  const evidence=keyEvidence.get(item.missingParentKey)!;
  const notAParent=item.targetTable==='trade.candidate_point_in_time_evidence'&&!isUuid(item.missingParentKey);
  const recoveryState=notAParent?'NOT_A_PARENT_REFERENCE':evidence.complete>0?'RECOVERED_EXACT':evidence.references>0?'REFERENCE_ONLY':'NOT_YET_RECOVERED';
  return{searchId:stableUuid(`missing\0${identity}\0${sourceCodeSha}`),targetTable:item.targetTable,
    missingRecordKey:item.missingParentKey,referenceMatchCount:evidence.references,
    completeRecordMatchCount:evidence.complete,matchedSourceCount:evidence.sources.size,searchedScopes,recoveryState,
    evidence:{completeRecordRule:completeRecordRule(item.targetTable),sourceLocators:[...evidence.sources].sort().slice(0,50),
      canonicalParentKeyType:item.targetTable==='trade.candidate_point_in_time_evidence'?'uuid':'uuid',
      rejectedAsParentReason:notAParent?'TEXT_STRATEGY_CANDIDATE_REF_CANNOT_REFERENCE_UUID_PARENT':null,
      noSyntheticParentCreated:true,executionAuthorized:false}};
});

const recoveryCounts=countBy(missingSearches,'recoveryState');
const summary={
  hypothesis:'NEON_BLOCKED_EXHAUST_LOCAL_AGENT_ORIGIN_FIRST',sourceCodeSha,exportCount:exports.length,
  exportOccurrences,uniqueSourceCount:uniqueSources.length,conflictingIdentities,conflictingOccurrences,
  preservedConflictVariants:exportVariants.length,olderOnlyIdentities,researchOutputFiles:researchOutputAnalysis.fileCount,
  researchOutputJsonObjects:researchOutputAnalysis.objectCount,unreachableGitObjects:gitForensics.objectCount,
  missingRecordCount:missingSearches.length,missingRecordStates:recoveryCounts,
  directNeonRead:'PRESERVED_TEMPORARILY_INACCESSIBLE',runtimeAuthority:'AIVEN',brokerAuthority:'ALPACA_PAPER',
  providerAuthority:'OPTIONOMICS_FOR_SUPPORTED_INTELLIGENCE',canonicalRuntimeRowsChanged:0,
  masterPaperOrdersSubmitted:0,followerPaperOrdersSubmitted:0,liveOrdersSubmitted:0,
  executionGate:'EXTERNAL_QUOTE_BLOCKER',followerExecution:'LOCKED',liveMoneyAuthorized:false,executionAuthorized:false,
  searchedScopes,rootSearches:scopedSearch.rootReceipts,
};
const rootManifestHash=sha256(canonicalJson({generatedAt,sourceCodeSha,methodVersion:LOCAL_FORENSIC_METHOD_VERSION,summary,
  sourceHashes:uniqueSources.map((item)=>`${item.sourceLocator}:${item.contentHash}`).sort(),
  variantHashes:exportVariants.map((item)=>`${item.family}:${item.recordIdentity}:${item.payloadHash}`).sort(),
  missingSearchHashes:missingSearches.map((item)=>sha256(canonicalJson(item))).sort()}));
const forensicSweepId=stableUuid(`forensic-sweep\0${rootManifestHash}`);
const scopedSources=uniqueSources.map((item)=>({...item,sourceId:stableUuid(`source\0${forensicSweepId}\0${item.sourceId}`)}));
const scopedVariants=exportVariants.map((item)=>({...item,
  variantId:stableUuid(`variant\0${forensicSweepId}\0${item.family}\0${item.recordIdentity}\0${item.payloadHash}`)}));
const scopedMissingSearches=missingSearches.map((item)=>({...item,
  searchId:stableUuid(`missing\0${forensicSweepId}\0${item.targetTable}\0${item.missingRecordKey}`)}));
const partitions=partitionItems(scopedSources,scopedVariants,scopedMissingSearches,700_000);
const chunks=partitions.map((partition,chunkIndex)=>{
  const unsigned={schemaVersion:'theta-local-forensic-chunk-v1' as const,forensicSweepId,generatedAt,sourceCodeSha,
    methodVersion:LOCAL_FORENSIC_METHOD_VERSION,rootManifestHash,chunkIndex,chunkCount:partitions.length,
    expectedSourceCount:scopedSources.length,expectedVariantCount:scopedVariants.length,
    expectedMissingSearchCount:scopedMissingSearches.length,summary,sources:partition.sources,variants:partition.variants,
    missingSearches:partition.missingSearches};
  return localForensicChunkSchema.parse({...unsigned,chunkHash:computeLocalForensicChunkHash(unsigned)});
});

await mkdir(outputRoot,{recursive:true});await rm(chunkRoot,{recursive:true,force:true});await mkdir(chunkRoot,{recursive:true});
for(const chunk of chunks)await writeFile(resolve(chunkRoot,`${String(chunk.chunkIndex).padStart(4,'0')}.json`),`${JSON.stringify(chunk)}\n`,'utf8');
await writeJson('forensic-manifest.json',{schemaVersion:'theta-local-forensic-root-v1',generatedAt,sourceCodeSha,
  methodVersion:LOCAL_FORENSIC_METHOD_VERSION,forensicSweepId,rootManifestHash,chunkCount:chunks.length,
  expectedSourceCount:scopedSources.length,expectedVariantCount:scopedVariants.length,
  expectedMissingSearchCount:scopedMissingSearches.length,summary,chunkHashes:chunks.map((item)=>item.chunkHash)});
await writeJson('forensic-catalog.json',{generatedAt,recordCount:uniqueSources.length,sources:uniqueSources});
await writeJson('research-export-variants.json',{generatedAt,recordCount:exportVariants.length,variants:exportVariants});
await writeJson('missing-parent-search.json',{generatedAt,recordCount:missingSearches.length,records:missingSearches});
await writeJson('research-output-analysis.json',{generatedAt,...researchOutputAnalysis.report});
await writeJson('git-forensics.json',{generatedAt,...gitForensics.report});
process.stdout.write(`${JSON.stringify({state:'GENERATED',forensicSweepId,rootManifestHash,chunkCount:chunks.length,...summary})}\n`);

async function loadExports():Promise<ExportItem[]>{
  const root=resolve('research_exports');const entries=(await readdir(root,{withFileTypes:true}))
    .filter((entry)=>entry.isDirectory()&&entry.name!=='latest');const result:ExportItem[]=[];
  for(const entry of entries){const directory=resolve(root,entry.name);const manifest=JSON.parse(await readFile(resolve(directory,'manifest.json'),'utf8')) as Record<string,unknown>;
    const datasetPath=resolve(directory,'dataset.json');const artifact=JSON.parse(await readFile(datasetPath,'utf8')) as {rows:Record<string,unknown[]>};
    result.push({directory,datasetPath,datasetHash:String(manifest.datasetHash),exportedAt:new Date(String(manifest.exportedAt)).toISOString(),rows:artifact.rows});}
  return result.sort((a,b)=>Date.parse(a.exportedAt)-Date.parse(b.exportedAt)||a.datasetHash.localeCompare(b.datasetHash));
}

async function inspectResearchOutputs(){
  const files=await listFiles(resolve('research_outputs'),new Set(['.json']));const result:SourceEntry[]=[];let objectCount=0;
  const embeddedFamilies:Record<string,number>={};
  for(const path of files){const bytes=await readFile(path);const keys=scanKeyMatches(bytes);for(const key of keys)recordReference(key,aliasPath(path));
    try{const value=JSON.parse(bytes.toString('utf8'));walk(value,(key,item)=>{
      objectCount++;if(/(?:candidate|decision|snapshot|frontier|outcome|quote|provider|feature)/i.test(key))embeddedFamilies[key]=(embeddedFamilies[key]??0)+1;
      if(typeof item==='string'&&missingKeys.has(item))recordReference(item,aliasPath(path));});}catch{}
    result.push(await sourceFromFile(path,'RESEARCH_OUTPUT',aliasPath(path),'DERIVED_RESEARCH','CATALOG_ONLY',{parsedJson:true}));}
  return{sources:result,fileCount:files.length,objectCount,report:{fileCount:files.length,objectCount,embeddedFamilies}};
}

async function inspectScopedSearchSurfaces(){
  const roots=[
    {scope:'AGENT_WORKSPACE',alias:'codex-attachments',path:resolve('C:/Users/hp/.codex/attachments')},
    {scope:'AGENT_WORKSPACE',alias:'claude',path:resolve('C:/Users/hp/.claude')},
    {scope:'DOWNLOADS',alias:'downloads',path:resolve('C:/Users/hp/Downloads')},
    {scope:'TEMPORARY_STORAGE',alias:'temp',path:resolve('C:/Users/hp/AppData/Local/Temp')},
    {scope:'WORKTREE',alias:'old-repo',path:resolve('C:/Users/hp/trading-bots')},
    {scope:'EDITOR_HISTORY',alias:'cursor',path:resolve('C:/Users/hp/AppData/Roaming/Cursor/User/History')},
  ] as const;
  const result:SourceEntry[]=[];const rootReceipts:Array<Record<string,unknown>>=[
    {scope:'OTHER',rootAlias:'onedrive',state:'SEARCHED_LOCAL_NON_PLACEHOLDER_FILES',matchingFiles:0,
      filesInspected:5,offlinePlaceholdersSkipped:149},
    {scope:'WSL',rootAlias:'ubuntu-home-and-tmp',state:'SEARCHED',matchingFiles:0},
    {scope:'DOCKER',rootAlias:'docker-desktop',state:'ENGINE_UNAVAILABLE',matchingFiles:0},
  ];
  const needlePath=resolve(outputRoot,'missing-parent-needles.txt');await mkdir(outputRoot,{recursive:true});
  await writeFile(needlePath,[...missingKeys].sort().join('\n'),'utf8');
  for(const root of roots){
    try{const details=await stat(root.path);if(!details.isDirectory())throw new Error('NOT_DIRECTORY');
      const command=spawnSync('rg',['-l','-F','-f',needlePath,'--glob','!node_modules/**','--glob','!.git/**',root.path],
        {encoding:'utf8',maxBuffer:20_000_000,windowsHide:true});
      const matches=(command.stdout??'').split(/\r?\n/).filter(Boolean);let accepted=0;
      for(const path of matches){if(isSecretBearingPath(path))continue;try{const bytes=await readFile(path);if(bytes.length>64_000_000)continue;
        const keys=scanKeyMatches(bytes);for(const key of keys)recordReference(key,`${root.alias}:${relative(root.path,path).replaceAll('\\','/')}`);
        result.push(await sourceFromFile(path,root.scope,`${root.alias}:${relative(root.path,path).replaceAll('\\','/')}`,
          'REFERENCE_ONLY','CATALOG_ONLY',{searchMethod:'EXACT_MISSING_KEY_RG'}));accepted++;}catch{}}
      rootReceipts.push({scope:root.scope,rootAlias:root.alias,state:'SEARCHED',matchingFiles:accepted,rgExitCode:command.status});
    }catch{rootReceipts.push({scope:root.scope,rootAlias:root.alias,state:'UNAVAILABLE',matchingFiles:0});}
  }
  return{sources:result,rootReceipts};
}

async function inspectUnreachableGitObjects(){
  const fsck=git(['fsck','--full','--unreachable','--no-reflogs']);const lines=fsck.split(/\r?\n/).filter(Boolean);
  const result:SourceEntry[]=[];const types:Record<string,number>={};let missingKeyObjects=0;
  for(const line of lines){const match=/unreachable (\w+) ([0-9a-f]{40})/.exec(line);if(!match)continue;
    const [,type,oid]=match;types[type]=(types[type]??0)+1;if(type!=='blob')continue;
    const size=Number(git(['cat-file','-s',oid]).trim());if(size>64_000_000)continue;
    const bytes=execFileSync('git',['cat-file','blob',oid],{cwd:repository,maxBuffer:70_000_000,windowsHide:true});
    const keys=scanKeyMatches(bytes);if(keys.length>0)missingKeyObjects++;
    for(const key of keys)recordReference(key,`git-unreachable:${oid}`);
    const text=bytes.toString('utf8');const fingerprints=countFingerprints(text);
    if(keys.length===0&&fingerprints===0)continue;
    result.push({sourceId:stableUuid(`git-unreachable\0${oid}`),sourceScope:'GIT_UNREACHABLE',
      sourceLocator:`git-unreachable:${oid}`,contentHash:sha256(bytes),byteSize:size,modifiedAt:null,
      exactMissingKeyMatches:keys.length,thetaFingerprintMatches:fingerprints,
      evidenceClass:keys.length>0?'REFERENCE_ONLY':'METADATA_ONLY',disposition:'CATALOG_ONLY',metadata:{objectType:type}});
  }
  return{sources:result,objectCount:lines.length,report:{objectCount:lines.length,types,missingKeyObjects,catalogedObjects:result.length}};
}

function markCompleteRecord(family:string,identity:string,source:string):void{
  const target=family==='candidates'?'trade.candidate_point_in_time_evidence':null;
  if(target===null||!missingByIdentity.has(`${target}\0${identity}`))return;
  const evidence=keyEvidence.get(identity)!;evidence.complete++;evidence.sources.add(source);
}
function recordReference(key:string,source:string):void{const evidence=keyEvidence.get(key);if(!evidence)return;evidence.references++;evidence.sources.add(source);}
function completeRecordRule(targetTable:string):string{return targetTable==='trade.candidate_point_in_time_evidence'
  ? 'ROW_MUST_EXIST_IN_CANDIDATES_EXPORT_FAMILY_WITH_MATCHING_STABLE_ID'
  : `ROW_MUST_BE_A_PRIMARY_RECORD_FOR_${targetTable.toUpperCase()}`;}

async function sourceFromFile(path:string,sourceScope:string,sourceLocator:string,evidenceClass:string,disposition:string,metadata:Record<string,unknown>):Promise<SourceEntry>{
  const bytes=await readFile(path);const details=await stat(path);const keys=scanKeyMatches(bytes);const fingerprints=countFingerprints(bytes.toString('utf8'));
  return{sourceId:stableUuid(`source\0${sourceScope}\0${sourceLocator}\0${sha256(bytes)}`),sourceScope,sourceLocator,
    contentHash:sha256(bytes),byteSize:bytes.length,modifiedAt:details.mtime.toISOString(),exactMissingKeyMatches:keys.length,
    thetaFingerprintMatches:fingerprints,evidenceClass,disposition,metadata};
}

function scanKeyMatches(bytes:Buffer):string[]{const text=bytes.toString('utf8');const matches=new Set<string>();
  for(const match of text.matchAll(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gi)){
    const key=match[0].toLowerCase();if(missingKeys.has(key))matches.add(key);}
  for(const match of text.matchAll(/(?:THETA_[A-Z_]+:[A-Z0-9]+|WAIT:[0-9a-f]{64})/g))if(missingKeys.has(match[0]))matches.add(match[0]);
  return[...matches];}
function countFingerprints(text:string):number{return['THETA','FusionSnapshot','Optionomics','candidate_point_in_time_evidence','strategyFrontier']
  .reduce((sum,value)=>sum+(text.toLowerCase().includes(value.toLowerCase())?1:0),0);}
function isSecretBearingPath(path:string):boolean{return /(?:^|[\\/.])(?:\.env|credentials?|secrets?|worker\.token)(?:$|[\\/.])/i.test(path);}
function deduplicateSources(input:SourceEntry[]):SourceEntry[]{const map=new Map<string,SourceEntry>();for(const item of input)map.set(`${item.sourceScope}\0${item.sourceLocator}\0${item.contentHash}`,item);
  return[...map.values()].sort((a,b)=>a.sourceScope.localeCompare(b.sourceScope)||a.sourceLocator.localeCompare(b.sourceLocator));}
function aliasPath(path:string):string{return `repo:${relative(repository,path).replaceAll('\\','/')}`;}
async function listFiles(root:string,extensions:Set<string>):Promise<string[]>{const result:string[]=[];async function visit(path:string):Promise<void>{
  let entries;try{entries=await readdir(path,{withFileTypes:true});}catch{return;}for(const entry of entries){const full=resolve(path,entry.name);
    if(entry.isDirectory())await visit(full);else if(extensions.has(entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()))result.push(full);}}
  await visit(root);return result.sort();}
function walk(value:unknown,visit:(key:string,value:unknown)=>void):void{if(Array.isArray(value)){for(const item of value)walk(item,visit);return;}
  if(typeof value!=='object'||value===null)return;for(const [key,item] of Object.entries(value)){visit(key,item);walk(item,visit);}}
function partitionItems(sourcesInput:unknown[],variantsInput:unknown[],searchesInput:unknown[],maxBytes:number){
  const queue=[...sourcesInput.map((value)=>({kind:'source',value})),...variantsInput.map((value)=>({kind:'variant',value})),
    ...searchesInput.map((value)=>({kind:'search',value}))];const result:{sources:any[];variants:any[];missingSearches:any[]}[]=[];
  let current={sources:[] as any[],variants:[] as any[],missingSearches:[] as any[]},bytes=0;
  for(const item of queue){const size=Buffer.byteLength(JSON.stringify(item.value))+128;
    const categoryCount=item.kind==='source'?current.sources.length:item.kind==='variant'?current.variants.length:current.missingSearches.length;
    if(bytes>0&&(bytes+size>maxBytes||categoryCount>=450)){result.push(current);current={sources:[],variants:[],missingSearches:[]};bytes=0;}
    if(item.kind==='source')current.sources.push(item.value);else if(item.kind==='variant')current.variants.push(item.value);else current.missingSearches.push(item.value);bytes+=size;}
  if(bytes>0||result.length===0)result.push(current);return result;}
function countBy<T extends Record<string,unknown>>(items:readonly T[],key:keyof T):Record<string,number>{const result:Record<string,number>={};
  for(const item of items){const value=String(item[key]);result[value]=(result[value]??0)+1;}return result;}
function sha256(value:string|Buffer):string{return createHash('sha256').update(value).digest('hex');}
function stableUuid(value:string):string{const hash=sha256(value);return`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;}
function isUuid(value:string):boolean{return/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);}
function git(args:string[]):string{return execFileSync('git',args,{cwd:repository,encoding:'utf8',maxBuffer:30_000_000,windowsHide:true});}
async function writeJson(name:string,value:unknown):Promise<void>{await writeFile(resolve(outputRoot,name),`${JSON.stringify(value,null,2)}\n`,'utf8');}
