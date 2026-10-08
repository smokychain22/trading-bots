import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const common = readFileSync('tools/windows/ThetaProcess.Common.ps1', 'utf8');
const worker = readFileSync('tools/windows/theta-local-worker.ps1', 'utf8');

test('worker error handling never dereferences an assumed HTTP response', () => {
  assert.match(common, /function Get-ThetaSafeHttpFailure/);
  assert.match(worker, /Get-ThetaSafeHttpFailure -Exception \$failureException/);
  assert.doesNotMatch(worker, /\$_\.Exception\.Response/);
});

test('temporary database DNS failure reaches the existing bounded recovery circuit, while broker auth does not',()=>{
  const match=worker.match(/\$serverErrorCode -cmatch '([^']+)'/);
  assert.ok(match);
  const circuit=new RegExp(match[1]);
  assert.ok(circuit.test('POSTGRES_EAI_AGAIN'));
  assert.ok(circuit.test('POSTGRES_CONNECTION_ACQUISITION_TIMEOUT'));
  assert.ok(!circuit.test('ALPACA_ACCOUNT_INVALID_AUTH_HTTP_401'));
  assert.ok(!circuit.test('POSTGRES_ENOTFOUND'));
});

test('strict-mode non-HTTP errors remain classified, while only safe HTTP metadata is retained',
  { skip: process.platform !== 'win32' }, () => {
    const output = execFileSync('pwsh.exe', ['-NoProfile', '-Command', `
      $ErrorActionPreference = 'Stop'
      . ./tools/windows/ThetaProcess.Common.ps1
      try { throw 'synthetic-non-http' } catch {
        $plain = Get-ThetaSafeHttpFailure -Exception $_.Exception
      }
      if ($null -ne $plain.HttpStatus -or $null -ne $plain.ServerErrorCode) { throw 'NON_HTTP_NOT_SAFE' }
      $http = [Exception]::new('synthetic-http')
      $http | Add-Member -NotePropertyName Response -NotePropertyValue ([pscustomobject]@{
        StatusCode=503; Headers=@{ 'X-Theta-Safe-Error-Code'='POSTGRES_57P03' }
      })
      $classified = Get-ThetaSafeHttpFailure -Exception $http
      if ($classified.HttpStatus -ne 503 -or $classified.ServerErrorCode -ne 'POSTGRES_57P03') {
        throw 'HTTP_METADATA_NOT_CLASSIFIED'
      }
      $realResponse = [System.Net.Http.HttpResponseMessage]::new([System.Net.HttpStatusCode]::ServiceUnavailable)
      $null = $realResponse.Headers.TryAddWithoutValidation('X-Theta-Safe-Error-Code', 'POSTGRES_53000')
      $realHttp = [Exception]::new('synthetic-http')
      $realHttp | Add-Member -NotePropertyName Response -NotePropertyValue $realResponse
      $realResult = Get-ThetaSafeHttpFailure -Exception $realHttp
      if ($realResult.HttpStatus -ne 503 -or $realResult.ServerErrorCode -ne 'POSTGRES_53000') {
        throw 'HTTP_HEADERS_NOT_CLASSIFIED'
      }
      $malformed = [Exception]::new('synthetic-http')
      $malformed | Add-Member -NotePropertyName Response -NotePropertyValue ([pscustomobject]@{
        StatusCode=429; Headers=@{ 'X-Theta-Safe-Error-Code'='secret-bearing-value' }
      })
      $rejected = Get-ThetaSafeHttpFailure -Exception $malformed
      if ($rejected.HttpStatus -ne 429 -or $null -ne $rejected.ServerErrorCode) { throw 'UNSAFE_HEADER_ACCEPTED' }
      $noHeaders = [Exception]::new('synthetic-http')
      $noHeaders | Add-Member -NotePropertyName Response -NotePropertyValue ([pscustomobject]@{ StatusCode=502 })
      $partial = Get-ThetaSafeHttpFailure -Exception $noHeaders
      if ($partial.HttpStatus -ne 502 -or $null -ne $partial.ServerErrorCode) { throw 'MISSING_HEADERS_NOT_SAFE' }
      'PASS'
    `], { encoding: 'utf8', timeout: 90_000, windowsHide: true });
    assert.equal(output.trim(), 'PASS');
  });
