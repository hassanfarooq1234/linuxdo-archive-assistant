$ErrorActionPreference = 'Stop'

$protocolName = 'linuxdo-archive'
$protocolRoot = "Registry::HKEY_CURRENT_USER\Software\Classes\$protocolName"

if (Test-Path $protocolRoot) {
    Remove-Item -Path $protocolRoot -Recurse -Force
    Write-Host "[OK] Removed protocol: ${protocolName}://"
}
else {
    Write-Host "[INFO] Protocol not found: ${protocolName}://"
}
