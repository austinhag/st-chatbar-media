# scripts/dev.ps1
$ErrorActionPreference = "Stop"

# Go to repo root (directory containing this script's parent)
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

Write-Host "Repo root: $RepoRoot"

# Ensure venv is active (optional check)
if (-not $env:VIRTUAL_ENV) {
  Write-Host "Note: No venv detected. Activate it first: .\.venv\Scripts\Activate.ps1" -ForegroundColor Yellow
}

# 1) Build + sync frontend into the Python package
Write-Host "Building frontend..." -ForegroundColor Cyan
Push-Location ".\frontend"
npm install
npm run build:pkg
Pop-Location

# 2) Run the Streamlit demo app
Write-Host "Starting Streamlit demo..." -ForegroundColor Cyan
streamlit run ".\examples\demo_app.py"