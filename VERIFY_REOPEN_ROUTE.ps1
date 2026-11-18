param([string]$BaseUrl = 'http://127.0.0.1:8000')
$ErrorActionPreference = 'Stop'
$address = $BaseUrl.TrimEnd('/') + '/openapi.json'
Write-Host "Checking running FastAPI OpenAPI at $address"
try {
    $spec = Invoke-RestMethod -Uri $address -Method Get -TimeoutSec 15
} catch {
    Write-Host '[ERROR] Cannot reach FastAPI. Start CodeAuthentic backend and retry.' -ForegroundColor Red
    Write-Host $_.Exception.Message
    exit 1
}
$required = '/lobbies/{lobby_id}/extend-and-reopen'
$routeProperty = $spec.paths.PSObject.Properties[$required]
if ($null -ne $routeProperty -and @($routeProperty.Value.PSObject.Properties.Name) -contains 'post') {
    Write-Host '[ROUTE AVAILABLE] POST /lobbies/{lobby_id}/extend-and-reopen' -ForegroundColor Green
    Write-Host 'Route is registered in the RUNNING server. Sign in as owner and retry the dialog.'
    exit 0
}
Write-Host '[ROUTE MISSING] The RUNNING FastAPI process does not expose Extend & Reopen.' -ForegroundColor Red
Write-Host 'Close stale server windows, restart START_SYSTEM.bat, and rerun this check.'
Write-Host 'Also confirm frontend API points to the localhost Vite proxy.'
exit 1
