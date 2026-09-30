$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error "Node.js not found. Install Node >=18.17.0."; exit 1 }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Write-Error "npm not found. Repair Node install."; exit 1 }
node --version
npm --version
npm install
if ($args -contains "--update" -or $args -contains "-Update") { npm update }
node scripts/ensure-deps.js
Read-Host "Press Enter to close"
