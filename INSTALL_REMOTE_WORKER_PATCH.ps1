param(
    [Parameter(Mandatory=$true)]
    [string]$ProjectRoot
)
$ErrorActionPreference = 'Stop'
$patchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$payloadRoot = Join-Path $patchRoot 'payload'
$manifestFile = Join-Path $patchRoot 'PATCH_MANIFEST.json'
if (!(Test-Path -LiteralPath $manifestFile -PathType Leaf)) { throw 'Manifest missing.' }
if (!(Test-Path -LiteralPath $payloadRoot -PathType Container)) { throw 'Payload missing.' }
if (!(Test-Path -LiteralPath $ProjectRoot -PathType Container)) { throw "Project missing: $ProjectRoot" }
if (!(Test-Path -LiteralPath (Join-Path $ProjectRoot 'backend\main.py') -PathType Leaf)) {
    throw 'ProjectRoot is not the CodeAuthentic project root.'
}
$manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
$pending = @()
# Verify all sources and all packaged artifacts BEFORE writing any files.
foreach ($entry in $manifest.files) {
    $relative = [string]$entry.path
    if ($relative.StartsWith('/') -or $relative.Contains('..') -or $relative.Contains(':')) {
        throw "Unsafe manifest path: $relative"
    }
    $source = Join-Path $payloadRoot ($relative -replace '/', '\')
    $target = Join-Path $ProjectRoot ($relative -replace '/', '\')
    if (!(Test-Path -LiteralPath $source -PathType Leaf)) { throw "Payload missing: $relative" }
    $actualNew = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualNew -ne [string]$entry.new_sha256) { throw "PATCH CHECKSUM MISMATCH: $relative" }
    if ($entry.original_sha256) {
        if (!(Test-Path -LiteralPath $target -PathType Leaf)) { throw "SOURCE FILE MISSING: $relative" }
        $actualOld = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualOld -eq [string]$entry.new_sha256) {
            Write-Host "Already updated: $relative" -ForegroundColor Yellow
            continue
        }
        if ($actualOld -ne [string]$entry.original_sha256) {
            throw "SOURCE MISMATCH: $relative. Refusing to overwrite modified code."
        }
    } elseif (Test-Path -LiteralPath $target) {
        $actualOld = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualOld -eq [string]$entry.new_sha256) {
            Write-Host "Already present: $relative" -ForegroundColor Yellow
            continue
        }
        throw "NEW FILE COLLISION: $relative. Refusing to overwrite it."
    }
    $pending += [pscustomobject]@{ Path = $relative; Source = $source; Target = $target; OriginalExists = [bool]$entry.original_sha256 }
}
if ($pending.Count -eq 0) {
    Write-Host 'All files are already installed. Nothing was changed.' -ForegroundColor Green
    exit 0
}
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backupRoot = Join-Path $env:LOCALAPPDATA "CodeAuthenticPatchBackups\RemoteWorker_$stamp"
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
foreach ($item in $pending) {
    if ($item.OriginalExists) {
        $originalBackup = Join-Path $backupRoot ($item.Path -replace '/', '\')
        New-Item -ItemType Directory -Path (Split-Path -Parent $originalBackup) -Force | Out-Null
        Copy-Item -LiteralPath $item.Target -Destination $originalBackup -Force
    }
}
$written = @()
try {
    foreach ($item in $pending) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $item.Target) -Force | Out-Null
        Copy-Item -LiteralPath $item.Source -Destination $item.Target -Force
        $written += $item
        Write-Host "Updated: $($item.Path)" -ForegroundColor Cyan
    }
} catch {
    Write-Host 'Install failed. Restoring the overwritten files...' -ForegroundColor Red
    foreach ($item in $written) {
        if ($item.OriginalExists) {
            $originalBackup = Join-Path $backupRoot ($item.Path -replace '/', '\')
            Copy-Item -LiteralPath $originalBackup -Destination $item.Target -Force
        } else {
            Remove-Item -LiteralPath $item.Target -Force
        }
    }
    throw
}
Write-Host ''
Write-Host 'Remote CodeBERT worker patch installed.' -ForegroundColor Green
Write-Host "Backup of replaced files: $backupRoot"
Write-Host 'LOCAL INFERENCE REMAINS THE DEFAULT. Follow README_REMOTE_WORKER.md to test before deployment.' -ForegroundColor Yellow
