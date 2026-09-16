import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';

const envPath = resolve(process.argv[2] ?? '.theta-local-worker/vercel-production-fresh.env');
const root = resolve(process.cwd(), '.theta-local-worker', 'legacy-recovery', 'method-sweep');
await mkdir(root, { recursive: true });
const parsed = dotenv.parse(await readFile(envPath));
const surfaces = [
  ['MAIN_POOLED', parsed.DATABASE_URL],
  ['MAIN_DIRECT', parsed.DATABASE_URL_UNPOOLED],
].filter((entry) => typeof entry[1] === 'string' && entry[1].length > 0);
if (surfaces.length === 0) throw new Error('NO_LEGACY_NEON_SOURCE_SURFACE_CONFIGURED');

const receipt = { schemaVersion:'theta-neon-method-sweep-v1', attemptedAt:new Date().toISOString(), sourceSystem:'NEON_LEGACY',
  sourceMutationAuthorized:false, runtimeAuthority:false, methods:[], fullRecovery:false };
for (const [surface, connectionString] of surfaces) {
  const url = new URL(connectionString);
  if (!url.hostname.endsWith('.neon.tech')) throw new Error('SOURCE_HOST_NOT_NEON');
  const env = { ...process.env, PGHOST:url.hostname, PGPORT:url.port || '5432', PGUSER:decodeURIComponent(url.username),
    PGPASSWORD:decodeURIComponent(url.password), PGDATABASE:url.pathname.slice(1) || 'postgres',
    PGSSLMODE:url.searchParams.get('sslmode') ?? 'require' };
  receipt.methods.push(await runMethod(surface,'PG_DUMP_CUSTOM',env,['pg_dump','--format=custom','--no-owner','--no-acl','--file=/recovery/database.dump']));
  receipt.methods.push(await runMethod(surface,'PG_DUMP_DIRECTORY',env,['pg_dump','--format=directory','--jobs=2','--no-owner','--no-acl','--file=/recovery/database-directory']));
  receipt.methods.push(await runMethod(surface,'PG_DUMP_PLAIN',env,['pg_dump','--format=plain','--no-owner','--no-acl','--file=/recovery/database.sql']));
  receipt.methods.push(await runMethod(surface,'PG_DUMP_SCHEMA_ONLY',env,['pg_dump','--schema-only','--no-owner','--no-acl','--file=/recovery/schema.sql']));
  receipt.methods.push(await runMethod(surface,'PG_DUMP_DATA_ONLY',env,['pg_dump','--data-only','--no-owner','--no-acl','--file=/recovery/data.sql']));
  receipt.methods.push(await runMethod(surface,'TABLE_SPECIFIC_PG_DUMP',env,['pg_dump','--table=core.schema_migration','--data-only','--no-owner','--no-acl','--file=/recovery/schema-migration.sql']));
  receipt.methods.push(await runMethod(surface,'COPY_STDOUT',env,['psql','--no-psqlrc','--command=COPY (SELECT 1 AS recovery_probe) TO STDOUT']));
  receipt.methods.push(await runMethod(surface,'PSQL_COPY',env,['psql','--no-psqlrc','--command=\\copy (SELECT 1 AS recovery_probe) TO STDOUT']));
  receipt.methods.push(await runMethod(surface,'LOGICAL_REPLICATION_CAPABILITY',env,['psql','--no-psqlrc','--tuples-only',
    '--command=SELECT current_setting(\'wal_level\'),has_database_privilege(current_user,current_database(),\'CREATE\')']));
}
receipt.fullRecovery = receipt.methods.some((method) => method.method === 'PG_DUMP_CUSTOM' && method.state === 'PASS');
await writeFile(resolve(root,'method-sweep-receipt.json'), `${JSON.stringify(receipt,null,2)}\n`, { mode:0o600 });
process.stdout.write(`${JSON.stringify({ methods:receipt.methods.map(({surface,method,state,sqlState,failureClass}) =>
  ({surface,method,state,sqlState,failureClass})), fullRecovery:receipt.fullRecovery,
  receiptPath:'.theta-local-worker/legacy-recovery/method-sweep/method-sweep-receipt.json' })}\n`);

async function runMethod(surface, method, env, postgresArgs) {
  const methodDirectory = resolve(root, `${surface.toLowerCase()}-${method.toLowerCase()}`);
  await rm(methodDirectory,{recursive:true,force:true});
  await mkdir(methodDirectory,{recursive:true});
  const args = ['run','--rm','-e','PGHOST','-e','PGPORT','-e','PGUSER','-e','PGPASSWORD','-e','PGDATABASE','-e','PGSSLMODE',
    '-v',`${methodDirectory}:/recovery`,'postgres:18-alpine',...postgresArgs];
  const result = await spawnSanitized('docker',args,env);
  const files = result.exitCode === 0 ? await hashFiles(methodDirectory) : [];
  return { surface,method,state:result.exitCode === 0 ? 'PASS' : 'BLOCKED',sqlState:result.sqlState,
    failureClass:result.failureClass,files,secretExposed:false };
}

function spawnSanitized(command,args,env) {
  return new Promise((resolvePromise,reject) => {
    const child=spawn(command,args,{env,windowsHide:true,stdio:['ignore','ignore','pipe']});
    let error='';
    child.stderr.on('data',(chunk)=>{if(error.length<8000) error+=chunk.toString();});
    child.once('error',reject);
    child.once('exit',(code)=>{
      const quota=/quota|resource|53000/i.test(error);
      resolvePromise({exitCode:code ?? -1,sqlState:/53000/.test(error)?'53000':'UNKNOWN',
        failureClass:code===0?'NONE':quota?'SOURCE_PROVIDER_QUOTA':'SOURCE_READ_FAILED'});
    });
  });
}

async function hashFiles(directory) {
  const { readdir, stat } = await import('node:fs/promises');
  const entries=await readdir(directory,{recursive:true});
  const files=[];
  for(const entry of entries.sort()){
    const path=resolve(directory,entry); const details=await stat(path);
    if(!details.isFile()) continue;
    const bytes=await readFile(path);
    files.push({name:entry.replaceAll('\\','/'),byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  return files;
}
