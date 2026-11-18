# CodeAuthentic: persistent completed timer banner - UI only
param([Parameter(Mandatory=$true)][string]$ProjectRoot)
$ErrorActionPreference='Stop'
if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) { throw "Project folder not found: $ProjectRoot" }
$project=(Resolve-Path -LiteralPath $ProjectRoot).Path
$relative='src\components\InstructorDashboard.tsx'
$dest=Join-Path $project $relative
$src=Join-Path $PSScriptRoot $relative
$diagnosticSrc=Join-Path $PSScriptRoot 'CHECK_ANALYSIS_TIMESTAMPS.py'
$diagnosticDest=Join-Path $project 'CHECK_ANALYSIS_TIMESTAMPS.py'
if (-not (Test-Path -LiteralPath $dest -PathType Leaf)) { throw "Existing dashboard not found: $dest" }
if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { throw "Patch file missing: $src" }
if (-not (Test-Path -LiteralPath $diagnosticSrc -PathType Leaf)) { throw "Diagnostic file missing: $diagnosticSrc" }
$expectedOld='155E095F2981E06EAC01C61332B3CBB26FD6F49CBA1ECB0045A8E2D3926EFAF0'
$expectedNew='A6CF4FE14D1E240E97A34AAA10C393B04DA941FC1CDC6CCC9939497DD0D01108'
$patchHash=(Get-FileHash -LiteralPath $src -Algorithm SHA256).Hash
if ($patchHash -ne $expectedNew) { throw 'Patch integrity error: downloaded dashboard file was altered.' }
$currentHash=(Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
if ($currentHash -ne $expectedOld -and $currentHash -ne $expectedNew) {
  throw 'STOPPED SAFELY: Your InstructorDashboard.tsx differs from the elapsed-timer patch. No files were changed. Send its latest source for a safe merge.'
}
if (Test-Path -LiteralPath $diagnosticDest -PathType Leaf) {
  if ((Get-FileHash -LiteralPath $diagnosticDest -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $diagnosticSrc -Algorithm SHA256).Hash) {
    throw 'STOPPED SAFELY: A different CHECK_ANALYSIS_TIMESTAMPS.py already exists. No files changed.'
  }
}
if ($currentHash -eq $expectedNew) {
  Write-Host '[ALREADY INSTALLED] The persistent completion banner is present.' -ForegroundColor Green
} else {
  $baseBackup=if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { $env:TEMP }
  $backupDir=Join-Path $baseBackup ('CodeAuthenticPatchBackups\timer_completion_' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
  New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
  Copy-Item -LiteralPath $dest -Destination (Join-Path $backupDir 'InstructorDashboard.tsx') -Force
  Copy-Item -LiteralPath $src -Destination $dest -Force
  Write-Host "[BACKUP] $backupDir"
  Write-Host '[UPDATED] src\components\InstructorDashboard.tsx' -ForegroundColor Green
}
if (-not (Test-Path -LiteralPath $diagnosticDest -PathType Leaf)) {
  Copy-Item -LiteralPath $diagnosticSrc -Destination $diagnosticDest
  Write-Host '[ADDED] CHECK_ANALYSIS_TIMESTAMPS.py (read-only diagnostic)'
}
Write-Host '[SUCCESS] Persistent completion display installed. No ML or database changes.' -ForegroundColor Green
Write-Host '[NEXT] In the project folder run: python .\CHECK_ANALYSIS_TIMESTAMPS.py; npm run lint; npm run build'
