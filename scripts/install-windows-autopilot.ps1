param(
  [string]$TaskName = "ImonEngineStoreAutopilot"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$runnerScript = Join-Path $PSScriptRoot "run_local_autopilot.ps1"
$startTime = (Get-Date).AddMinutes(5).ToString("HH:mm")
$escapedRunner = $runnerScript.Replace('"', '""')
$taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$escapedRunner`""

schtasks /Create /F /SC HOURLY /MO 1 /TN $TaskName /TR $taskCommand /ST $startTime | Out-Host
Write-Host "Scheduled task '$TaskName' to run hourly starting at $startTime."
Write-Host "Runner script: $runnerScript"
