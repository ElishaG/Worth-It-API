$ErrorActionPreference = "Stop"
if (-not (Test-Path ".env")) { throw ".env does not exist. Run .\scripts\setup.ps1 first." }
$required = @("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY")
$content = Get-Content ".env"
foreach ($name in $required) {
  $line = $content | Where-Object { $_ -match "^$name=" } | Select-Object -First 1
  if (-not $line -or $line -match "REPLACE_ME" -or $line -match "^$name=$") {
    throw "$name is missing or still contains REPLACE_ME."
  }
}
Write-Host "Required environment values are present." -ForegroundColor Green
