param(
    [Parameter(Mandatory=$true)][string]$ProjectRoot
)
$ErrorActionPreference = "Stop"
$expected = "ecddd866fca4f52892a4c5f5f325ceb692093f70aaf27d51dfc2e68734a468a2"
$project = (Resolve-Path -LiteralPath $ProjectRoot).Path
$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $project "ml\predictor.py"
$source = Join-Path $base "ml\predictor.py"
if (-not (Test-Path -LiteralPath $target) -or -not (Test-Path -LiteralPath $source)) { throw "STOPPED SAFELY: Missing predictor.py" }
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant()
if ($actual -ne $expected) {
    throw "STOPPED SAFELY: SOURCE MISMATCH. Expected $expected but found $actual. Do not overwrite your different code."
}
foreach ($name in @("DIAGNOSE_CODEBERT_RUNTIME.py", "tests\test_hf_cache_performance.py")) {
    $newPath = Join-Path $base $name
    if (-not (Test-Path -LiteralPath $newPath)) { throw "STOPPED SAFELY: Missing $name in extracted patch." }
    $existing = Join-Path $project $name
    if (Test-Path -LiteralPath $existing) {
        $a = (Get-FileHash -Algorithm SHA256 -LiteralPath $existing).Hash
        $b = (Get-FileHash -Algorithm SHA256 -LiteralPath $newPath).Hash
        if ($a -ne $b) { throw "STOPPED SAFELY: $name already exists with different content." }
    }
}
$backupDir = Join-Path $env:LOCALAPPDATA ("CodeAuthenticPatchBackups\startup_perf_" + (Get-Date -Format 'yyyyMMdd_HHmmss'))
New-Item -ItemType Directory -Force -Path (Join-Path $backupDir "ml") | Out-Null
Copy-Item -LiteralPath $target -Destination (Join-Path $backupDir "ml\predictor.py") -Force
try {
    Copy-Item -LiteralPath $source -Destination $target -Force
    foreach ($name in @("DIAGNOSE_CODEBERT_RUNTIME.py", "tests\test_hf_cache_performance.py")) {
        $destination = Join-Path $project $name
        if (-not (Test-Path -LiteralPath $destination)) {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
            Copy-Item -LiteralPath (Join-Path $base $name) -Destination $destination
            Write-Host "[ADDED] $name"
        } else {
            Write-Host "[ALREADY PRESENT] $name"
        }
    }
} catch {
    Copy-Item -LiteralPath (Join-Path $backupDir "ml\predictor.py") -Destination $target -Force
    throw
}
Write-Host "[UPDATED] ml\predictor.py" -ForegroundColor Green
Write-Host "[BACKUP] $backupDir"
Write-Host "[SUCCESS] Safe cache-first loading, optional model placement and timing diagnostics installed."
Write-Host "[NOTE] Default placement stays auto. Do NOT deploy to Render Free; its 512MB limit remains."
