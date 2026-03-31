# Refactor: Slim-Down Plan

> Status: **Approved, ready for implementation**
> Author: Claude Opus 4.6 review + user confirmation
> Date: 2026-03-31

## Background

The project was originally designed for CTF challenge scenarios with multiple archiving paths (online scraping, CLI offline import, browser extension + local bridge). The actual user workflow has converged to:

1. User browses linux.do while logged in
2. Clicks browser extension on a post they like
3. Extension collects topic JSON (using the user's session)
4. JSON is sent to a local Python bridge server
5. Bridge generates Markdown + images + PDF
6. User takes the PDF to ask AI (Claude / ChatGPT / Gemini)

Several code paths and features are now dead weight. This document specifies exactly what to remove and what to keep.

---

## Guiding Principle

**Delete, don't refactor.** The goal is to remove unused code paths, not to restructure working code. If something works and is needed, leave it alone.

---

## Phase 1: Remove Online Scraping Path

### 1.1 `archive_core.py`

Delete these three functions entirely:

- `parse_topic_id()` (lines ~112-117) — extracts topic ID from URL, only used by online path
- `build_topic_json_url()` (lines ~120-126) — appends `.json` to topic URL, only used by online path
- `fetch_topic_json()` (lines ~128-188) — the Camoufox-based online scraper, ~60 lines

Delete the import:

```python
# DELETE this line:
from camoufox.sync_api import Camoufox
```

**Do NOT touch** any other function in this file. Everything else (`render_markdown`, `rewrite_post_html_and_download_images`, `render_pdf_from_markdown`, `build_cases_index`, `archive_topic_from_data`, `archive_topic_from_json_file`, etc.) is actively used.

### 1.2 `save_linuxdo_topic.py`

Delete the online-mode code path (the branch that runs when `topic_url` is provided without `--input-json`). This is approximately lines 137-161 in the current file.

Delete these imports from `archive_core`:

```python
# DELETE these:
from archive_core import build_topic_json_url, fetch_topic_json, parse_topic_id
```

Keep the `--input-json` offline path and all its options (`--pdf`, `--pdf-config`, `--output-dir`, etc.) — the CLI is still useful for manual re-processing.

Optionally: remove the `topic_url` positional argument from argparse, or keep it and print a deprecation message pointing to the browser extension. Either approach is fine.

### 1.3 `pyproject.toml`

Remove `camoufox[geoip]` from `[project.dependencies]`:

```toml
# BEFORE:
dependencies = [
    "camoufox[geoip]>=0.4.11",
    "lxml>=5.2.2",
    "markdown>=3.8",
    "playwright>=1.58.0",
    "requests>=2.32.3",
]

# AFTER:
dependencies = [
    "lxml>=5.2.2",
    "markdown>=3.8",
    "playwright>=1.58.0",
    "requests>=2.32.3",
]
```

After editing, run `uv lock` to regenerate `uv.lock`.

---

## Phase 2: Remove Auto-Start Bridge Chain

### 2.1 Delete `tools/` directory entirely

All 4 PowerShell scripts are part of the fragile auto-start chain:

- `tools/windows/register-protocol.ps1`
- `tools/windows/unregister-protocol.ps1`
- `tools/windows/launch-bridge-protocol.ps1`
- `tools/windows/run-bridge.ps1`

Delete the entire `tools/` directory.

### 2.2 `browser-extension/popup.js`

Remove auto-start related functions:

- `launchBridgeProtocol()` — creates hidden `<a>` to trigger `linuxdo-archive://start`
- `waitForBridgeReady()` — polls `/health` after protocol launch
- The auto-launch branch inside `ensureBridgeReady()` — keep the health check, remove the protocol launch fallback

Remove the `PROTOCOL_URL` constant (`linuxdo-archive://start`).

Modify `ensureBridgeReady()` so that when the bridge is offline, it simply reports "Bridge not running, please start it manually" instead of attempting auto-launch.

**Keep** `checkBridgeHealth()` — still needed to detect bridge status.
**Keep** `refreshBridgeStatus()` — still needed to show/hide the manual start hint.

### 2.3 `popup.html`

Remove or repurpose the "Start Bridge" button. Replace with a static hint:

```
Bridge offline. Run: uv run python local_bridge_server.py
```

Or keep the button but have it just copy the command to clipboard.

---

## Phase 3: Simplify Browser Extension (optional but recommended)

These are non-essential enhancements. Removing them makes the extension easier to understand and maintain. Each item is independent — remove any subset.

### 3.1 Async Task Polling (~105 lines)

Remove:
- `formatStageLabel()`
- `formatTaskProgress()`
- `fetchTaskStatus()`
- `pollTaskUntilDone()`

Change `runExport()` to use synchronous mode: do NOT send `async_task: true` in the payload. The bridge will return the result directly in the HTTP response. A single topic archive typically completes in under 10 seconds.

Remove the `/task-status` polling constants (`POLL_INTERVAL`, `POLL_TIMEOUT`, etc.).

### 3.2 Export History (~45 lines)

Remove:
- `getHistory()`, `saveHistory()`, `renderHistory()`, `appendHistory()`, `clearHistory()`
- History section in `popup.html` (the list container and "Clear" button)
- `HISTORY_KEY` constant
- `MAX_HISTORY` constant

Rationale: `cases/index.md` already serves as the archive index.

### 3.3 PDF Profile Selection (~40 lines)

Remove:
- `PDF_PROFILE_MAP`
- `loadSettings()`, `saveSettings()`, `bindSettingEvents()`
- `SETTINGS_KEY` constant
- The profile dropdown in `popup.html`

Hardcode: always use the default PDF style (no `pdf_config_path` in payload, which makes the bridge use `DEFAULT_PDF_STYLE` from `archive_core.py`).

Keep the PDF enable/disable checkbox — that's a meaningful toggle.

### 3.4 Open Folder Button (~25 lines)

Remove the "Open Output Folder" button and its click handler that calls `/open-folder`.

The user knows where `cases/` is.

### 3.5 Post Range Inputs

Remove `post_start` / `post_end` inputs from `popup.html` and the corresponding payload fields in `runExport()`.

This is a power-user feature. If needed, it's still available via the CLI (`save_linuxdo_topic.py --post-start N --post-end M`).

---

## Phase 4: Clean Up Configs and Docs

### 4.1 Configs

Keep: `configs/pdf.default.json`

Delete (if Phase 3.3 is done):
- `configs/pdf.ctf-full.json`
- `configs/pdf.ctf-brief.json`

If you still want CTF templates available for CLI use, keep them. They don't hurt anything.

### 4.2 Docs

Keep: `docs/topic-import.schema.json` — update it to remove fields that no longer exist (e.g., `async_task` if Phase 3.1 is done, `post_start`/`post_end` if Phase 3.5 is done).

### 4.3 HANDOFF.md

Update to reflect the simplified architecture. Remove references to:
- Online scraping / Camoufox
- Custom protocol / auto-start
- `tools/` directory

### 4.4 CLAUDE.md

Update the architecture diagram and command examples. Remove the `uv run camoufox fetch` setup step.

### 4.5 README.md

Update accordingly.

---

## What NOT to Touch

| Component | Reason |
|---|---|
| `archive_core.py` (except the 3 online functions) | Working pipeline, no changes needed |
| `local_bridge_server.py` | Clean design, all endpoints still needed |
| `render_pdf_from_markdown()` | Core output |
| `build_cases_index()` | Lightweight and useful |
| `ImportGuard` in bridge server | Rate limiting is necessary |
| Path safety checks in bridge server | Security requirement |
| `emit_progress()` in archive_core | Used by bridge server for logging |

---

## Expected Outcome

### Before

```
archive_core.py              942 lines
save_linuxdo_topic.py        179 lines
local_bridge_server.py       526 lines
browser-extension/popup.js   564 lines
tools/windows/               4 scripts
configs/                     3 files
Total Python:               ~1647 lines
```

### After (all phases)

```
archive_core.py              ~860 lines  (-80)
save_linuxdo_topic.py        ~130 lines  (-50)
local_bridge_server.py        526 lines  (unchanged)
browser-extension/popup.js   ~180 lines  (-384)
tools/                       deleted
configs/                     1 file
Total Python:               ~1516 lines
```

- `camoufox` dependency removed (largest dep, includes browser binary)
- Auto-start chain eliminated (the fragile 5-hop path)
- Extension reduced to ~1/3 of original size
- Zero behavior change for the core workflow

---

## Implementation Order

Execute phases in order (1 → 2 → 3 → 4). Each phase is independently committable.

Suggested commit messages:

1. `refactor: remove online scraping path and camoufox dependency`
2. `refactor: remove auto-start bridge chain and tools/ directory`
3. `refactor: simplify browser extension (sync mode, remove history/profiles)`
4. `docs: update CLAUDE.md, HANDOFF.md, README.md for simplified architecture`

---

## Verification

After each phase, verify:

- Phase 1: `uv lock && uv sync` succeeds; `uv run python save_linuxdo_topic.py --help` works; `--input-json` path still works
- Phase 2: Extension loads in Chrome without errors; bridge health check still works when bridge is running
- Phase 3: Full export flow works: click Export on a linux.do post → bridge receives JSON → PDF generated in `cases/`
- Phase 4: Documentation is consistent with code
