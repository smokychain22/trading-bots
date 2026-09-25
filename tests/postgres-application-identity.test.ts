import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

function sourceFiles(directory:string):string[]{
  return readdirSync(directory,{withFileTypes:true}).flatMap((entry)=>{
    const path=join(directory,entry.name);
    return entry.isDirectory()?sourceFiles(path):extname(entry.name)==='.ts'?[path]:[];
  });
}

test('every source-owned Postgres pool has an attributable application name',()=>{
  const root=fileURLToPath(new URL('..',import.meta.url));
  const missing:string[]=[];
  for(const directory of ['src','tools']){
    for(const path of sourceFiles(join(root,directory))){
      const source=readFileSync(path,'utf8');
      for(const match of source.matchAll(/new Pool\(\{([\s\S]*?)\}\)/g)){
        if(!match[1].includes('application_name')){
          const line=source.slice(0,match.index).split('\n').length;
          missing.push(`${relative(root,path)}:${line}`);
        }
      }
    }
  }
  assert.deepEqual(missing,[]);
});
