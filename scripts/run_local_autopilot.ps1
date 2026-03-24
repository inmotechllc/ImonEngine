$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$opsDir = Join-Path $repoRoot "runtime\ops"
$logPath = Join-Path $opsDir "autopilot-runner.log"
$runReportPath = Join-Path $opsDir "autopilot-last-run.json"

New-Item -ItemType Directory -Force -Path $opsDir | Out-Null
Set-Location $repoRoot

function Write-LogLine {
  param([string]$Message)

  $line = "[{0}] {1}" -f (Get-Date -Format s), $Message
  Add-Content -Path $logPath -Value $line
}

Write-LogLine "Starting repo-controlled autopilot work unit."

& npm.cmd run dev -- autopilot-run-once *>> $logPath
if ($LASTEXITCODE -ne 0) {
  Write-LogLine "Autopilot command failed with exit code $LASTEXITCODE."
  exit $LASTEXITCODE
}

$report = $null
if (Test-Path $runReportPath) {
  try {
    $report = Get-Content $runReportPath -Raw | ConvertFrom-Json
  } catch {
    $report = $null
  }
}

if ($report -and -not $report.changed -and [string]$report.status -eq "idle") {
  Write-LogLine "No durable work was produced in this run."
  exit 0
}

$status = git status --porcelain
if ($status) {
  git add .
  $summary = "Autopilot work unit"
  if ($report -and $report.summary) {
    $summary = [string]$report.summary
  } elseif (Test-Path $runReportPath) {
    try {
      $summary = [string]((Get-Content $runReportPath -Raw | ConvertFrom-Json).summary)
    } catch {
      $summary = "Autopilot work unit"
    }
  }
  if ([string]::IsNullOrWhiteSpace($summary)) {
    $summary = "Autopilot work unit"
  }

  git commit -m "Autopilot: $summary" *>> $logPath
  if ($LASTEXITCODE -eq 0) {
    git push origin HEAD:main *>> $logPath
    if ($LASTEXITCODE -eq 0) {
      Write-LogLine "Pushed autopilot changes to GitHub."

      if ($env:IMON_ENGINE_VPS_PASSWORD) {
        & python scripts\sync_vps_repo.py `
          --post-command "cd /opt/imon-engine && npm run build" `
          --post-command "cd /opt/imon-engine && npm run dev -- engine-sync" `
          --post-command "cd /opt/imon-engine && npm run dev -- vps-artifacts" *>> $logPath

        if ($LASTEXITCODE -eq 0) {
          Write-LogLine "Synced autopilot changes to the VPS."
        } else {
          Write-LogLine "VPS sync failed; see sync_vps_repo.py output above."
        }
      } else {
        Write-LogLine "Skipped VPS sync because IMON_ENGINE_VPS_PASSWORD is not set."
      }
    } else {
      Write-LogLine "git push failed."
      exit $LASTEXITCODE
    }
  }
}

Write-LogLine "Autopilot work unit finished."
