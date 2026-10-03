#Requires -Version 7
# Historical incident: PowerShell path and quoting defects (arguments with spaces, quotes, dollar signs, backticks and Windows paths with spaces
# were mangled when a command line was composed as one string). Invoke-ThetaBoundedProcess passes each argument as a discrete value, so every
# one of them must arrive at the child process byte-for-byte.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\..\tools\windows\ThetaProcess.Common.ps1')

$node = (Get-Command node).Source
$root = Join-Path ([IO.Path]::GetTempPath()) ('theta quoting test ' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $root)
try {
  $script = Join-Path $root 'echo args.js'
  $js = @'
process.stdout.write(Buffer.from(JSON.stringify(process.argv.slice(2)), 'utf8').toString('base64'));
'@
  [IO.File]::WriteAllText($script, $js, [Text.UTF8Encoding]::new($false))
  $cases = @(
    'plain', 'two words', 'say "hello"', "it's", 'a$b `c', 'C:\Program Files\Some App\file.txt', '--flag=value with space', 'trailing\', ("tab`tinside"), 'unicode-é-ß-日本', '{"json":"value","n":[1,2]}', '--import', ''
  )
  $result = Invoke-ThetaBoundedProcess -Executable $node -Arguments (@($script) + $cases) -TimeoutSeconds 20 -WorkingDirectory $root
  if ($result.State -ne 'COMPLETED' -or $result.ExitCode -ne 0) { throw "THETA_QUOTING_PROCESS_FAILED:$($result.State):$($result.ExitCode)" }
  $received = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($result.Output -join ''))) | ConvertFrom-Json -NoEnumerate
  if ($received.Count -ne $cases.Count) { throw "THETA_QUOTING_ARGUMENT_COUNT:$($received.Count)/$($cases.Count)" }
  for ($index = 0; $index -lt $cases.Count; $index++) {
    if ([string]$received[$index] -ne [string]$cases[$index]) { throw "THETA_QUOTING_ARGUMENT_MANGLED:$index" }
  }
  # a working directory with spaces is honoured
  $cwd = Invoke-ThetaBoundedProcess -Executable $node -Arguments @('-e', 'process.stdout.write(process.cwd())') -TimeoutSeconds 20 -WorkingDirectory $root
  if ($cwd.State -ne 'COMPLETED' -or (($cwd.Output -join '') -ne $root)) { throw 'THETA_QUOTING_WORKING_DIRECTORY_MANGLED' }
  'THETA_PROCESS_QUOTING_TEST=PASS'
} finally { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
