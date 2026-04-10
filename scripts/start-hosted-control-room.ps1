param(
  [switch]$ServerOnly,
  [switch]$NoBrowser,
  [string]$BindHost = "127.0.0.1",
  [int]$LocalPort = 4310,
  [int]$RemotePort = 4177,
  [string]$SshUser,
  [string]$SshHost
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFiles = @(
  (Join-Path $repoRoot ".env"),
  (Join-Path $repoRoot ".env.example")
)

function Get-EnvFileValue {
  param(
    [string]$Key
  )

  $pattern = '^\s*' + [regex]::Escape($Key) + '\s*=\s*(.*)\s*$'
  foreach ($envFile in $envFiles) {
    if (-not (Test-Path -LiteralPath $envFile)) {
      continue
    }

    foreach ($line in Get-Content -LiteralPath $envFile) {
      if ($line -match '^\s*#') {
        continue
      }

      if ($line -notmatch $pattern) {
        continue
      }

      $value = $Matches[1].Trim()
      if ($value.StartsWith('"') -and $value.EndsWith('"')) {
        $value = $value.Substring(1, $value.Length - 2)
      } elseif ($value.StartsWith("'") -and $value.EndsWith("'")) {
        $value = $value.Substring(1, $value.Length - 2)
      }

      if (-not [string]::IsNullOrWhiteSpace($value)) {
        return $value
      }
    }
  }

  return $null
}

function Get-EffectiveEnvValue {
  param(
    [string[]]$Keys
  )

  foreach ($key in $Keys) {
    $processValue = [Environment]::GetEnvironmentVariable($key)
    if (-not [string]::IsNullOrWhiteSpace($processValue)) {
      return $processValue.Trim()
    }
  }

  foreach ($key in $Keys) {
    $fileValue = Get-EnvFileValue -Key $key
    if (-not [string]::IsNullOrWhiteSpace($fileValue)) {
      return $fileValue.Trim()
    }
  }

  return $null
}

function Get-EffectiveIntValue {
  param(
    [string[]]$Keys,
    [int]$DefaultValue
  )

  $rawValue = Get-EffectiveEnvValue -Keys $Keys
  if ([string]::IsNullOrWhiteSpace($rawValue)) {
    return $DefaultValue
  }

  $parsedValue = 0
  if ([int]::TryParse($rawValue.Trim(), [ref]$parsedValue)) {
    return $parsedValue
  }

  return $DefaultValue
}

function Resolve-SshExecutable {
  $sshCommand = Get-Command ssh.exe -ErrorAction SilentlyContinue
  if ($sshCommand) {
    return $sshCommand.Source
  }

  $sshCommand = Get-Command ssh -ErrorAction SilentlyContinue
  if ($sshCommand) {
    return $sshCommand.Source
  }

  throw "OpenSSH client not found. Install the Windows OpenSSH client so this launcher can open the VPS tunnel."
}

function Test-ControlRoomHttp {
  param(
    [string]$Url
  )

  try {
    $response = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 5
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
      return $false
    }

    $content = [string]$response.Content
    if ([string]::IsNullOrWhiteSpace($content)) {
      return $false
    }

    return $content.Contains("Control Room Login") -or
      $content.Contains("Owner password") -or
      $content.Contains("Folder-Style Office Explorer") -or
      $content.Contains("Scoped Orchestrator Chat")
  } catch {
    return $false
  }
}

function Wait-ControlRoomReady {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 120
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-ControlRoomHttp -Url $Url) {
      return $true
    }

    Start-Sleep -Seconds 1
  }

  return $false
}

function Get-ControlRoomPortOwners {
  param(
    [string]$HostName,
    [int]$PortNumber
  )

  try {
    $connections = @(
      Get-NetTCPConnection -LocalPort $PortNumber -State Listen -ErrorAction Stop |
        Where-Object {
          $_.LocalAddress -eq $HostName -or
          $_.LocalAddress -eq "0.0.0.0" -or
          $_.LocalAddress -eq "::" -or
          $_.LocalAddress -eq "::1"
        }
    )
  } catch {
    return @()
  }

  $owners = @()
  foreach ($processId in ($connections | Select-Object -ExpandProperty OwningProcess -Unique)) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
    if (-not $process) {
      continue
    }

    $owners += [PSCustomObject]@{
      Id = $processId
      Name = $process.ProcessName
      Path = $process.Path
      CommandLine = $cim.CommandLine
    }
  }

  return $owners
}

function Test-DirectTunnelOwner {
  param(
    [pscustomobject]$Owner,
    [string]$HostName,
    [int]$PortNumber,
    [int]$TargetRemotePort
  )

  $processText = @($Owner.Name, $Owner.Path, $Owner.CommandLine) -join "`n"
  $forwardSpec = [regex]::Escape("$HostName`:$PortNumber`:127.0.0.1`:$TargetRemotePort")

  return $processText -match "start-hosted-control-room\.ps1" -or
    ($processText -match "ssh(\.exe)?" -and $processText -match $forwardSpec)
}

