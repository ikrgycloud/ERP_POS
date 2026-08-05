param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"

$BackendRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RepoRoot = (Resolve-Path (Join-Path $BackendRoot "..")).Path
$Python = Join-Path $BackendRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $Python)) {
    $Python = "python"
}

$env:PYTHONPATH = "$RepoRoot;$BackendRoot"
$env:ENVIRONMENT = "development"

Set-Location $BackendRoot

Write-Host "Starting POS Backend on http://0.0.0.0:$Port"
& $Python -m uvicorn app.main:app --host 0.0.0.0 --port $Port
