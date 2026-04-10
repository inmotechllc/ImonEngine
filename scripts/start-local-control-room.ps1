param(
  [switch]$ServerOnly,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$bindHost = "127.0.0.1"
$port = 4310
$appUrl = "http://${bindHost}:$port/"
$loginUrl = "http://${bindHost}:$port/login"
$envFiles = @(
  (Join-Path $repoRoot ".env"),
  (Join-Path $repoRoot ".env.example")
)

function ConvertTo-PlainText {
  param(
    [Security.SecureString]$SecureValue
  )

  if (-not $SecureValue) {
    return ""
  }

  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

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

function Use-ControlRoomTunnel {
  $autoTunnel = Get-EffectiveEnvValue -Keys @("CONTROL_ROOM_AUTO_TUNNEL")
  if ($autoTunnel -and $autoTunnel.Trim().ToLowerInvariant() -eq "false") {
    return $false
  }

  $remoteUrl = Get-EffectiveEnvValue -Keys @("CONTROL_ROOM_REMOTE_URL")
  if ([string]::IsNullOrWhiteSpace($remoteUrl)) {
    return $true
  }

  try {
    $remoteUri = [Uri]$remoteUrl
    return $remoteUri.Host -eq "127.0.0.1" -or $remoteUri.Host -eq "localhost"
  } catch {
    return $true
  }
}

function Prompt-ForTunnelCredentialsIfNeeded {
  if (-not (Use-ControlRoomTunnel)) {
    return
  }

  $vpsHost = Get-EffectiveEnvValue -Keys @("IMON_ENGINE_VPS_HOST", "IMON_ENGINE_HOST_IP")
  if ([string]::IsNullOrWhiteSpace($vpsHost)) {
    $enteredHost = Read-Host "Enter the VPS host or IP for the control-room tunnel"
    if ([string]::IsNullOrWhiteSpace($enteredHost)) {
      throw "Missing VPS host. Set IMON_ENGINE_VPS_HOST or enter the host in this PowerShell window."
    }

    $env:IMON_ENGINE_VPS_HOST = $enteredHost.Trim()
  }

  $vpsPassword = Get-EffectiveEnvValue -Keys @("IMON_ENGINE_VPS_PASSWORD", "IMON_ENGINE_HOST_PASSWORD")
  if ([string]::IsNullOrWhiteSpace($vpsPassword)) {
    Write-Host "Enter the VPS password for the control-room tunnel." -ForegroundColor Yellow
    $securePassword = Read-Host -AsSecureString
    $plainPassword = ConvertTo-PlainText -SecureValue $securePassword
    if ([string]::IsNullOrWhiteSpace($plainPassword)) {
      throw "Missing VPS password. Set IMON_ENGINE_VPS_PASSWORD or enter the password in this PowerShell window."
    }

    $env:IMON_ENGINE_VPS_PASSWORD = $plainPassword
  }
}

function Test-ControlRoomPort {
  param(
    [string]$HostName,
    [int]$PortNumber
  )

  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $async = $client.BeginConnect($HostName, $PortNumber, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(750)) {
      $client.Close()
      return $false
    }

    $null = $client.EndConnect($async)
    $client.Close()
    return $true
  } catch {
    return $false
  }
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
      $content.Contains("Folder-Style Office Explorer") -or
      $content.Contains("Scoped Orchestrator Chat")
  } catch {
    return $false
  }
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

function Test-ControlRoomOwner {
  param(
    [pscustomobject]$Owner
  )

  $processText = @($Owner.Name, $Owner.Path, $Owner.CommandLine) -join "`n"
  return $processText -match [regex]::Escape($repoRoot) -or
    $processText -match "control-room-local" -or
    $processText -match "start-local-control-room\.ps1"
}

function Stop-StaleControlRoomOwners {
  param(
    [pscustomobject[]]$Owners
  )

  if (-not $Owners -or $Owners.Count -eq 0) {
    return
  }

  $unrelatedOwners = @($Owners | Where-Object { -not (Test-ControlRoomOwner -Owner $_) })
  if ($unrelatedOwners.Count -gt 0) {
    $description = ($unrelatedOwners | ForEach-Object {
      if ($_.CommandLine) {
        return "$($_.Id): $($_.CommandLine)"
      }
      return "$($_.Id): $($_.Name)"
    }) -join "; "
    throw "Port $port is already in use by a non-control-room process. Free the port or update the launcher configuration before retrying. Owners: $description"
  }

  foreach ($owner in $Owners) {
    Stop-Process -Id $owner.Id -Force -ErrorAction Stop
  }

  Start-Sleep -Milliseconds 750
}

if ($ServerOnly) {
  Prompt-ForTunnelCredentialsIfNeeded
  Set-Location -LiteralPath $repoRoot
  npm run dev -- control-room-local
  exit $LASTEXITCODE
}

$portOpen = Test-ControlRoomPort -HostName $bindHost -PortNumber $port
if ($portOpen -and -not (Test-ControlRoomHttp -Url $loginUrl)) {
  $owners = @(Get-ControlRoomPortOwners -HostName $bindHost -PortNumber $port)
  Stop-StaleControlRoomOwners -Owners $owners
  $portOpen = Test-ControlRoomPort -HostName $bindHost -PortNumber $port
}

if (-not $portOpen) {
  Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList @(
      "-NoExit",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      $PSCommandPath,
      "-ServerOnly"
    ) `
    -WorkingDirectory $repoRoot `
    -WindowStyle Normal | Out-Null

  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    if (
      (Test-ControlRoomPort -HostName $bindHost -PortNumber $port) -and
      (Test-ControlRoomHttp -Url $loginUrl)
    ) {
      break
    }
    Start-Sleep -Milliseconds 500
  }
}

if (
  -not (Test-ControlRoomPort -HostName $bindHost -PortNumber $port) -or
  -not (Test-ControlRoomHttp -Url $loginUrl)
) {
  throw "The local Imon control room did not become ready within 60 seconds. Keep the PowerShell server window open and check its tunnel or startup output."
}

if (-not $NoBrowser) {
  Start-Process $appUrl | Out-Null
}

Write-Output "Imon control room ready at $appUrl"
