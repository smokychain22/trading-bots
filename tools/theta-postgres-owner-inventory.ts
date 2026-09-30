import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';

// Static source inventory, not a proof of release behavior or a fleet limit.
// Deliberately emit numeric options only, never connection strings or SQL.
const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap((e)=>
  e.isDirectory()?walk(resolve(dir,e.name)):/\.(ts|mjs|js)$/.test(e.name)?[resolve(dir,e.name)]:[]);
const rows:Record<string,unknown>[]=[];
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
   rows.push({file,line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,
    kind:factory?'RUNTIME_FACTORY_CALL':constructor,options:numeric,
    defaultMaxWhenOmitted:factory?2:constructor?.endsWith('Pool')&&!runtimeFactoryDefinition?10:null,
    maximumIsParameterized:runtimeFactoryDefinition,
    sourceHash:createHash('sha256').update(content).digest('hex'),
    endCallCountInFile:(content.match(/\.end\(/g)??[]).length,
    lifecycleProof:'REQUIRES_CALL_GRAPH_AND_EXECUTED_TESTS',
    executionSurface:file.startsWith('tools/')?'EXPLICIT_CLI':file.startsWith('src/database/')?'GOVERNED_ADMINISTRATION':'RUNTIME_OR_REQUEST',
   });
  }
  ts.forEachChild(node,visit);
 };
 visit(source);
}
const result={version:'theta-postgres-owner-inventory-v1',state:'STATIC_INVENTORY_NOT_CERTIFICATION',sites:rows,
 simultaneousGlobalMaximum:null,globalBudgetReason:'Serverless instance count and independent CLI process count are not bounded by one process pool max.',
 safety:{databaseConnectionsOpened:0,brokerMutations:0}};
const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);
if(output){mkdirSync(dirname(resolve(output)),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2));}
console.log(JSON.stringify(result));
