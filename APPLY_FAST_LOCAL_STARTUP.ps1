param(
  [Parameter(Mandatory=$true)]
  [string]$ProjectRoot
)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath $ProjectRoot).Path
$patchRoot = $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $patchRoot 'PATCH_MANIFEST.json') -Raw | ConvertFrom-Json

if (-not (Test-Path -LiteralPath (Join-Path $project 'package.json'))) {
  throw 'ProjectRoot must point to the CodeAuthentic folder containing package.json.'
}

# Verify *all* destination files before changing anything.
foreach ($item in $manifest.files) {
  $relative = $item.path.Replace('/', [IO.Path]::DirectorySeparatorChar)
  $destination = Join-Path $project $relative
  $source = Join-Path $patchRoot $relative
  if (-not (Test-Path -LiteralPath $destination) -or -not (Test-Path -LiteralPath $source)) {
    throw "STOPPED SAFELY: Required file missing: $relative"
  }
  $currentHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($currentHash -ne $item.expected_old_sha256) {
    if ($currentHash -eq $item.new_sha256) {
      throw "ALREADY INSTALLED: $relative matches the new patch. No files changed."
    }
    throw "STOPPED SAFELY: SOURCE MISMATCH in $relative. Expected $($item.expected_old_sha256), got $currentHash. Do not force an overwrite."
  }
  $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sourceHash -ne $item.new_sha256) {
    throw "STOPPED SAFELY: Patch package integrity check failed for $relative."
  }
  Write-Host "[VERIFIED] $relative" -ForegroundColor Green
}

$backups = Join-Path $env:LOCALAPPDATA ('CodeAuthenticPatchBackups\startup_fix_' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
foreach ($item in $manifest.files) {
  $relative = $item.path.Replace('/', [IO.Path]::DirectorySeparatorChar)
  $dest = Join-Path $backups $relative
  New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $project $relative) -Destination $dest -Force
}
Write-Host "[BACKUP] $backups" -ForegroundColor Cyan

try {
  foreach ($item in $manifest.files) {
    $relative = $item.path.Replace('/', [IO.Path]::DirectorySeparatorChar)
    $dest = Join-Path $project $relative
    Copy-Item -LiteralPath (Join-Path $patchRoot $relative) -Destination $dest -Force
    $check = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($check -ne $item.new_sha256) { throw "Verification failed after writing $relative" }
    Write-Host "[UPDATED] $relative" -ForegroundColor Green
  }
} catch {
  foreach ($item in $manifest.files) {
    $relative = $item.path.Replace('/', [IO.Path]::DirectorySeparatorChar)
    Copy-Item -LiteralPath (Join-Path $backups $relative) -Destination (Join-Path $project $relative) -Force
  }
  throw "PATCH FAILED AND ROLLED BACK: $($_.Exception.Message)"
}
Write-Host '[SUCCESS] Frontend startup scan restricted; no backend or ML files touched.' -ForegroundColor Green
Write-Host '[NEXT] npm run build, then restart the frontend and retest.'
