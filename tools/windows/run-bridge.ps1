param(
    [Parameter(Mandatory = $true)]
    [string]$WorkspaceRoot
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repoRoot

& uv run python .\local_bridge_server.py --workspace-root $WorkspaceRoot