function Test-RepoManagedOwner {
  param(
    [pscustomobject]$Owner,
    [string]$HostName,
    [int]$PortNumber,
    [int]$TargetRemotePort
  )

  if (Test-DirectTunnelOwner -Owner $Owner -HostName $HostName -PortNumber $PortNumber -TargetRemotePort $TargetRemotePort) {
    return $true
  }

  $processText = @($Owner.Name, $Owner.Path, $Owner.CommandLine) -join "`n"
  return $processText -match [regex]::Escape($repoRoot) -or
    $processText -match "control-room-local" -or
    $processText -match "start-local-control-room\.ps1"
}

function Stop-ManagedOwners {
  param(
    [pscustomobject[]]$Owners
  )

  foreach ($owner in $Owners) {
    Stop-Process -Id $owner.Id -Force -ErrorAction Stop
  }

  Start-Sleep -Milliseconds 750
}

$LocalPort = Get-EffectiveIntValue -Keys @("CONTROL_ROOM_LOCAL_PORT") -DefaultValue $LocalPort
$RemotePort = Get-EffectiveIntValue -Keys @("CONTROL_ROOM_PORT") -DefaultValue $RemotePort

if ([string]::IsNullOrWhiteSpace($SshHost)) {
  $SshHost = Get-EffectiveEnvValue -Keys @("IMON_ENGINE_VPS_HOST", "IMON_ENGINE_HOST_IP")
}

if ([string]::IsNullOrWhiteSpace($SshUser)) {
  $SshUser = Get-EffectiveEnvValue -Keys @("IMON_ENGINE_VPS_USER")
}

if ([string]::IsNullOrWhiteSpace($SshUser)) {
  $SshUser = "root"
}

$appUrl = "http://${BindHost}:$LocalPort/"
$loginUrl = "http://${BindHost}:$LocalPort/login"
$sshExe = Resolve-SshExecutable

if ($ServerOnly) {
  if ([string]::IsNullOrWhiteSpace($SshHost)) {
    $enteredHost = Read-Host "Enter the VPS host or IP for the control-room SSH tunnel"
    if ([string]::IsNullOrWhiteSpace($enteredHost)) {
      throw "Missing VPS host. Set IMON_ENGINE_VPS_HOST or enter the host in this PowerShell window."
    }

    $SshHost = $enteredHost.Trim()
  }

  Write-Host "Opening the hosted control room on $appUrl through $SshUser@$SshHost" -ForegroundColor Cyan
  Write-Host "Complete any ssh host-key or password prompts in this window. Close this window when you want to disconnect." -ForegroundColor Yellow

  $sshArgs = @(
    "-N",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-L", "$BindHost`:$LocalPort`:127.0.0.1`:$RemotePort",
    "$SshUser@$SshHost"
  )

  & $sshExe @sshArgs
  return
}

$owners = @(Get-ControlRoomPortOwners -HostName $BindHost -PortNumber $LocalPort)
if ($owners.Count -gt 0) {
  $unrelatedOwners = @($owners | Where-Object {
    -not (Test-RepoManagedOwner -Owner $_ -HostName $BindHost -PortNumber $LocalPort -TargetRemotePort $RemotePort)
  })
  if ($unrelatedOwners.Count -gt 0) {
    $description = ($unrelatedOwners | ForEach-Object {
      if ($_.CommandLine) {
        return "$($_.Id): $($_.CommandLine)"
      }
      return "$($_.Id): $($_.Name)"
    }) -join "; "
    throw "Port $LocalPort is already in use by another process. Free the port or stop the other listener before retrying. Owners: $description"
  }

  $directTunnelOwners = @($owners | Where-Object {
    Test-DirectTunnelOwner -Owner $_ -HostName $BindHost -PortNumber $LocalPort -TargetRemotePort $RemotePort
  })
  if ($directTunnelOwners.Count -eq $owners.Count) {
    if (Wait-ControlRoomReady -Url $loginUrl) {
      if (-not $NoBrowser) {
        Start-Process $appUrl
      }
      return
    }

    throw "The existing control-room tunnel on $appUrl did not become ready. Keep the PowerShell tunnel window open and finish any ssh prompts there."
  }

  Stop-ManagedOwners -Owners $owners
}

$serverArgs = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-NoExit",
  "-File", (Join-Path $PSScriptRoot "start-hosted-control-room.ps1"),
  "-ServerOnly",
  "-BindHost", $BindHost,
  "-LocalPort", "$LocalPort",
  "-RemotePort", "$RemotePort",
  "-SshUser", $SshUser
)

if (-not [string]::IsNullOrWhiteSpace($SshHost)) {
  $serverArgs += @("-SshHost", $SshHost)
}

Start-Process -FilePath "powershell.exe" -ArgumentList $serverArgs -WindowStyle Normal | Out-Null

if (Wait-ControlRoomReady -Url $loginUrl) {
  if (-not $NoBrowser) {
    Start-Process $appUrl
  }
  return
}

throw "The direct control-room tunnel did not become ready within 120 seconds. Keep the PowerShell tunnel window open and finish any ssh host-key or password prompts there."