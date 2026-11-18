param(
    [Parameter(Mandatory=$true)]
    [string]$ProjectRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Never install by assuming an arbitrary source version. This patch recognizes
# both the uploaded source and the optional dashboard-performance update.
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
$manifestPath = Join-Path $PSScriptRoot 'PATCH_MANIFEST.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$changes = @()
$already = @()

function Sha256([string]$p) {
    return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()
}

Write-Host 'CodeAuthentic - Owner-Only Lobby Extend & Reopen' -ForegroundColor Cyan
Write-Host "Project: $root"

foreach ($entry in $manifest.files) {
    $relative = [string]$entry.path
    $destination = Join-Path $root ($relative.Replace('/', '\'))
    if (-not (Test-Path -LiteralPath $destination -PathType Leaf)) {
        throw "STOPPED SAFELY: Missing required project file: $relative"
    }
    $actualHash = Sha256 $destination
    $selection = $null
    $isUpdated = $false

    foreach ($variant in $entry.variants) {
        if ($actualHash -eq [string]$variant.expected_sha256) {
            $selection = $variant
            break
        }
        if ($actualHash -eq [string]$variant.new_sha256) {
            $isUpdated = $true
        }
    }
    if ($null -eq $selection) {
        if ($isUpdated) {
            Write-Host "[ALREADY UPDATED] $relative" -ForegroundColor Green
            $already += $relative
            continue
        }
        throw "STOPPED SAFELY: SOURCE MISMATCH for $relative`nCurrent SHA256: $actualHash`nA newer/local edit may be present. Do not overwrite or force the patch."
    }
    $payload = Join-Path $PSScriptRoot ([string]$selection.payload).Replace('/', '\')
    if (-not (Test-Path -LiteralPath $payload -PathType Leaf)) {
        throw "STOPPED SAFELY: Missing patch payload: $($selection.payload)"
    }
    if ((Sha256 $payload) -ne [string]$selection.new_sha256) {
        throw "STOPPED SAFELY: Patch payload checksum does not match: $relative"
    }
    Write-Host "[VERIFIED] $relative ($($selection.name))"
    $changes += [PSCustomObject]@{
        Relative = $relative
        Destination = $destination
        Payload = $payload
    }
}

if ($changes.Count -eq 0) {
    Write-Host '[SUCCESS] All lobby-fix files are already installed. No changes made.' -ForegroundColor Green
    exit 0
}

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backupRoot = Join-Path $env:LOCALAPPDATA "CodeAuthenticPatchBackups\lobby_reopen_$stamp"
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null

foreach ($change in $changes) {
    $backup = Join-Path $backupRoot ($change.Relative.Replace('/', '\'))
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backup) | Out-Null
    Copy-Item -LiteralPath $change.Destination -Destination $backup -Force
}
Write-Host "[BACKUP] $backupRoot" -ForegroundColor Cyan

$installed = @()
try {
    foreach ($change in $changes) {
        Copy-Item -LiteralPath $change.Payload -Destination $change.Destination -Force
        $installed += $change
        Write-Host "[UPDATED] $($change.Relative)" -ForegroundColor Green
    }
    $testSource = Join-Path $PSScriptRoot 'tests\test_lobby_extend_reopen.py'
    $testDestination = Join-Path $root 'tests\test_lobby_extend_reopen.py'
    if (-not (Test-Path -LiteralPath $testDestination)) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $testDestination) | Out-Null
        Copy-Item -LiteralPath $testSource -Destination $testDestination
        Write-Host '[ADDED] tests\test_lobby_extend_reopen.py'
    } elseif ((Sha256 $testSource) -ne (Sha256 $testDestination)) {
        Write-Host '[NOTE] Existing tests\test_lobby_extend_reopen.py was not overwritten.' -ForegroundColor Yellow
    }
} catch {
    Write-Host "[ERROR] Update failed: $_" -ForegroundColor Red
    foreach ($change in $installed) {
        $backup = Join-Path $backupRoot ($change.Relative.Replace('/', '\'))
        Copy-Item -LiteralPath $backup -Destination $change.Destination -Force
        Write-Host "[RESTORED] $($change.Relative)"
    }
    throw
}

Write-Host '[SUCCESS] Lobby lifecycle fix installed.' -ForegroundColor Green
Write-Host 'No model weights, datasets, student submissions, or database schema were modified.'
Write-Host 'Restart BOTH local servers before testing. Deploy matching frontend+backend together later.'
