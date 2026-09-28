export async function runWithBoundedConcurrency<T,R>(values:readonly T[],maximumConcurrency:number,
  operation:(value:T,index:number)=>Promise<R>):Promise<R[]>{
  if(!Number.isInteger(maximumConcurrency)||maximumConcurrency<1)throw new Error('BOUNDED_CONCURRENCY_INVALID');
  const results=new Array<R>(values.length);
  let cursor=0;
  let failed=false;
  let firstFailure:unknown;
  const worker=async():Promise<void>=>{
    while(true){
      if(failed)return;
      const index=cursor;
      if(index>=values.length)return;
      cursor+=1;
      try{results[index]=await operation(values[index] as T,index);}
      catch(error){if(!failed){failed=true;firstFailure=error;}return;}
    }
  };
  const workerCount=Math.min(values.length,maximumConcurrency);
  await Promise.all(Array.from({length:workerCount},()=>worker()));
  if(failed)throw firstFailure;
  return results;
}
