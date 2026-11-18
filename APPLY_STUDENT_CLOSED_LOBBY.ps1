param(
    [Parameter(Mandatory=$true)][string]$ProjectRoot
)
$ErrorActionPreference = 'Stop'
$patchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = Get-Content -LiteralPath (Join-Path $patchRoot 'PATCH_MANIFEST.json') -Raw | ConvertFrom-Json
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'backend\main.py'))) {
    throw 'PROJECT NOT FOUND. The ProjectRoot must point to thesis-main, containing backend\main.py.'
}

# Verify EVERY file before writing a single source file.
$needed = New-Object System.Collections.Generic.List[object]
foreach ($item in $manifest.files) {
    $relative = [string]$item.path
    $target = Join-Path $ProjectRoot $relative
    $source = Join-Path $patchRoot $relative
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "SOURCE MISSING: $relative. No changes made." }
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "PATCH INCOMPLETE: $relative. No changes made." }
    $currentHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    $patchHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($patchHash -ne [string]$item.new_sha256) { throw "PATCH HASH INVALID: $relative. No changes made." }
    if ($currentHash -eq [string]$item.new_sha256) {
        Write-Host "[ALREADY INSTALLED] $relative" -ForegroundColor Green
    } elseif ($currentHash -eq [string]$item.expected_old_sha256) {
        [void]$needed.Add(@{relative=$relative; source=$source; target=$target; sha=$patchHash})
        Write-Host "[VERIFIED] $relative" -ForegroundColor Cyan
    } else {
        throw "SOURCE MISMATCH: $relative. Current SHA256=$currentHash. No changes made. Do NOT force the patch."
    }
}

if ($needed.Count -eq 0) {
    Write-Host '[SUCCESS] All five source changes are already installed.' -ForegroundColor Green
    exit 0
}

$backupParent = if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { $env:TEMP } else { $env:LOCALAPPDATA }
$backupBase = Join-Path $backupParent 'CodeAuthenticPatchBackups' 
$backup = Join-Path $backupBase ("student_closed_" + (Get-Date -Format 'yyyyMMdd_HHmmss'))
New-Item -ItemType Directory -Path $backup -Force | Out-Null

# Back up ALL destination files first.
foreach ($item in $needed) {
    $dest = Join-Path $backup $item.relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
    Copy-Item -LiteralPath $item.target -Destination $dest -Force
}

$installed = New-Object System.Collections.Generic.List[object]
try {
    foreach ($item in $needed) {
        [void]$installed.Add($item)
        Copy-Item -LiteralPath $item.source -Destination $item.target -Force
        $actual = (Get-FileHash -LiteralPath $item.target -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $item.sha) { throw "POST-INSTALL VERIFICATION FAILED: $($item.relative)" }
        Write-Host "[UPDATED] $($item.relative)" -ForegroundColor Green
    }
} catch {
    foreach ($item in $installed) {
        $original = Join-Path $backup $item.relative
        Copy-Item -LiteralPath $original -Destination $item.target -Force
    }
    Write-Host '[ROLLBACK] Restored previously updated files from backup.' -ForegroundColor Yellow
    throw
}

$testRel = 'tests\test_public_lobby_closed_status.py'
$testSource = Join-Path $patchRoot $testRel
$testDest = Join-Path $ProjectRoot $testRel
if (Test-Path -LiteralPath $testSource) {
    if (-not (Test-Path -LiteralPath $testDest)) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $testDest) -Force | Out-Null
        Copy-Item -LiteralPath $testSource -Destination $testDest
        Write-Host "[ADDED] $testRel"
    } else {
        Write-Host "[PRESERVED] Existing $testRel was not overwritten."
    }
}

Write-Host "[BACKUP] $backup" -ForegroundColor Cyan
Write-Host '[SUCCESS] Student closed-session UI and public status patch installed.' -ForegroundColor Green
Write-Host '[NEXT] Restart BOTH server windows through START_SYSTEM.bat, then verify the public status endpoint.'
Write-Host '[NOTE] No classifiers, training files, or existing database records were changed.'
