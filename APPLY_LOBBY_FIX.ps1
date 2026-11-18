# CodeAuthentic — Safe lobby/premium repair installer.
param([Parameter(Mandatory=$true)][string]$ProjectRoot)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'PATCH_MANIFEST.json') -Raw | ConvertFrom-Json
$planned = @()

# Preflight ALL changed files first; do not partially install into unexpected source.
foreach ($item in $manifest.files) {
    $relative = [string]$item.path
    $source = Join-Path $PSScriptRoot ($relative -replace '/', [IO.Path]::DirectorySeparatorChar)
    $target = Join-Path $root ($relative -replace '/', [IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Patch payload missing: $relative" }
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "Project source missing: $relative" }
    $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($sourceHash -ne [string]$item.sha256) { throw "Patch ZIP payload hash mismatch: $relative" }
    $current = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($current -eq $sourceHash) {
        Write-Host "[ALREADY CURRENT] $relative" -ForegroundColor Green
    } elseif (@($item.allowed_prior_sha256) -contains $current) {
        $planned += [pscustomobject]@{ Relative=$relative; Source=$source; Target=$target }
        Write-Host "[VERIFIED] $relative" -ForegroundColor Cyan
    } else {
        throw "STOPPED SAFELY: SOURCE MISMATCH for $relative ($current). Do NOT overwrite unknown local changes."
    }
}

if ($planned.Count -eq 0) {
    Write-Host '[SUCCESS] All five source files are already current; no changes made.' -ForegroundColor Green
} else {
    $parent = Join-Path $env:LOCALAPPDATA 'CodeAuthenticPatchBackups'
    $backup = Join-Path $parent ('lobby_premium_' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    foreach ($entry in $planned) {
        $destination = Join-Path $backup ($entry.Relative -replace '/', [IO.Path]::DirectorySeparatorChar)
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath $entry.Target -Destination $destination -Force
    }
    Write-Host "[BACKUP] $backup" -ForegroundColor Yellow
    $applied = @()
    try {
        foreach ($entry in $planned) {
            Copy-Item -LiteralPath $entry.Source -Destination $entry.Target -Force
            $applied += $entry
            Write-Host "[UPDATED] $($entry.Relative)" -ForegroundColor Green
        }
    } catch {
        foreach ($entry in $applied) {
            $original = Join-Path $backup ($entry.Relative -replace '/', [IO.Path]::DirectorySeparatorChar)
            Copy-Item -LiteralPath $original -Destination $entry.Target -Force
        }
        $detail = 'Copy failed; updated files were restored from backup. Original error: ' + $_.Exception.Message
        throw $detail
    }
}

# Install a distinct test file without replacing any existing tests.
$test = 'tests/test_lobby_reopen_premium.py'
$testSource = Join-Path $PSScriptRoot ($test -replace '/', [IO.Path]::DirectorySeparatorChar)
$testDest = Join-Path $root ($test -replace '/', [IO.Path]::DirectorySeparatorChar)
if (-not (Test-Path -LiteralPath $testDest)) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $testDest) -Force | Out-Null
    Copy-Item -LiteralPath $testSource -Destination $testDest
    Write-Host "[ADDED] $test"
} elseif ((Get-FileHash -LiteralPath $testDest -Algorithm SHA256).Hash.ToLowerInvariant() -ne (Get-FileHash -LiteralPath $testSource -Algorithm SHA256).Hash.ToLowerInvariant()) {
    Write-Warning 'Existing test file differs; left it unchanged.'
}
Write-Host '[SUCCESS] Lobby fix and premium controls prepared. Restart BOTH local servers before testing.' -ForegroundColor Green
Write-Host 'Verify POST /lobbies/{lobby_id}/extend-and-reopen using VERIFY_REOPEN_ROUTE.ps1 after restarting.'
