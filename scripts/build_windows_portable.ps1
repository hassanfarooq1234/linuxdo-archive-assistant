$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$build = Join-Path $root 'build'
$release = Join-Path $dist 'windows-portable'

Set-Location $root

Write-Host '[1/5] Installing packaging dependency...'
uv pip install pyinstaller

Write-Host '[2/5] Cleaning old build output...'
if (Test-Path $release) { Remove-Item -Recurse -Force $release }
if (Test-Path $build) { Remove-Item -Recurse -Force $build }

Write-Host '[3/5] Building bridge executable...'
uv run pyinstaller .\packaging\windows\bridge.spec --noconfirm --distpath $release --workpath $build

Write-Host '[4/5] Copying extension and docs...'
Copy-Item -Recurse -Force .\browser-extension (Join-Path $release 'browser-extension')
Copy-Item -Recurse -Force .\configs (Join-Path $release 'configs')
Copy-Item -Force .\README.md (Join-Path $release 'README.md')
Copy-Item -Force .\docs\windows-portable-guide.md (Join-Path $release 'WINDOWS-PORTABLE-GUIDE.md')

$launchStart = @(
  '@echo off',
  'setlocal',
  'cd /d "%~dp0"',
  'if not exist "%~dp0workspace" mkdir "%~dp0workspace"',
  'if not exist "%~dp0workspace\cases" mkdir "%~dp0workspace\cases"',
  'if not exist "%~dp0workspace\logs" mkdir "%~dp0workspace\logs"',
  'linuxdo-archive-bridge.exe --workspace-root "%~dp0workspace"',
  'pause'
)

$launchStop = @(
  '@echo off',
  'powershell -NoProfile -ExecutionPolicy Bypass -Command "$conn = Get-NetTCPConnection -LocalPort 17805 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($null -eq $conn) { Write-Host ''[INFO] No running bridge found.''; exit 0 }; Stop-Process -Id $conn.OwningProcess -Force; Write-Host (''[OK] Stopped PID '' + $conn.OwningProcess)"',
  'pause'
)

$openExt = @(
  '@echo off',
  'start "" explorer.exe "%~dp0browser-extension"'
)

$openOut = @(
  '@echo off',
  'if not exist "%~dp0workspace\cases" mkdir "%~dp0workspace\cases"',
  'start "" explorer.exe "%~dp0workspace\cases"'
)

Set-Content -LiteralPath (Join-Path $release '01-start-bridge.cmd') -Value $launchStart -Encoding Ascii
Set-Content -LiteralPath (Join-Path $release '02-stop-bridge.cmd') -Value $launchStop -Encoding Ascii
Set-Content -LiteralPath (Join-Path $release '03-open-extension-folder.cmd') -Value $openExt -Encoding Ascii
Set-Content -LiteralPath (Join-Path $release '04-open-output-folder.cmd') -Value $openOut -Encoding Ascii

Write-Host '[5/5] Portable bundle ready:'
Write-Host $release
