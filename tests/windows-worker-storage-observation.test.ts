import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('deferred Windows storage measurements stay unknown rather than zero or healthy',()=>{
  const source=readFileSync('tools/windows/theta-local-worker.ps1','utf8');
  const start=source.indexOf('$localResearchArchiveState = if');
  const end=source.indexOf('if ($report.reconciliation.marketOpen -ne $true)',start);
  assert.ok(start>0 && end>start);
  // Execute only the variable-initialization block, never the supervisor.
  const initialization=source.slice(start,end);
  assert.doesNotMatch(initialization,/Invoke-|Start-Process|Stop-Process|Remove-Item/);
  const names=['localResearchArchiveRows','localResearchSpoolRows','localResearchPendingCompactionRows',
    'localResearchActiveSpoolBytes','localResearchTotalBytes','localResearchParquetFiles','localResearchParquetBytes'];
  const script=`$report=@{reconciliation=@{marketOpen=$true}}; ${initialization}
    @{ ${names.map((name)=>`${name}=$${name}`).join(';')};
      watermark=$localResearchStorageWatermark; quota=$localResearchTransferQuotaState;
      state=$localResearchArchiveState } | ConvertTo-Json -Compress`;
  const receipt=JSON.parse(execFileSync(process.platform==='win32'?'powershell.exe':'pwsh',
    ['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:90_000,windowsHide:true}));
  for(const name of names)assert.equal(receipt[name],null,name);
  assert.equal(receipt.watermark,'NOT_OBSERVED');
  assert.equal(receipt.quota,'NOT_OBSERVED');
  assert.equal(receipt.state,'DEFERRED_MARKET_CRITICAL');
});
