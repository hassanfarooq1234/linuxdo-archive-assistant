from pathlib import Path


project_root = Path.cwd()
entry_script = project_root / 'local_bridge_server.py'


a = Analysis(
    [str(entry_script)],
    pathex=[str(project_root)],
    binaries=[],
    datas=[
        (str(project_root / 'configs'), 'configs'),
        (str(project_root / 'README.md'), '.'),
    ],
    hiddenimports=['markdown', 'lxml', 'playwright', 'requests'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='linuxdo-archive-bridge',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
