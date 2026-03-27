param(
  [switch]$ServerOnly,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$bindHost = "127.0.0.1"
$port = 4310
$appUrl = "http://${bindHost}:$port/"

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

if ($ServerOnly) {
  Set-Location -LiteralPath $repoRoot
  npm run dev -- control-room-local
  exit $LASTEXITCODE
}

if (-not (Test-ControlRoomPort -HostName $bindHost -PortNumber $port)) {
  Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList @(
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      $PSCommandPath,
      "-ServerOnly"
    ) `
    -WorkingDirectory $repoRoot `
    -WindowStyle Minimized | Out-Null

  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    if (Test-ControlRoomPort -HostName $bindHost -PortNumber $port) {
      break
    }
    Start-Sleep -Milliseconds 500
  }
}

if (-not (Test-ControlRoomPort -HostName $bindHost -PortNumber $port)) {
  throw "The local Imon control room did not start within 30 seconds."
}

if (-not $NoBrowser) {
  Start-Process $appUrl | Out-Null
}

Write-Output "Imon control room ready at $appUrl"
