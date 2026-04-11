# scripts/demo.ps1
$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

if (-not $env:VIRTUAL_ENV) {
  Write-Host "Note: No venv detected. Activate it first: .\.venv\Scripts\Activate.ps1" -ForegroundColor Yellow
}

Write-Host "Starting demo app..." -ForegroundColor Cyan
streamlit run .\examples\demo_app.py
