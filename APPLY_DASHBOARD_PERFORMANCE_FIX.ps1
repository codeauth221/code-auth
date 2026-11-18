# CodeAuthentic: safe, idempotent dashboard optimization installer.
# No backend, database, ML model, classifier, or launcher files are modified.
param(
    [Parameter(Mandatory=$true)]
    [string]$ProjectRoot
)
$ErrorActionPreference = 'Stop'
$patchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
$manifest = Get-Content -LiteralPath (Join-Path $patchRoot 'PATCH_MANIFEST.json') -Raw | ConvertFrom-Json
$plan = @()

# Verify every target AND bundled replacement before changing anything.
foreach ($item in $manifest.files) {
    $relative = [string]$item.path
    if ($relative -notin @('src/App.tsx', 'src/components/InstructorDashboard.tsx')) {
        throw "Unexpected manifest target: $relative"
    }
    $target = Join-Path $root $relative
    $replacement = Join-Path $patchRoot $relative
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "Missing project file: $relative" }
    if (-not (Test-Path -LiteralPath $replacement -PathType Leaf)) { throw "Missing patch file: $relative" }
    $actual = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    $replacementHash = (Get-FileHash -LiteralPath $replacement -Algorithm SHA256).Hash.ToLowerInvariant()
    $originalHash = [string]$item.original_sha256
    $updatedHash = [string]$item.updated_sha256
    if ($replacementHash -ne $updatedHash) { throw "Bundled patch file failed integrity verification: $relative" }
    if ($actual -eq $updatedHash) {
        Write-Host "[ALREADY UPDATED] $relative" -ForegroundColor Cyan
        $plan += [pscustomobject]@{ relative=$relative; target=$target; replacement=$replacement; update=$false }
    } elseif ($actual -eq $originalHash) {
        Write-Host "[VERIFIED] $relative" -ForegroundColor Green
        $plan += [pscustomobject]@{ relative=$relative; target=$target; replacement=$replacement; update=$true }
    } else {
        throw "STOPPED SAFELY: SOURCE MISMATCH in $relative. Your local file differs from the inspected ZIP. No files changed. Do not force overwrite."
    }
}

$changes = @($plan | Where-Object { $_.update })
if ($changes.Count -eq 0) {
    Write-Host '[SUCCESS] Dashboard optimization is already installed. No files changed.' -ForegroundColor Green
    exit 0
}

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backupRoot = Join-Path $env:LOCALAPPDATA "CodeAuthenticPatchBackups\dashboard_perf_$stamp"
$applied = @()
try {
    # Back up ALL source files first, before the first replacement.
    foreach ($item in $changes) {
        $backup = Join-Path $backupRoot $item.relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force | Out-Null
        Copy-Item -LiteralPath $item.target -Destination $backup -Force
    }
    foreach ($item in $changes) {
        Copy-Item -LiteralPath $item.replacement -Destination $item.target -Force
        $applied += $item
        $actual = (Get-FileHash -LiteralPath $item.target -Algorithm SHA256).Hash.ToLowerInvariant()
        $expected = [string](($manifest.files | Where-Object { $_.path -eq $item.relative }).updated_sha256)
        if ($actual -ne $expected) { throw "Post-copy verification failed for $($item.relative)" }
        Write-Host "[UPDATED] $($item.relative)" -ForegroundColor Green
    }
} catch {
    foreach ($item in $applied) {
        $backup = Join-Path $backupRoot $item.relative
        if (Test-Path -LiteralPath $backup) { Copy-Item -LiteralPath $backup -Destination $item.target -Force }
    }
    throw "Installation stopped; attempted to restore changed files from $backupRoot. Original error: $_"
}
Write-Host "[BACKUP] $backupRoot" -ForegroundColor Cyan
Write-Host '[SUCCESS] Instructor dashboard optimization installed. Only two React source files updated.' -ForegroundColor Green
Write-Host '[NOTE] No database migration, backend change, or CodeBERT retraining is required.' -ForegroundColor Yellow
