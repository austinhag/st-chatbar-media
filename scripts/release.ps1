$ErrorActionPreference = "Stop"
Push-Location "frontend"
npm install
npm run build:pkg
Pop-Location

python -m build
python -m twine check dist/*