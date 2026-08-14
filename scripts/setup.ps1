$ErrorActionPreference = "Stop"

Write-Host "Worth It API setup" -ForegroundColor Green
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js was not found. Install Node.js 20 or newer, restart PowerShell, and try again."
}

Write-Host "Node version: $(node -v)"
Write-Host "Installing project packages..."
npm.cmd install

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "1. Open .env: notepad .env"
Write-Host "2. Add SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY."
Write-Host "3. Keep RECOGNITION_PROVIDER=mock and MARKET_PROVIDER=mock for the first test."
Write-Host "4. Start the API: npm.cmd run dev"
Write-Host "5. In a second PowerShell window, start the worker: npm.cmd run dev:worker"
