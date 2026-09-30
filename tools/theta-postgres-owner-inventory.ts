import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';

// Static source inventory, not a proof of release behavior or a fleet limit.
// Deliberately emit numeric options only, never connection strings or SQL.
const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap((e)=>
  e.isDirectory()?walk(resolve(dir,e.name)):/\.(ts|mjs|js)$/.test(e.name)?[resolve(dir,e.name)]:[]);
const rows:Record<string,unknown>[]=[];
const runtimeOwners:Record<string,{lifetime:string;releaseOwner:string;concurrency:string}>={
 'src/customer/api.ts':{lifetime:'REQUEST_OWNED',releaseOwner:'optionomics qualification finally pool.end',concurrency:'1 connection per explicit qualification request'},
 'src/customer/customer-store.ts':{lifetime:'PROCESS_SINGLETON',releaseOwner:'process lifecycle; transactional clients use canonical wrapper',concurrency:'2 connections shared by customer stores per process'},
 'src/customer/database-readiness.ts':{lifetime:'REQUEST_OWNED',releaseOwner:'checkDatabaseReadiness finally pool.end',concurrency:'1 per sequential status helper'},
 'src/customer/operator-control.ts':{lifetime:'OWNED_OR_BORROWED',releaseOwner:'close ends only string-created pools; runtime borrows canonical pool',concurrency:'1 for owned requests, zero additional for borrowed runtime'},
 'src/customer/operator-readiness.ts':{lifetime:'REQUEST_OWNED',releaseOwner:'each reader finally pool.end',concurrency:'1 per helper, status helpers serialized and same-identity batch single-flight'},
 'src/customer/paper-account-role.ts':{lifetime:'PROCESS_SINGLETON',releaseOwner:'process lifecycle; transactional clients use canonical wrapper',concurrency:'1 shared role connection per process'},
 'src/theta/autonomous-runtime-handler.ts':{lifetime:'PROCESS_SINGLETON_OR_EXPLICIT_CAPTURE',releaseOwner:'runtimePool shared; raw corporate-action capture pool ends in finally',concurrency:'2 shared runtime connections plus 1 per explicit capture request'},
 'src/theta/postgres-fresh-connection-probe.ts':{lifetime:'FRESH_PROBE',releaseOwner:'probe finally client.end',concurrency:'one physical client per probe; soak fresh probe is sequential'},
 'src/theta/runtime-postgres-pool.ts':{lifetime:'FACTORY_DEFINITION',releaseOwner:'caller owns the returned pool',concurrency:'default 2, configured integer clamped at 4'},
 'src/worker/index.ts':{lifetime:'RESIDENT_PROCESS_OWNER',releaseOwner:'ResidentThetaWorker.stop drains active cycle then pool.end',concurrency:'2 shared connections, not 2 per job'},
};
for(const path of [...walk('src'),...walk('tools')]){
 const content=readFileSync(path,'utf8');
 const source=ts.createSourceFile(path,content,ts.ScriptTarget.Latest,true);
 const file=relative(process.cwd(),path).replaceAll('\\','/');
 const aliases=new Set(['Pool','Client']);
 for(const s of source.statements){
  if(ts.isImportDeclaration(s)&&s.moduleSpecifier.getText(source).slice(1,-1)==='pg'){
   const binding=s.importClause?.namedBindings;
   if(binding&&ts.isNamedImports(binding))for(const e of binding.elements){
    if(['Pool','Client'].includes(e.propertyName?.text??e.name.text))aliases.add(e.name.text);
   }
  }
 }
 const visit=(node:ts.Node):void=>{
  const constructor=ts.isNewExpression(node)?node.expression.getText(source):null;
  const factory=ts.isCallExpression(node)&&node.expression.getText(source)==='createRuntimePostgresPool';
  if((constructor!==null&&(aliases.has(constructor)||/^(?:pg\.)?(Pool|Client)$/.test(constructor)))||factory){
   const args=(node as ts.NewExpression|ts.CallExpression).arguments;
   const config=args?.[factory?2:0];
   const numeric:Record<string,number|null>={};
   const keys=['max','min','connectionTimeoutMillis','idleTimeoutMillis','maxLifetimeSeconds','query_timeout','statement_timeout','maximumConnections'];
   if(config&&ts.isObjectLiteralExpression(config))for(const p of config.properties){
    if(ts.isPropertyAssignment(p)&&keys.includes(p.name.getText(source))){
     numeric[p.name.getText(source)]=ts.isNumericLiteral(p.initializer)?Number(p.initializer.text):null;
    }
   }
   const runtimeFactoryDefinition=file==='src/theta/runtime-postgres-pool.ts';
   const owner=runtimeOwners[file]??(file.startsWith('src/database/')
    ?{lifetime:'EXPLICIT_ADMINISTRATION',releaseOwner:'function finally pool.end; owned acquisition wrapper closes on failed connect',concurrency:'explicit invocation only, not called per worker iteration'}
    :file.startsWith('tools/')?{lifetime:'EXPLICIT_CLI',releaseOwner:'command finally/end or process lifecycle, never an implicit runtime pool',concurrency:'per command/process, concurrent commands add their own budgets'}:null);
   rows.push({file,line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,
    kind:factory?'RUNTIME_FACTORY_CALL':constructor,options:numeric,
    defaultMaxWhenOmitted:factory?2:constructor?.endsWith('Pool')&&!runtimeFactoryDefinition?10:null,
    maximumIsParameterized:runtimeFactoryDefinition,
    sourceHash:createHash('sha256').update(content).digest('hex'),
    endCallCountInFile:(content.match(/\.end\(/g)??[]).length,
    lifecycleProof:'REQUIRES_CALL_GRAPH_AND_EXECUTED_TESTS',
    owner,
    executionSurface:file.startsWith('tools/')?'EXPLICIT_CLI':file.startsWith('src/database/')?'GOVERNED_ADMINISTRATION':'RUNTIME_OR_REQUEST',
   });
  }
  ts.forEachChild(node,visit);
 };
 visit(source);
}
const result={version:'theta-postgres-owner-inventory-v1',state:'STATIC_INVENTORY_NOT_CERTIFICATION',sites:rows,
 unclassifiedOwners:rows.filter(row=>row.owner===null).length,
 serverlessBudget:{persistentMaximumPerProcess:5,components:{runtime:2,customer:2,role:1},
  temporaryAdditional:'one connection per concurrent explicit qualification/capture/control request; status single-flight per database identity',
  fleetBoundProven:false},
 simultaneousGlobalMaximum:null,globalBudgetReason:'Serverless instance count and independent CLI process count are not bounded by one process pool max.',
 safety:{databaseConnectionsOpened:0,brokerMutations:0}};
const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);
if(output){mkdirSync(dirname(resolve(output)),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2));}
console.log(JSON.stringify(result));
