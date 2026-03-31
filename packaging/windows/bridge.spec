from pathlib import Path


project_root = Path.cwd()


a = Analysis(
    ['local_bridge_server.py'],
    pathex=[str(project_root)],
    binaries=[],
    datas=[
        ('configs', 'configs'),
        ('README.md', '.'),
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

