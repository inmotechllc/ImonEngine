param(
  [string]$TaskName = "ImonEngineStoreAutopilot"
)

$ErrorActionPreference = "Stop"

$taskQuery = schtasks /Query /TN $TaskName 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Scheduled task '$TaskName' does not exist."
  exit 0
}

schtasks /Change /TN $TaskName /Disable | Out-Host
Write-Host "Scheduled task '$TaskName' is now disabled."
