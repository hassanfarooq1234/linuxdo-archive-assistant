#!/usr/bin/env python3
"""CLI entry for linux.do topic archiving."""

from __future__ import annotations

import argparse
from pathlib import Path

from archive_core import (
    archive_topic_from_data,
    archive_topic_from_json_file,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Save a linux.do topic to local Markdown/PDF with local images."
    )
    parser.add_argument(
        "topic_url",
        nargs="?",
        help="Topic URL, e.g. https://linux.do/t/topic/1773797",
    )
    parser.add_argument(
        "--input-json",
        help="Use local topic JSON instead of fetching from website.",
    )
    parser.add_argument(
        "--output-dir",
        default=".",
        help="Output directory (default: current directory)",
    )
    parser.add_argument(
        "--no-download-images",
        action="store_true",
        help="Do not download images; keep placeholders in local images directory.",
    )
    parser.add_argument(
        "--image-retry-count",
        type=int,
        default=2,
        help="Retry count for each image download (default: 2).",
    )
    parser.add_argument(
        "--image-retry-delay",
        type=float,
        default=1.5,
        help="Base retry delay seconds for image download (default: 1.5).",
    )
    parser.add_argument(
        "--pdf",
        action="store_true",
        help="Generate PDF alongside Markdown.",
    )
    parser.add_argument(
        "--pdf-config",
        help="Path to PDF style JSON config file.",
    )
    parser.add_argument(
        "--no-keep-html",
        action="store_true",
        help="Remove intermediate HTML file after PDF generation.",
    )
    parser.add_argument(
        "--no-index",
        action="store_true",
        help="Disable automatic cases index update.",
    )
    parser.add_argument(
        "--index-sort-by",
        choices=["updated_desc", "updated_asc", "topic_id_desc", "topic_id_asc"],
        default="updated_desc",
        help="Sort order for cases/index.md (default: updated_desc).",
    )
    parser.add_argument(
        "--index-only-with-pdf",
        action="store_true",
        help="Only include topics with PDF in cases/index.md.",
    )
    parser.add_argument(
        "--index-limit",
        type=int,
        help="Limit number of rows in cases/index.md.",
    )
    parser.add_argument(
        "--no-task-log",
        action="store_true",
        help="Disable appending logs/archive_tasks.jsonl.",
    )
    parser.add_argument(
        "--task-log-path",
        help="Override task log file path.",
    )
    parser.add_argument(
        "--post-start",
        type=int,
        help="Start post number (inclusive). Omit for beginning.",
    )
    parser.add_argument(
        "--post-end",
        type=int,
        help="End post number (inclusive). Omit for all remaining.",
    )
    args = parser.parse_args()

    if not args.input_json:
        parser.error("--input-json is required")

    output_dir = Path(args.output_dir).resolve()
    pdf_config_path = Path(args.pdf_config).resolve() if args.pdf_config else None
    task_log_path = Path(args.task_log_path).resolve() if args.task_log_path else None

    if args.input_json:
        json_path = Path(args.input_json).resolve()
        result = archive_topic_from_json_file(
            json_path=json_path,
            output_dir=output_dir,
            topic_url=args.topic_url.strip() if args.topic_url else None,
            download_images=not args.no_download_images,
            image_retry_count=max(args.image_retry_count, 0),
            image_retry_delay_seconds=max(args.image_retry_delay, 0.1),
            generate_pdf=args.pdf,
            keep_html_for_pdf=not args.no_keep_html,
            pdf_config_path=pdf_config_path,
            update_index=not args.no_index,
            index_sort_by=args.index_sort_by,
            index_only_with_pdf=args.index_only_with_pdf,
            index_limit=args.index_limit,
            enable_task_log=not args.no_task_log,
            task_log_path=task_log_path,
            post_start=args.post_start,
            post_end=args.post_end,
        )
    print(f"[OK] Topic ID : {result.topic_id}")
    print(f"[OK] Topic JSON: {result.raw_json_path}")
    print(f"[OK] Markdown : {result.markdown_path}")
    print(f"[OK] Images dir: {result.images_dir}")
    if result.html_path:
        print(f"[OK] HTML     : {result.html_path}")
    if result.pdf_path:
        print(f"[OK] PDF      : {result.pdf_path}")
    if result.index_path:
        print(f"[OK] Index    : {result.index_path}")
    if result.task_log_path:
        print(f"[OK] Task Log : {result.task_log_path}")


if __name__ == "__main__":
    main()
