import { createHash } from 'node:crypto';
import { canonicalJson } from '../research/point-in-time-evidence.js';

export interface ResearchExportInput{
  readonly datasetHash:string;readonly exportedAt:string;
  readonly rows:Readonly<Record<string,readonly unknown[]>>;
}
export interface ExportFamilyUnion{
  readonly latestRows:number;readonly uniqueRowsAcrossAllExports:number;
  readonly additionalRowsFromOlderExports:number;readonly duplicateOccurrences:number;
  readonly conflictingIdentities:number;readonly uniqueContentVariants:number;
}
export interface ResearchExportUnionReceipt{
  readonly exportCount:number;readonly latestDatasetHash:string|null;
  readonly families:Readonly<Record<string,ExportFamilyUnion>>;
}

export function legacyRecordIdentity(family:string,payload:unknown,index:number):string{
  if(typeof payload==='object'&&payload!==null&&!Array.isArray(payload)){
    const record=payload as Record<string,unknown>;
    for(const [key,value] of Object.entries(record)){
      if(/Id$/.test(key)&&typeof value==='string'&&value.length>0)return value;
    }
    if(typeof record.contentHash==='string'&&/^[0-9a-f]{64}$/.test(record.contentHash))return record.contentHash;
  }
  return createHash('sha256').update(`${family}\0${index}\0${canonicalJson(payload)}`).digest('hex');
}

export function analyzeResearchExportUnion(exports:readonly ResearchExportInput[]):ResearchExportUnionReceipt{
  const ordered=[...exports].sort((left,right)=>Date.parse(left.exportedAt)-Date.parse(right.exportedAt)||
    left.datasetHash.localeCompare(right.datasetHash));
  const latest=ordered.at(-1);
  const familyNames=[...new Set(ordered.flatMap((item)=>Object.keys(item.rows)))].sort();
  const families:Record<string,ExportFamilyUnion>={};
  for(const family of familyNames){
    const identities=new Map<string,Set<string>>();const latestIdentities=new Set<string>();let occurrences=0;
    for(const item of ordered){
      const rows=item.rows[family]??[];
      rows.forEach((payload,index)=>{
        occurrences++;
        const identity=legacyRecordIdentity(family,payload,index);
        if(item===latest)latestIdentities.add(identity);
        const variants=identities.get(identity)??new Set<string>();
        variants.add(createHash('sha256').update(canonicalJson(payload)).digest('hex'));
        identities.set(identity,variants);
      });
    }
    const latestRows=(latest?.rows[family]??[]).length;
    const uniqueContentVariants=[...identities.values()].reduce((sum,variants)=>sum+variants.size,0);
    families[family]={latestRows,uniqueRowsAcrossAllExports:identities.size,
      additionalRowsFromOlderExports:[...identities.keys()].filter((identity)=>!latestIdentities.has(identity)).length,
      duplicateOccurrences:Math.max(0,occurrences-uniqueContentVariants),
      conflictingIdentities:[...identities.values()].filter((variants)=>variants.size>1).length,
      uniqueContentVariants};
  }
  return{exportCount:ordered.length,latestDatasetHash:latest?.datasetHash??null,families};
}
