$ErrorActionPreference = "Stop"

# --- Version bump ---
$currentVersion = (Select-String -Path "pyproject.toml" -Pattern 'version = "(.+)"').Matches[0].Groups[1].Value
Write-Host "Current version: $currentVersion"
$newVersion = Read-Host "New version"
if ([string]::IsNullOrWhiteSpace($newVersion)) {
    Write-Error "Version cannot be empty."
    exit 1
}

(Get-Content pyproject.toml) -replace "version = `"$currentVersion`"", "version = `"$newVersion`"" |
    Set-Content pyproject.toml

Write-Host "Updated pyproject.toml to $newVersion"

# --- Frontend build ---
Push-Location "frontend"
npm install
npm run build:pkg
Pop-Location

# --- Python build ---
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue
python -m build
python -m twine check dist/*

# --- Git tag ---
$tag = "v$newVersion"
git add pyproject.toml
git commit -m "chore: bump version to $newVersion"
git tag $tag
Write-Host "Created git tag $tag"
Write-Host ""
Write-Host "To publish: python -m twine upload dist/*"
Write-Host "To push tag: git push origin main $tag"