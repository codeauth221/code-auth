param(
    [Parameter(Mandatory = $true)] [string] $ProjectRoot
)
$ErrorActionPreference = 'Stop'

# Applies ONLY after the CodeBERT Memory & Recovery Safe Patch has been installed.
# Verifies the expected installed predictor before changing ANY file.
$patchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$project = (Resolve-Path -LiteralPath $ProjectRoot).Path
$rel = 'ml\predictor.py'
$dest = Join-Path $project $rel
$source = Join-Path $patchRoot 'srcpatch\ml\predictor.py'
$expectedBefore = '0e72aef46acbb3a9f35643d0155656f56cc39d2247bbca8db4369c0c1e7e1e6a'

if (!(Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "[STOPPED] Patch predictor missing: $source"
}
if (!(Test-Path -LiteralPath $dest -PathType Leaf)) {
    throw "[STOPPED] Project predictor missing: $dest"
}
$have = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash.ToLowerInvariant()
$newHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
if (($have -ne $expectedBefore) -and ($have -ne $newHash)) {
    throw '[STOPPED SAFELY] ml/predictor.py does not match the previously installed Memory & Recovery patch. No changes made. Send the current file for a custom compatible patch.'
}

$helpers = @(
    @{ rel = 'BENCHMARK_CODEBERT_SPEED.py'; src = 'BENCHMARK_CODEBERT_SPEED.py' },
    @{ rel = 'tests\test_speed_parity.py'; src = 'tests\test_speed_parity.py' }
)
foreach ($helper in $helpers) {
    $sourceHelper = Join-Path $patchRoot $helper.src
    $destHelper = Join-Path $project $helper.rel
    if (!(Test-Path -LiteralPath $sourceHelper -PathType Leaf)) {
        throw "[STOPPED] Helper file missing: $sourceHelper"
    }
    if (Test-Path -LiteralPath $destHelper -PathType Leaf) {
        $h = (Get-FileHash -LiteralPath $destHelper -Algorithm SHA256).Hash.ToLowerInvariant()
        $want = (Get-FileHash -LiteralPath $sourceHelper -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($h -ne $want) {
            throw "[STOPPED SAFELY] $($helper.rel) already exists and differs. No changes made."
        }
    }
}

$needsPredictorUpdate = $have -ne $newHash
$backupRoot = $null
$createdHelpers = @()
$updatedPredictor = $false

try {
    if ($needsPredictorUpdate) {
        $when = Get-Date -Format 'yyyyMMdd_HHmmss'
        $backupRoot = Join-Path (Join-Path $env:LOCALAPPDATA 'CodeAuthenticPatchBackups') "speed_fix_$when"
        $backupFile = Join-Path $backupRoot $rel
        New-Item -ItemType Directory -Path (Split-Path $backupFile) -Force | Out-Null
        Copy-Item -LiteralPath $dest -Destination $backupFile -Force
        Copy-Item -LiteralPath $source -Destination $dest -Force
        $updatedPredictor = $true
        Write-Host '[UPDATED] ml/predictor.py'
    } else {
        Write-Host '[ALREADY INSTALLED] ml/predictor.py'
    }

    foreach ($helper in $helpers) {
        $sourceHelper = Join-Path $patchRoot $helper.src
        $destHelper = Join-Path $project $helper.rel
        if (!(Test-Path -LiteralPath $destHelper -PathType Leaf)) {
            New-Item -ItemType Directory -Path (Split-Path $destHelper) -Force | Out-Null
            Copy-Item -LiteralPath $sourceHelper -Destination $destHelper -Force
            $createdHelpers += $destHelper
            Write-Host "[ADDED] $($helper.rel)"
        } else {
            Write-Host "[ALREADY PRESENT] $($helper.rel)"
        }
    }
} catch {
    if ($updatedPredictor -and $backupRoot) {
        Copy-Item -LiteralPath (Join-Path $backupRoot $rel) -Destination $dest -Force
    }
    foreach ($f in $createdHelpers) {
        Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
    }
    throw '[ROLLED BACK] An installation error occurred. Predictor restored; added helpers removed.'
}
if ($backupRoot) { Write-Host "[BACKUP] $backupRoot" }
Write-Host '[SUCCESS] Speed patch installed safely. Only ml/predictor.py was replaced.'
Write-Host '[NOTE] Restart your local FastAPI backend. Keep Render Free inference disabled due to its 512 MB limit.'
