param(
    [Parameter(Mandatory=$true)] [string]$ProjectRoot
)
$ErrorActionPreference = 'Stop'

# This installer only applies to CodeAuthentic_Source_For_Review(3).zip
# and stops rather than replacing files that have changed locally since review.
$patchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$project = (Resolve-Path -LiteralPath $ProjectRoot).Path
$entries = @(
    @{ rel='ml/predictor.py'; old='990e749edd394a6685ed120866ed514d2a993408927b11a022851b1190e61ddb' },
    @{ rel='backend/analysis.py'; old='e5496c9ae2eb715d4628d57b19e75e573e9c52afdfa76e873d8f4580cca052fd' },
    @{ rel='backend/main.py'; old='e9d53913076c86e39dccf3a33e7fa993ce8b47a179c7e9b999f73559bab79b0e' }
)

$toInstall = @()
foreach ($entry in $entries) {
    $relative = $entry.rel.Replace('/', [IO.Path]::DirectorySeparatorChar)
    $src = Join-Path (Join-Path $patchRoot 'srcpatch') $relative
    $dst = Join-Path $project $relative
    if (!(Test-Path -LiteralPath $src -PathType Leaf)) { throw "Patch file missing: $src" }
    if (!(Test-Path -LiteralPath $dst -PathType Leaf)) { throw "Project file missing: $dst" }
    $have = (Get-FileHash -Algorithm SHA256 -LiteralPath $dst).Hash.ToLowerInvariant()
    $want = (Get-FileHash -Algorithm SHA256 -LiteralPath $src).Hash.ToLowerInvariant()
    if ($have -eq $want) {
        Write-Host "[ALREADY INSTALLED] $($entry.rel)"
    } elseif ($have -ne $entry.old) {
        throw "[STOPPED SAFELY] $($entry.rel) differs from the reviewed ZIP. No files changed. Send your current file for a compatible patch."
    } else {
        $toInstall += @{ rel=$entry.rel; src=$src; dst=$dst }
        Write-Host "[VERIFIED] $($entry.rel)"
    }
}

if ($toInstall.Count -eq 0) {
    Write-Host '[SUCCESS] All CodeAuthentic fix files are already installed.'
    exit 0
}

$when = Get-Date -Format 'yyyyMMdd_HHmmss'
$backupRoot = Join-Path (Join-Path $env:LOCALAPPDATA 'CodeAuthenticPatchBackups') "analysis_fix_$when"
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

foreach ($entry in $toInstall) {
    $rel = $entry.rel.Replace('/', [IO.Path]::DirectorySeparatorChar)
    $backupFile = Join-Path $backupRoot $rel
    New-Item -ItemType Directory -Path (Split-Path $backupFile) -Force | Out-Null
    Copy-Item -LiteralPath $entry.dst -Destination $backupFile -Force
}

$updated = @()
try {
    foreach ($entry in $toInstall) {
        Copy-Item -LiteralPath $entry.src -Destination $entry.dst -Force
        $updated += $entry
        Write-Host "[UPDATED] $($entry.rel)"
    }
} catch {
    foreach ($entry in $updated) {
        $backupFile = Join-Path $backupRoot $entry.rel.Replace('/', [IO.Path]::DirectorySeparatorChar)
        Copy-Item -LiteralPath $backupFile -Destination $entry.dst -Force
    }
    throw '[ROLLED BACK] Installation error; originals restored.'
}

Write-Host "[BACKUP] $backupRoot"
Write-Host '[SUCCESS] Source patch installed. Do not use C training folder while training is active.'
Write-Host '[NOTE] The 512 MB Render Free instance will now decline inference safely; it cannot run full CodeBERT.'
