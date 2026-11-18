# CodeAuthentic live-analysis indicator — frontend-only safe installer
# No backend, model, database, training, or CSS files are changed.
param([Parameter(Mandatory=$true)][string]$ProjectRoot)
$ErrorActionPreference = 'Stop'
$sourceRoot = $PSScriptRoot
$targets = @(
  @{ Path = "src/App.tsx"; Expected = "8021974972B7302E1F19F55E0C54736C27096AF2A7EABC4EC275A394EE2FF90D"; Patched = "5F3D76A90E08329212DBB57E7732AAAE047CA792AD641D354D589793A855282A" },
  @{ Path = "src/components/InstructorDashboard.tsx"; Expected = "28EB4D3096FDF72E633454EC287CEC24A7497E21ABE68EF7B7F5C314BE6D8355"; Patched = "6661C3BD79F57B5422871DE2E35B7E10763B2B8536503603C434D537F7BA033F" }
)

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "Project folder does not exist: $ProjectRoot"
}
$project = (Resolve-Path -LiteralPath $ProjectRoot).Path

# Check ALL hashes before overwriting anything.
$allPatched = $true
foreach ($item in $targets) {
    $relative = $item.Path.Replace('/', [IO.Path]::DirectorySeparatorChar)
    $destination = Join-Path $project $relative
    $patchFile = Join-Path $sourceRoot $relative
    if (-not (Test-Path -LiteralPath $destination -PathType Leaf)) { throw "Missing project file: $destination" }
    if (-not (Test-Path -LiteralPath $patchFile -PathType Leaf)) { throw "Missing patch file: $patchFile" }
    $sourceHash = (Get-FileHash -LiteralPath $patchFile -Algorithm SHA256).Hash
    if ($sourceHash -ne $item.Patched) { throw "Patch file integrity mismatch: $relative" }
    $actual = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
    if ($actual -ne $item.Expected -and $actual -ne $item.Patched) {
        throw "SOURCE MISMATCH: $relative has changed since the reviewed ZIP. Nothing was modified. Keep your local changes and request a refreshed patch."
    }
    if ($actual -ne $item.Patched) { $allPatched = $false }
    Write-Host "[VERIFIED] $relative"
}
if ($allPatched) {
    Write-Host "[ALREADY INSTALLED] Both files already have the patch."
    exit 0
}
$backupRoot = Join-Path $env:LOCALAPPDATA ("CodeAuthenticPatchBackups\analysis_ui_" + (Get-Date -Format yyyyMMdd_HHmmss))
foreach ($item in $targets) {
    $relative = $item.Path.Replace('/', [IO.Path]::DirectorySeparatorChar)
    $destination = Join-Path $project $relative
    $backupFile = Join-Path $backupRoot $relative
    New-Item -ItemType Directory -Path (Split-Path $backupFile -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $destination -Destination $backupFile -Force
}
Write-Host "[BACKUP] $backupRoot"
try {
    foreach ($item in $targets) {
        $relative = $item.Path.Replace('/', [IO.Path]::DirectorySeparatorChar)
        $destination = Join-Path $project $relative
        if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -eq $item.Patched) { continue }
        Copy-Item -LiteralPath (Join-Path $sourceRoot $relative) -Destination $destination -Force
        Write-Host "[UPDATED] $relative"
    }
} catch {
    Write-Warning "Copy failed; restoring original files from backup."
    foreach ($item in $targets) {
        $relative = $item.Path.Replace('/', [IO.Path]::DirectorySeparatorChar)
        Copy-Item -LiteralPath (Join-Path $backupRoot $relative) -Destination (Join-Path $project $relative) -Force
    }
    throw
}
Write-Host "[SUCCESS] Live analysis UI installed. No backend/ML/model files changed."
Write-Host "[NEXT] Restart the Vite frontend with npm run dev and test a NEW submission."
