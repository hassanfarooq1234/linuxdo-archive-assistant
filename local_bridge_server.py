#!/usr/bin/env python3
"""Local bridge service for browser extension -> archive pipeline."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from archive_core import archive_topic_from_data, infer_topic_id_from_json


ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT_ROOT = ROOT_DIR / "cases"
DEFAULT_PDF_CONFIG = ROOT_DIR / "configs" / "pdf.default.json"
ALLOWED_TOPIC_HOSTS = {"linux.do"}
ALLOWED_INDEX_SORT_BY = {"updated_desc", "updated_asc", "topic_id_desc", "topic_id_asc"}


def is_within_root(path: Path, root: Path) -> bool:
    resolved_path = path.resolve()
    resolved_root = root.resolve()
    return resolved_path == resolved_root or resolved_root in resolved_path.parents


class ImportGuard:
    def __init__(self, min_interval_seconds: float) -> None:
        self._lock = threading.Lock()
        self._last_start = 0.0
        self._min_interval_seconds = min_interval_seconds

    def acquire(self) -> bool:
        now = time.monotonic()
        if now - self._last_start < self._min_interval_seconds:
            return False
        acquired = self._lock.acquire(blocking=False)
        if acquired:
            self._last_start = now
        return acquired

    def release(self) -> None:
        if self._lock.locked():
            self._lock.release()


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "LinuxDoArchiveBridge/0.1"

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send_json(HTTPStatus.OK, {"ok": True})

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "service": "challenge-05-linuxdo-archive",
                    "mode": "local-bridge",
                    "workspace_root": str(self.server.workspace_root),  # type: ignore[attr-defined]
                },
            )
            return
        if parsed.path == "/open-folder":
            self._handle_open_folder(parsed.query)
            return
        self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})

    def _handle_open_folder(self, query_string: str) -> None:
        params = parse_qs(query_string)
        folder = params.get("path", [""])[0]
        if not folder:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "path_required"})
            return
        folder_path = Path(folder).resolve()
        workspace_root = self.server.workspace_root.resolve()  # type: ignore[attr-defined]
        if not is_within_root(folder_path, workspace_root):
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": "path_out_of_scope", "message": "Path must be inside workspace_root."},
            )
            return
        if not folder_path.exists():
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": "path_not_found", "message": f"Directory not found: {folder_path}"},
            )
            return
        target = str(folder_path)
        if sys.platform == "win32":
            os.startfile(target)  # noqa: S606
        elif sys.platform == "darwin":
            subprocess.Popen(["open", target])  # noqa: S603, S607
        else:
            subprocess.Popen(["xdg-open", target])  # noqa: S603, S607
        self._send_json(HTTPStatus.OK, {"ok": True, "opened": target})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/import-topic":
            self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})
            return

        if not self.server.guard.acquire():  # type: ignore[attr-defined]
            self._send_json(
                HTTPStatus.TOO_MANY_REQUESTS,
                {
                    "ok": False,
                    "error": "rate_limited_or_busy",
                    "message": "Only one import task is allowed at a time.",
                },
            )
            return

        try:
            self._handle_import_topic()
        finally:
            self.server.guard.release()  # type: ignore[attr-defined]

    def _handle_import_topic(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "empty_body"})
            return
        body = self.rfile.read(length)
        try:
            payload = json.loads(body.decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": "invalid_json", "message": str(exc)},
            )
            return

        topic_json = payload.get("topic_json")
        if not isinstance(topic_json, dict):
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": "topic_json_required"},
            )
            return

        topic_id = str(payload.get("topic_id") or infer_topic_id_from_json(topic_json))
        topic_url = str(payload.get("topic_url") or f"https://linux.do/t/topic/{topic_id}")
        parsed_url = urlparse(topic_url)
        if parsed_url.netloc not in ALLOWED_TOPIC_HOSTS:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": "host_not_allowed", "allowed": sorted(ALLOWED_TOPIC_HOSTS)},
            )
            return

        workspace_root = self.server.workspace_root.resolve()  # type: ignore[attr-defined]
        default_output_root = self.server.default_output_root.resolve()  # type: ignore[attr-defined]
        default_task_log_path = self.server.default_task_log_path.resolve()  # type: ignore[attr-defined]

        output_root = Path(str(payload.get("output_root") or default_output_root))
        if not output_root.is_absolute():
            output_root = (workspace_root / output_root).resolve()
        else:
            output_root = output_root.resolve()

        output_dir = (output_root / topic_id).resolve()
        if not is_within_root(output_dir, workspace_root):
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {
                    "ok": False,
                    "error": "output_out_of_scope",
                    "message": "Output directory must stay inside workspace_root.",
                },
            )
            return

        pdf_config_path: Path | None = None
        payload_pdf_config = payload.get("pdf_config_path")
        if payload_pdf_config:
            candidate = Path(str(payload_pdf_config))
            if not candidate.is_absolute():
                candidate = (ROOT_DIR / candidate).resolve()
            else:
                candidate = candidate.resolve()
            if ROOT_DIR not in candidate.parents and candidate != ROOT_DIR:
                self._send_json(
                    HTTPStatus.BAD_REQUEST,
                    {
                        "ok": False,
                        "error": "pdf_config_out_of_scope",
                        "message": "pdf_config_path must stay inside challenge-05-linuxdo-archive.",
                    },
                )
                return
            if not candidate.exists() or not candidate.is_file():
                self._send_json(
                    HTTPStatus.BAD_REQUEST,
                    {
                        "ok": False,
                        "error": "pdf_config_not_found",
                        "message": f"pdf config not found: {candidate}",
                    },
                )
                return
            pdf_config_path = candidate
        elif DEFAULT_PDF_CONFIG.exists():
            pdf_config_path = DEFAULT_PDF_CONFIG

        download_images = bool(payload.get("download_images", True))
        image_retry_count = max(int(payload.get("image_retry_count", 2)), 0)
        image_retry_delay = max(float(payload.get("image_retry_delay", 1.5)), 0.1)
        generate_pdf = bool(payload.get("generate_pdf", True))
        keep_html_for_pdf = bool(payload.get("keep_html_for_pdf", True))
        update_index = bool(payload.get("update_index", True))
        index_sort_by = str(payload.get("index_sort_by", "updated_desc"))
        if index_sort_by not in ALLOWED_INDEX_SORT_BY:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": "invalid_index_sort_by", "allowed": sorted(ALLOWED_INDEX_SORT_BY)},
            )
            return
        index_only_with_pdf = bool(payload.get("index_only_with_pdf", False))
        index_limit_raw = payload.get("index_limit")
        try:
            index_limit = int(index_limit_raw) if index_limit_raw is not None else None
        except Exception:  # noqa: BLE001
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": "invalid_index_limit", "message": "index_limit must be an integer"},
            )
            return
        if index_limit is not None and index_limit <= 0:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": "invalid_index_limit", "message": "index_limit must be > 0"},
            )
            return
        enable_task_log = bool(payload.get("enable_task_log", True))
        task_log_path: Path | None = default_task_log_path if enable_task_log else None
        payload_task_log = payload.get("task_log_path")
        if payload_task_log:
            candidate_log = Path(str(payload_task_log))
            if not candidate_log.is_absolute():
                candidate_log = (workspace_root / candidate_log).resolve()
            else:
                candidate_log = candidate_log.resolve()
            if not is_within_root(candidate_log, workspace_root):
                self._send_json(
                    HTTPStatus.BAD_REQUEST,
                    {
                        "ok": False,
                        "error": "task_log_out_of_scope",
                        "message": "task_log_path must stay inside workspace_root.",
                    },
                )
                return
            task_log_path = candidate_log
        pdf_style = payload.get("pdf_style")
        if pdf_style is not None and not isinstance(pdf_style, dict):
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": "pdf_style_must_be_object"},
            )
            return

        post_start: int | None = None
        post_end: int | None = None
        raw_post_start = payload.get("post_start")
        raw_post_end = payload.get("post_end")
        try:
            if raw_post_start is not None:
                post_start = int(raw_post_start)
            if raw_post_end is not None:
                post_end = int(raw_post_end)
        except (ValueError, TypeError):
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": "invalid_post_range", "message": "post_start/post_end must be integers"},
            )
            return

        try:
            result = archive_topic_from_data(
                topic_data=topic_json,
                topic_url=topic_url,
                output_dir=output_dir,
                topic_id=topic_id,
                download_images=download_images,
                image_retry_count=image_retry_count,
                image_retry_delay_seconds=image_retry_delay,
                generate_pdf=generate_pdf,
                keep_html_for_pdf=keep_html_for_pdf,
                pdf_style=pdf_style,
                pdf_config_path=pdf_config_path,
                update_index=update_index,
                index_sort_by=index_sort_by,
                index_only_with_pdf=index_only_with_pdf,
                index_limit=index_limit,
                enable_task_log=enable_task_log,
                task_log_path=task_log_path,
                post_start=post_start,
                post_end=post_end,
            )
        except Exception as exc:  # noqa: BLE001
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"ok": False, "error": "archive_failed", "message": str(exc)},
            )
            return

        self._send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "topic_id": result.topic_id,
                "topic_url": result.topic_url,
                "output_dir": str(result.output_dir),
                "markdown_path": str(result.markdown_path),
                "raw_json_path": str(result.raw_json_path),
                "images_dir": str(result.images_dir),
                "html_path": str(result.html_path) if result.html_path else None,
                "pdf_path": str(result.pdf_path) if result.pdf_path else None,
                "pdf_config_path": str(pdf_config_path) if pdf_config_path else None,
                "index_path": str(result.index_path) if result.index_path else None,
                "task_log_path": str(result.task_log_path) if result.task_log_path else None,
            },
        )

    def log_message(self, format: str, *args: object) -> None:
        stamp = time.strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{stamp}] {self.address_string()} - {format % args}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run local bridge for browser plugin to archive linux.do topics."
    )
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=17805, help="Bind port (default: 17805)")
    parser.add_argument(
        "--min-interval",
        type=float,
        default=8.0,
        help="Minimum interval seconds between tasks (default: 8.0)",
    )
    parser.add_argument(
        "--workspace-root",
        help="Base workspace directory for cases/ and logs/ (default: project root)",
    )
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), BridgeHandler)
    server.guard = ImportGuard(min_interval_seconds=args.min_interval)  # type: ignore[attr-defined]
    workspace_root = Path(args.workspace_root).resolve() if args.workspace_root else ROOT_DIR
    workspace_root.mkdir(parents=True, exist_ok=True)
    (workspace_root / "cases").mkdir(parents=True, exist_ok=True)
    (workspace_root / "logs").mkdir(parents=True, exist_ok=True)
    server.workspace_root = workspace_root  # type: ignore[attr-defined]
    server.default_output_root = workspace_root / "cases"  # type: ignore[attr-defined]
    server.default_task_log_path = workspace_root / "logs" / "archive_tasks.jsonl"  # type: ignore[attr-defined]
    print(f"[READY] Local bridge server running at http://{args.host}:{args.port}")
    print(f"[READY] Workspace root: {workspace_root}")
    print("[READY] Safety guard: single-task + minimum interval enabled")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[STOP] Server stopped by user.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
