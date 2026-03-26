param(
    [string]$ProtocolUrl = ''
)

$ErrorActionPreference = 'Stop'

function Test-BridgeReady {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:17805/health' -TimeoutSec 2
        return $response.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

function Resolve-WorkspaceRoot {
    $desktopDir = [Environment]::GetFolderPath('Desktop')
    $candidate = Get-ChildItem -Path $desktopDir -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like 'LinuxDo*' } |
        Select-Object -First 1

    if ($candidate) {
        return $candidate.FullName
    }

    $fallback = Join-Path $desktopDir 'LinuxDoArchiveWorkspace'
    New-Item -ItemType Directory -Force -Path $fallback | Out-Null
    return $fallback
}

if (Test-BridgeReady) {
    exit 0
}

$runnerScript = (Resolve-Path (Join-Path $PSScriptRoot 'run-bridge.ps1')).Path
$workspaceRoot = Resolve-WorkspaceRoot

Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $runnerScript,
    '-WorkspaceRoot', $workspaceRoot
) | Out-Null

exit 0
