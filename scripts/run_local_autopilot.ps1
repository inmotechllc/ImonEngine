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
        $uploadSpecs = @(
          "$repoRoot\\runtime\\state\\assetPacks.json::/opt/imon-engine/runtime/state/assetPacks.json",
          "$repoRoot\\runtime\\state\\growthQueue.json::/opt/imon-engine/runtime/state/growthQueue.json",
          "$repoRoot\\runtime\\state\\growthPolicies.json::/opt/imon-engine/runtime/state/growthPolicies.json",
          "$repoRoot\\runtime\\state\\allocationPolicies.json::/opt/imon-engine/runtime/state/allocationPolicies.json",
          "$repoRoot\\runtime\\state\\allocationSnapshots.json::/opt/imon-engine/runtime/state/allocationSnapshots.json",
          "$repoRoot\\runtime\\state\\collectiveSnapshots.json::/opt/imon-engine/runtime/state/collectiveSnapshots.json",
          "$repoRoot\\runtime\\state\\salesTransactions.json::/opt/imon-engine/runtime/state/salesTransactions.json",
          "$repoRoot\\runtime\\state\\socialProfiles.json::/opt/imon-engine/runtime/state/socialProfiles.json"
        )

        $syncArgs = @(
          "scripts\\sync_vps_repo.py"
        )
        foreach ($uploadSpec in $uploadSpecs) {
          if (Test-Path ($uploadSpec.Split("::")[0])) {
            $syncArgs += "--upload-file"
            $syncArgs += $uploadSpec
          }
        }
        $syncArgs += @(
          "--post-command", "cd /opt/imon-engine && npm run build",
          "--post-command", "cd /opt/imon-engine && npm run dev -- engine-sync",
          "--post-command", "cd /opt/imon-engine && npm run dev -- social-profiles",
          "--post-command", "cd /opt/imon-engine && npm run dev -- growth-queue",
          "--post-command", "cd /opt/imon-engine && npm run dev -- revenue-report",
          "--post-command", "cd /opt/imon-engine && npm run dev -- collective-fund-report",
          "--post-command", "cd /opt/imon-engine && npm run dev -- vps-artifacts"
        )

        & python @syncArgs *>> $logPath

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
exit 0
