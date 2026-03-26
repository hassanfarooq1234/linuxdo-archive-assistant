$ErrorActionPreference = 'Stop'

$protocolName = 'linuxdo-archive'
$launcherScript = (Resolve-Path (Join-Path $PSScriptRoot 'launch-bridge-protocol.ps1')).Path
$protocolRoot = "Registry::HKEY_CURRENT_USER\Software\Classes\$protocolName"
$commandKey = Join-Path $protocolRoot 'shell\open\command'
$commandValue = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$launcherScript`" `"%1`""

New-Item -Path $protocolRoot -Force -Value 'URL:LinuxDo Archive Protocol' | Out-Null
New-ItemProperty -Path $protocolRoot -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
New-Item -Path $commandKey -Force -Value $commandValue | Out-Null

Write-Host "[OK] Registered protocol: ${protocolName}://"
Write-Host "[OK] Launcher script: $launcherScript"
