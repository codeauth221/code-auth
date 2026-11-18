param(
  [string]$Frontend = 'http://localhost:3000',
  [string]$Backend = 'http://127.0.0.1:8000'
)
$ProgressPreference='SilentlyContinue'
$cases = @(
  @{ Name='Frontend HTML'; Url="$Frontend/" },
  @{ Name='React entry'; Url="$Frontend/src/main.tsx" },
  @{ Name='React app'; Url="$Frontend/src/App.tsx" },
  @{ Name='Tailwind stylesheet'; Url="$Frontend/src/index.css" },
  @{ Name='Backend health'; Url="$Backend/health" }
)
foreach ($case in $cases) {
  $sw=[System.Diagnostics.Stopwatch]::StartNew()
  try {
    $response=Invoke-WebRequest -Uri $case.Url -UseBasicParsing -TimeoutSec 120 -Headers @{ 'Cache-Control'='no-cache' }
    $sw.Stop()
    Write-Host ('{0,-20} {1,6:n2}s  HTTP {2}' -f $case.Name, $sw.Elapsed.TotalSeconds, [int]$response.StatusCode)
  } catch {
    $sw.Stop()
    Write-Host ('{0,-20} {1,6:n2}s  ERROR: {2}' -f $case.Name, $sw.Elapsed.TotalSeconds, $_.Exception.Message) -ForegroundColor Red
  }
}
Write-Host 'NOTE: These are HTTP/transform timings, not total browser rendering time.'
