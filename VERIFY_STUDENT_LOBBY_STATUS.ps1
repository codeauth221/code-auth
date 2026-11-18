param([string]$BaseUrl = 'http://127.0.0.1:8000')
$ErrorActionPreference = 'Stop'
try {
    $spec = Invoke-RestMethod -Uri ($BaseUrl.TrimEnd('/') + '/openapi.json') -TimeoutSec 15
    $entry = $spec.paths.'/public/lobbies/{lobby_id}/status'.get
    $props = $spec.components.schemas.LobbyPublicStatus.properties
    if ($null -eq $entry -or $null -eq $props.closed_reason -or $null -eq $props.expires_at) {
        Write-Host '[ROUTE NOT UPDATED] The running backend does not expose closure details.' -ForegroundColor Yellow
        Write-Host 'Close both server windows, restart START_SYSTEM.bat, and run this check again.'
        exit 1
    }
    Write-Host '[READY] Public lobby status exposes closed_reason and expires_at.' -ForegroundColor Green
    Write-Host 'Expiry and instructor-lock reasons can now be displayed on the student page.'
} catch {
    Write-Host "[UNAVAILABLE] Cannot check FastAPI: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
