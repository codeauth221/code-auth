# CodeAuthentic Analysis Timer — exact-source verified installer
# Targeted changes: backend timings + React dashboard. No ML changes.
param([Parameter(Mandatory=$true)][string]$ProjectRoot)
$ErrorActionPreference = 'Stop'
$patchRoot = $PSScriptRoot
$targets = @(
    @{ Path = "backend/models.py"; Expected = "26E4D737810C2280EA8F710C0225CFA645C84946C2FEDE09B1C0107B4F98AC23"; Patched = "228C5ADA321BD374474AB52EC6119FE4A00A1FAC1BF8D93C0BDAAA5D77BA5E26" }
    @{ Path = "backend/database.py"; Expected = "8451DA3CCF8CBF9E4E27D96C5CB84F185F5E3AD6C03E6FA93CC097719C0CC5DA"; Patched = "A7AA6C2B2EAD04F5981EFE21035819CBCCB592D34F6CDE01C89A5DCB7D049BA1" }
    @{ Path = "backend/schemas.py"; Expected = "C2C95265E39E1B5A305AE0840F8366AFBE9C13B4577B6B00C41B4997F5558AB0"; Patched = "206AA8608C0473A9A3F0FABB7F20584BCBA79DEB997E9AA97171B6ABDAFE8A51" }
    @{ Path = "backend/analysis.py"; Expected = "6663E07EEECA033428BAE465CA8478AC250E1D62B8013D183A66B75CB09A04A2"; Patched = "0A0D2662CB86938F58E60FA16068DF5B052123622ABF17FA1D3122AB20E53C83" }
    @{ Path = "backend/routes/dashboard.py"; Expected = "4E31A90A4CA8D5CD0E635A7127F65FE422592EEA8E499EE7560FE8BBD35AF9A9"; Patched = "E7EFE361C9C9EF419C25FD24A84D3C4B5A0DE9D2FBB0F72C02204DB5FC090F1F" }
    @{ Path = "src/types.ts"; Expected = "4D0E371108081F3ADCAD35F44F23A886A83F43ED3ED4F0A50A62606496C9912F"; Patched = "D82DD28E6EDCD030CD2C19C5EF0E9F92C4BE500F7CAA141367CE7E767AE0EDCC" }
    @{ Path = "src/utils/api.ts"; Expected = "00B88277495F7516514C728A6729D1A018296BAA1E3457C3EB9BFD004D614DC1"; Patched = "CA10FF9DF0264F8888D38169E78177E4B8F5871C0BF73F0353DB09CAA3499846" }
    @{ Path = "src/components/InstructorDashboard.tsx"; Expected = "6661C3BD79F57B5422871DE2E35B7E10763B2B8536503603C434D537F7BA033F"; Patched = "155E095F2981E06EAC01C61332B3CBB26FD6F49CBA1ECB0045A8E2D3926EFAF0" }
)
if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
  throw "Project folder not found: $ProjectRoot"
}
$project = (Resolve-Path -LiteralPath $ProjectRoot).Path
$allPatched = $true
# Stop before ANY modification if a source file differs or the ZIP was edited.
foreach ($item in $targets) {
  $relative = $item.Path.Replace('/', [IO.Path]::DirectorySeparatorChar)
  $dest = Join-Path $project $relative
  $src = Join-Path $patchRoot $relative
  if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { throw "Patch file missing: $src" }
  if (-not (Test-Path -LiteralPath $dest -PathType Leaf)) { throw "Project file missing: $dest" }
  $patchHash = (Get-FileHash -LiteralPath $src -Algorithm SHA256).Hash
  if ($patchHash -ne $item.Patched) { throw "PATCH INTEGRITY ERROR: $relative" }
  $actual = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
  if ($actual -ne $item.Expected -and $actual -ne $item.Patched) {
    throw "STOPPED SAFELY: SOURCE MISMATCH in $relative. No files replaced. Provide a fresh source ZIP; do not force the patch."
  }
  if ($actual -ne $item.Patched) { $allPatched = $false }
  Write-Host "[VERIFIED] $relative"
}
$testRel = 'tests\test_analysis_timing.py'
$testSource = Join-Path $patchRoot $testRel
$testTarget = Join-Path $project $testRel
if (-not (Test-Path -LiteralPath $testSource -PathType Leaf)) { throw "Patch test missing" }
if (Test-Path -LiteralPath $testTarget -PathType Leaf) {
  $testOld = (Get-FileHash -LiteralPath $testTarget -Algorithm SHA256).Hash
  $testNew = (Get-FileHash -LiteralPath $testSource -Algorithm SHA256).Hash
  if ($testOld -ne $testNew) { throw "STOPPED SAFELY: Existing timing test has different contents." }
}
if ($allPatched -and (Test-Path -LiteralPath $testTarget -PathType Leaf)) {
  Write-Host '[ALREADY INSTALLED] No changes made.' -ForegroundColor Green
  exit 0
}
# Back up ALL original source files, and separately remind about DB backup.
$baseBackup = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { $env:TEMP }
$backupDir = Join-Path $baseBackup ('CodeAuthenticPatchBackups\elapsed_timer_' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
foreach ($item in $targets) {
  $relative = $item.Path.Replace('/', [IO.Path]::DirectorySeparatorChar)
  $backup = Join-Path $backupDir $relative
  New-Item -ItemType Directory -Path (Split-Path $backup -Parent) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $project $relative) -Destination $backup -Force
}
Write-Host "[BACKUP] $backupDir"
try {
  foreach ($item in $targets) {
    $relative = $item.Path.Replace('/', [IO.Path]::DirectorySeparatorChar)
    $dest = Join-Path $project $relative
    if ((Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash -eq $item.Patched) { continue }
    Copy-Item -LiteralPath (Join-Path $patchRoot $relative) -Destination $dest -Force
    Write-Host "[UPDATED] $relative"
  }
  if (-not (Test-Path -LiteralPath $testTarget -PathType Leaf)) {
    New-Item -ItemType Directory -Path (Split-Path $testTarget -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $testSource -Destination $testTarget
    Write-Host '[ADDED] tests\test_analysis_timing.py'
  }
} catch {
  Write-Warning 'Installation failed, restoring backed-up source files.'
  foreach ($item in $targets) {
    $relative = $item.Path.Replace('/', [IO.Path]::DirectorySeparatorChar)
    Copy-Item -LiteralPath (Join-Path $backupDir $relative) -Destination (Join-Path $project $relative) -Force
  }
  throw
}
Write-Host '[SUCCESS] Backend timing + instructor UI installed.' -ForegroundColor Green
Write-Host '[NOTE] Next backend startup adds two NULLABLE columns to submissions (no rows deleted). Back up your PostgreSQL database before restart.' -ForegroundColor Yellow
Write-Host '[NEXT] Restart both backend and frontend via START_SYSTEM.bat; run tests then submit a fresh file.'
