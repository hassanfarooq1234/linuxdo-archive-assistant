#!/usr/bin/env python3
"""Core archive pipeline for linux.do topics."""

from __future__ import annotations

from html import escape as html_escape
import json
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse, urlsplit

import markdown
import requests
from camoufox.sync_api import Camoufox
from lxml import html
from playwright.sync_api import sync_playwright


ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_TASK_LOG_PATH = ROOT_DIR / "logs" / "archive_tasks.jsonl"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/146.0.0.0 Safari/537.36"
)

DEFAULT_PDF_STYLE: dict[str, Any] = {
    "page": {
        "format": "A4",
        "margin_top": "18mm",
        "margin_right": "14mm",
        "margin_bottom": "18mm",
        "margin_left": "14mm",
        "display_header_footer": True,
        "print_background": True,
    },
    "header_template": (
        "<div style='width:100%;font-size:8px;padding:0 10px;color:#6b7280;"
        "text-align:center;'>linux.do topic archive</div>"
    ),
    "footer_template": (
        "<div style='width:100%;font-size:8px;padding:0 10px;color:#6b7280;"
        "text-align:center;'><span class='pageNumber'></span>/<span class='totalPages'></span></div>"
    ),
    "html": {
        "font_family": '"Microsoft YaHei UI", "Segoe UI", sans-serif',
        "font_size": "14px",
        "line_height": "1.65",
        "max_width": "860px",
        "text_color": "#1f2937",
        "muted_color": "#4b5563",
        "border_color": "#d1d5db",
        "background_color": "#ffffff",
        "h1_font_size": "28px",
        "h2_font_size": "20px",
    },
    "cover": {
        "enabled": False,
        "title_prefix": "linux.do Archive",
        "subtitle": "",
        "show_meta": True,
        "meta_label_1": "Topic ID",
        "meta_label_2": "Source",
    },
}


def merge_dict(base: dict[str, Any], extra: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in extra.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = merge_dict(merged[key], value)
        else:
            merged[key] = value
    return merged


def resolve_pdf_style(
    pdf_style: dict[str, Any] | None = None,
    pdf_config_path: Path | None = None,
) -> dict[str, Any]:
    style = dict(DEFAULT_PDF_STYLE)
    if pdf_config_path:
        loaded = json.loads(pdf_config_path.read_text(encoding="utf-8-sig"))
        if not isinstance(loaded, dict):
            raise ValueError("PDF config file must be a JSON object.")
        style = merge_dict(style, loaded)
    if pdf_style:
        style = merge_dict(style, pdf_style)
    return style


@dataclass(slots=True)
class ArchiveResult:
    topic_id: str
    topic_url: str
    output_dir: Path
    markdown_path: Path
    raw_json_path: Path
    images_dir: Path
    html_path: Path | None = None
    pdf_path: Path | None = None
    index_path: Path | None = None
    task_log_path: Path | None = None


def parse_topic_id(topic_url: str) -> str:
    parsed = urlparse(topic_url)
    match = re.search(r"/t/(?:[^/]+/)?(\d+)", parsed.path)
    if not match:
        raise ValueError(f"Cannot parse topic id from URL: {topic_url}")
    return match.group(1)


def build_topic_json_url(topic_url: str) -> str:
    parsed = urlparse(topic_url)
    path = parsed.path.rstrip("/")
    if path.endswith(".json"):
        return topic_url
    return f"{parsed.scheme}://{parsed.netloc}{path}.json"


def fetch_topic_json(topic_url: str, json_url: str) -> dict[str, Any]:
    with Camoufox(
        headless=True,
        os="windows",
        geoip=False,
        humanize=False,
    ) as browser:
        page = browser.new_page()
        page.goto(topic_url, wait_until="domcontentloaded", timeout=120000)
        page.wait_for_timeout(6000)

        result = page.evaluate(
            """
            async ({ jsonUrl }) => {
              const target = jsonUrl + (jsonUrl.includes('?') ? '&' : '?') + '_ts=' + Date.now();
              const resp = await fetch(target, { credentials: 'include', cache: 'no-store' });
              const text = await resp.text();
              return { status: resp.status, ok: resp.ok, text };
            }
            """,
            {"jsonUrl": json_url},
        )

    if not result["ok"]:
        prefix = result["text"][:240].replace("\n", " ")
        raise RuntimeError(f"Fetch failed: HTTP {result['status']} / {prefix}")

    return json.loads(result["text"])


def infer_extension_from_url(url: str) -> str:
    ext = Path(urlsplit(url).path).suffix.lower()
    if ext in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"}:
        return ext
    return ".bin"


def download_image(
    url: str,
    output_path: Path,
    retry_count: int = 2,
    retry_delay_seconds: float = 1.5,
) -> None:
    headers = {"User-Agent": USER_AGENT}
    last_exc: Exception | None = None
    for attempt in range(retry_count + 1):
        try:
            resp = requests.get(url, headers=headers, timeout=60)
            resp.raise_for_status()
            output_path.write_bytes(resp.content)
            return
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt < retry_count:
                time.sleep(retry_delay_seconds * (attempt + 1))
    if last_exc:
        raise last_exc


def rewrite_post_html_and_download_images(
    cooked_html: str,
    post_number: int,
    topic_url: str,
    image_dir: Path,
    download_images: bool = True,
    image_retry_count: int = 2,
    image_retry_delay_seconds: float = 1.5,
) -> tuple[str, list[str]]:
    root = html.fragment_fromstring(cooked_html, create_parent="div")
    img_nodes = root.xpath(".//img")
    local_files: list[str] = []

    for idx, img in enumerate(img_nodes, start=1):
        parent = img.getparent()
        parent_href = parent.get("href") if parent is not None and parent.tag == "a" else None
        src = parent_href or img.get("src")
        if not src or src.startswith("data:"):
            continue

        source_url = urljoin(topic_url, src)
        ext = infer_extension_from_url(source_url)
        file_name = f"post_{post_number:03d}_img_{idx:02d}{ext}"
        output_file = image_dir / file_name

        if download_images:
            try:
                download_image(
                    source_url,
                    output_file,
                    retry_count=image_retry_count,
                    retry_delay_seconds=image_retry_delay_seconds,
                )
            except Exception:
                fallback = img.get("src")
                if not fallback:
                    continue
                fallback_url = urljoin(topic_url, fallback)
                ext = infer_extension_from_url(fallback_url)
                file_name = f"post_{post_number:03d}_img_{idx:02d}{ext}"
                output_file = image_dir / file_name
                download_image(
                    fallback_url,
                    output_file,
                    retry_count=image_retry_count,
                    retry_delay_seconds=image_retry_delay_seconds,
                )
        else:
            output_file.touch(exist_ok=True)

        rel = f"images/{file_name}"
        img.set("src", rel)
        img.attrib.pop("srcset", None)
        if parent is not None and parent.tag == "a":
            parent.set("href", rel)
        local_files.append(rel)

    inner = (root.text or "") + "".join(
        html.tostring(child, encoding="unicode", method="html") for child in root
    )
    return inner.strip(), local_files


def render_markdown(
    topic_url: str,
    topic_data: dict[str, Any],
    image_dir: Path,
    download_images: bool = True,
    image_retry_count: int = 2,
    image_retry_delay_seconds: float = 1.5,
) -> str:
    posts = topic_data.get("post_stream", {}).get("posts", [])
    posts = sorted(posts, key=lambda p: p.get("post_number", 0))

    lines: list[str] = []
    lines.append(f"# {topic_data.get('title', 'Untitled Topic')}")
    lines.append("")
    lines.append(f"- 原始链接: {topic_url}")
    lines.append(f"- 抓取时间(UTC): {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    lines.append(f"- 帖子总数: {len(posts)}")
    lines.append("")
    lines.append("---")
    lines.append("")

    for post in posts:
        post_number = int(post.get("post_number", 0))
        username = post.get("username", "")
        name = post.get("name") or ""
        created_at = post.get("created_at", "")
        likes = post.get("like_count", 0)
        reply_to = post.get("reply_to_post_number")

        cooked = post.get("cooked", "")
        rewritten_html, _ = rewrite_post_html_and_download_images(
            cooked_html=cooked,
            post_number=post_number,
            topic_url=topic_url,
            image_dir=image_dir,
            download_images=download_images,
            image_retry_count=image_retry_count,
            image_retry_delay_seconds=image_retry_delay_seconds,
        )

        floor_title = "主楼" if post_number == 1 else f"评论 #{post_number}"
        lines.append(f"## {floor_title} · @{username}")
        lines.append("")
        lines.append(f"- 显示名: {name if name else username}")
        lines.append(f"- 发布时间: {created_at}")
        lines.append(f"- 点赞数: {likes}")
        if reply_to:
            lines.append(f"- 回复楼层: {reply_to}")
        lines.append("")
        lines.append(rewritten_html if rewritten_html else "_（无正文）_")
        lines.append("")
        lines.append("---")
        lines.append("")

    return "\n".join(lines)


def build_cover_html(
    title: str,
    topic_id: str | None,
    topic_url: str | None,
    cover_style: dict[str, Any],
) -> str:
    if not bool(cover_style.get("enabled", False)):
        return ""
    subtitle = str(cover_style.get("subtitle", "")).strip()
    title_prefix = str(cover_style.get("title_prefix", "")).strip()
    show_meta = bool(cover_style.get("show_meta", True))
    meta_label_1 = str(cover_style.get("meta_label_1", "Topic ID"))
    meta_label_2 = str(cover_style.get("meta_label_2", "Source"))
    final_title = f"{title_prefix} · {title}" if title_prefix else title
    parts: list[str] = []
    parts.append("<section class='cover'>")
    parts.append(f"<h1>{html_escape(final_title)}</h1>")
    if subtitle:
        parts.append(f"<p class='cover-subtitle'>{html_escape(subtitle)}</p>")
    if show_meta:
        parts.append("<div class='cover-meta'>")
        if topic_id:
            parts.append(
                f"<div><strong>{html_escape(meta_label_1)}:</strong> {html_escape(topic_id)}</div>"
            )
        if topic_url:
            parts.append(
                "<div><strong>"
                + html_escape(meta_label_2)
                + f":</strong> <span>{html_escape(topic_url)}</span></div>"
            )
        parts.append(
            "<div><strong>Generated:</strong> "
            + html_escape(datetime.now(timezone.utc).isoformat(timespec="seconds"))
            + "</div>"
        )
        parts.append("</div>")
    parts.append("</section>")
    parts.append("<div class='page-break'></div>")
    return "\n".join(parts)


def markdown_to_html(
    md_text: str,
    title: str,
    pdf_style: dict[str, Any] | None = None,
    topic_id: str | None = None,
    topic_url: str | None = None,
) -> str:
    style = resolve_pdf_style(pdf_style=pdf_style)
    html_style = style.get("html", {})
    cover_style = style.get("cover", {})
    font_family = html_style.get("font_family", DEFAULT_PDF_STYLE["html"]["font_family"])
    font_size = html_style.get("font_size", DEFAULT_PDF_STYLE["html"]["font_size"])
    line_height = html_style.get("line_height", DEFAULT_PDF_STYLE["html"]["line_height"])
    max_width = html_style.get("max_width", DEFAULT_PDF_STYLE["html"]["max_width"])
    text_color = html_style.get("text_color", DEFAULT_PDF_STYLE["html"]["text_color"])
    muted_color = html_style.get("muted_color", DEFAULT_PDF_STYLE["html"]["muted_color"])
    border_color = html_style.get("border_color", DEFAULT_PDF_STYLE["html"]["border_color"])
    background_color = html_style.get(
        "background_color", DEFAULT_PDF_STYLE["html"]["background_color"]
    )
    h1_font_size = html_style.get("h1_font_size", DEFAULT_PDF_STYLE["html"]["h1_font_size"])
    h2_font_size = html_style.get("h2_font_size", DEFAULT_PDF_STYLE["html"]["h2_font_size"])
    cover_html = build_cover_html(
        title=title,
        topic_id=topic_id,
        topic_url=topic_url,
        cover_style=cover_style if isinstance(cover_style, dict) else {},
    )

    body_html = markdown.markdown(md_text, extensions=["extra", "sane_lists", "toc"])
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
  <style>
    :root {{
      --text: {text_color};
      --muted: {muted_color};
      --border: {border_color};
      --bg: {background_color};
    }}
    html, body {{
      margin: 0;
      padding: 0;
      color: var(--text);
      background: var(--bg);
      font-family: {font_family};
      line-height: {line_height};
      font-size: {font_size};
    }}
    main {{
      max-width: {max_width};
      margin: 0 auto;
      padding: 20px 24px;
    }}
    h1, h2, h3 {{
      line-height: 1.3;
    }}
    h1 {{
      font-size: {h1_font_size};
      margin: 0 0 12px;
      border-bottom: 2px solid var(--border);
      padding-bottom: 8px;
    }}
    h2 {{
      font-size: {h2_font_size};
      margin-top: 22px;
      border-left: 4px solid #9ca3af;
      padding-left: 10px;
    }}
    p, ul, ol {{
      margin: 10px 0;
    }}
    img {{
      max-width: 100%;
      height: auto;
      border: 1px solid var(--border);
      border-radius: 6px;
    }}
    code {{
      background: #f3f4f6;
      padding: 0 4px;
      border-radius: 4px;
    }}
    pre {{
      background: #f3f4f6;
      padding: 10px;
      border-radius: 6px;
      overflow: auto;
    }}
    hr {{
      border: none;
      border-top: 1px solid var(--border);
      margin: 18px 0;
    }}
    .cover {{
      min-height: 85vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: flex-start;
      gap: 10px;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      background: #fafafa;
    }}
    .cover-subtitle {{
      color: var(--muted);
      margin: 0;
      font-size: 15px;
    }}
    .cover-meta {{
      color: var(--muted);
      font-size: 12px;
      display: grid;
      gap: 4px;
      word-break: break-all;
    }}
    .page-break {{
      break-after: page;
      page-break-after: always;
      margin: 0;
      border: 0;
      height: 0;
    }}
  </style>
</head>
<body>
  <main>
{cover_html}
{body_html}
  </main>
</body>
</html>
"""


def render_pdf_from_markdown(
    markdown_path: Path,
    pdf_path: Path,
    title: str,
    html_keep: bool = True,
    pdf_style: dict[str, Any] | None = None,
    pdf_config_path: Path | None = None,
    topic_id: str | None = None,
    topic_url: str | None = None,
) -> Path:
    style = resolve_pdf_style(pdf_style=pdf_style, pdf_config_path=pdf_config_path)
    md_text = markdown_path.read_text(encoding="utf-8")
    html_content = markdown_to_html(
        md_text=md_text,
        title=title,
        pdf_style=style,
        topic_id=topic_id,
        topic_url=topic_url,
    )
    html_path = markdown_path.with_suffix(".html")
    html_path.write_text(html_content, encoding="utf-8")

    file_url = html_path.resolve().as_uri()
    page_style = style.get("page", {})
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(file_url, wait_until="networkidle")
        page.pdf(
            path=str(pdf_path),
            format=str(page_style.get("format", "A4")),
            print_background=bool(page_style.get("print_background", True)),
            margin={
                "top": str(page_style.get("margin_top", "18mm")),
                "right": str(page_style.get("margin_right", "14mm")),
                "bottom": str(page_style.get("margin_bottom", "18mm")),
                "left": str(page_style.get("margin_left", "14mm")),
            },
            display_header_footer=bool(page_style.get("display_header_footer", True)),
            header_template=str(style.get("header_template", DEFAULT_PDF_STYLE["header_template"])),
            footer_template=str(style.get("footer_template", DEFAULT_PDF_STYLE["footer_template"])),
        )
        browser.close()

    if not html_keep:
        html_path.unlink(missing_ok=True)
    return html_path


def infer_topic_id_from_json(topic_data: dict[str, Any], fallback_name: str = "") -> str:
    stem_match = re.search(r"(\d+)", fallback_name)
    topic_id = str(
        topic_data.get("id")
        or topic_data.get("topic_id")
        or (stem_match.group(1) if stem_match else "")
    )
    if not topic_id:
        raise ValueError("Cannot infer topic id from JSON. Please include numeric id in filename.")
    return topic_id


def read_markdown_title(markdown_path: Path) -> str:
    try:
        text = markdown_path.read_text(encoding="utf-8")
    except Exception:  # noqa: BLE001
        return markdown_path.stem
    for line in text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return markdown_path.stem


def build_cases_index(
    cases_root: Path,
    sort_by: str = "updated_desc",
    only_with_pdf: bool = False,
    limit: int | None = None,
) -> Path:
    cases_root = cases_root.resolve()
    cases_root.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, Any]] = []
    for child in sorted(cases_root.iterdir(), key=lambda p: p.name):
        if not child.is_dir():
            continue
        md_files = sorted(child.glob("topic_*.md"))
        if not md_files:
            continue
        md_path = md_files[0]
        topic_match = re.search(r"(\d+)", md_path.stem)
        topic_id = topic_match.group(1) if topic_match else child.name
        pdf_path = child / f"topic_{topic_id}.pdf"
        if only_with_pdf and not pdf_path.exists():
            continue
        title = read_markdown_title(md_path)
        updated_utc = datetime.fromtimestamp(md_path.stat().st_mtime, tz=timezone.utc).isoformat(
            timespec="seconds"
        )
        updated_ts = md_path.stat().st_mtime
        md_rel = md_path.relative_to(cases_root).as_posix()
        pdf_rel = pdf_path.relative_to(cases_root).as_posix() if pdf_path.exists() else "-"
        rows.append(
            {
                "topic_id": topic_id,
                "title": title,
                "md_rel": md_rel,
                "pdf_rel": pdf_rel,
                "updated_utc": updated_utc,
                "updated_ts": updated_ts,
            }
        )

    def topic_numeric_key(value: str) -> int:
        m = re.search(r"\d+", value)
        return int(m.group()) if m else 0

    if sort_by == "updated_desc":
        rows.sort(key=lambda r: r["updated_ts"], reverse=True)
    elif sort_by == "updated_asc":
        rows.sort(key=lambda r: r["updated_ts"])
    elif sort_by == "topic_id_desc":
        rows.sort(key=lambda r: topic_numeric_key(str(r["topic_id"])), reverse=True)
    elif sort_by == "topic_id_asc":
        rows.sort(key=lambda r: topic_numeric_key(str(r["topic_id"])))
    else:
        rows.sort(key=lambda r: r["updated_ts"], reverse=True)

    if limit is not None and limit > 0:
        rows = rows[:limit]

    lines: list[str] = []
    lines.append("# Topic Archive Index")
    lines.append("")
    lines.append(f"- 生成时间(UTC): {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    lines.append(f"- 排序: {sort_by}")
    lines.append(f"- 过滤: {'only_with_pdf' if only_with_pdf else 'all_topics'}")
    if limit:
        lines.append(f"- 限制条数: {limit}")
    lines.append("")
    lines.append("| Topic ID | Title | Markdown | PDF | Updated (UTC) |")
    lines.append("| --- | --- | --- | --- | --- |")
    if rows:
        for row in rows:
            topic_id = str(row["topic_id"])
            title = str(row["title"]).replace("|", "\\|")
            md_rel = str(row["md_rel"])
            pdf_rel = str(row["pdf_rel"])
            updated_utc = str(row["updated_utc"])
            md_link = f"[{md_rel}]({md_rel})"
            pdf_link = f"[{pdf_rel}]({pdf_rel})" if pdf_rel != "-" else "-"
            lines.append(f"| {topic_id} | {title} | {md_link} | {pdf_link} | {updated_utc} |")
    else:
        lines.append("| - | - | - | - | - |")
    lines.append("")

    index_path = cases_root / "index.md"
    index_path.write_text("\n".join(lines), encoding="utf-8")
    return index_path


def append_task_log(log_path: Path, record: dict[str, Any]) -> None:
    log_path = log_path.resolve()
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def archive_topic_from_data(
    topic_data: dict[str, Any],
    topic_url: str,
    output_dir: Path,
    topic_id: str | None = None,
    download_images: bool = True,
    image_retry_count: int = 2,
    image_retry_delay_seconds: float = 1.5,
    generate_pdf: bool = False,
    keep_html_for_pdf: bool = True,
    pdf_style: dict[str, Any] | None = None,
    pdf_config_path: Path | None = None,
    update_index: bool = True,
    index_root: Path | None = None,
    index_sort_by: str = "updated_desc",
    index_only_with_pdf: bool = False,
    index_limit: int | None = None,
    enable_task_log: bool = True,
    task_log_path: Path | None = None,
) -> ArchiveResult:
    started_at = datetime.now(timezone.utc)
    final_topic_id = topic_id or infer_topic_id_from_json(topic_data)
    output_dir = output_dir.resolve()
    raw_dir = output_dir / "raw"
    images_dir = output_dir / "images"
    raw_json_path = raw_dir / f"topic_{final_topic_id}.json"
    markdown_path = output_dir / f"topic_{final_topic_id}.md"
    html_path: Path | None = None
    pdf_path: Path | None = None
    index_path: Path | None = None
    error_message = ""
    log_target = (task_log_path or DEFAULT_TASK_LOG_PATH).resolve()

    try:
        raw_dir.mkdir(parents=True, exist_ok=True)
        images_dir.mkdir(parents=True, exist_ok=True)
        raw_json_path.write_text(json.dumps(topic_data, ensure_ascii=False, indent=2), encoding="utf-8")

        markdown_content = render_markdown(
            topic_url=topic_url,
            topic_data=topic_data,
            image_dir=images_dir,
            download_images=download_images,
            image_retry_count=image_retry_count,
            image_retry_delay_seconds=image_retry_delay_seconds,
        )
        markdown_path.write_text(markdown_content, encoding="utf-8")

        if generate_pdf:
            pdf_path = output_dir / f"topic_{final_topic_id}.pdf"
            html_path = render_pdf_from_markdown(
                markdown_path=markdown_path,
                pdf_path=pdf_path,
                title=topic_data.get("title", f"topic_{final_topic_id}"),
                html_keep=keep_html_for_pdf,
                pdf_style=pdf_style,
                pdf_config_path=pdf_config_path,
                topic_id=final_topic_id,
                topic_url=topic_url,
            )

        if update_index:
            resolved_index_root: Path | None = None
            if index_root:
                resolved_index_root = index_root.resolve()
            elif output_dir.parent.name == "cases":
                resolved_index_root = output_dir.parent
            if resolved_index_root:
                index_path = build_cases_index(
                    cases_root=resolved_index_root,
                    sort_by=index_sort_by,
                    only_with_pdf=index_only_with_pdf,
                    limit=index_limit,
                )

        result = ArchiveResult(
            topic_id=final_topic_id,
            topic_url=topic_url,
            output_dir=output_dir,
            markdown_path=markdown_path,
            raw_json_path=raw_json_path,
            images_dir=images_dir,
            html_path=html_path,
            pdf_path=pdf_path,
            index_path=index_path,
            task_log_path=log_target if enable_task_log else None,
        )
        return result
    except Exception as exc:  # noqa: BLE001
        error_message = str(exc)
        raise
    finally:
        if enable_task_log:
            finished_at = datetime.now(timezone.utc)
            append_task_log(
                log_target,
                {
                    "time_start_utc": started_at.isoformat(timespec="seconds"),
                    "time_end_utc": finished_at.isoformat(timespec="seconds"),
                    "duration_ms": int((finished_at - started_at).total_seconds() * 1000),
                    "status": "success" if not error_message else "failed",
                    "topic_id": final_topic_id,
                    "topic_url": topic_url,
                    "output_dir": str(output_dir),
                    "markdown_path": str(markdown_path),
                    "raw_json_path": str(raw_json_path),
                    "images_dir": str(images_dir),
                    "pdf_path": str(pdf_path) if pdf_path else None,
                    "index_path": str(index_path) if index_path else None,
                    "generate_pdf": generate_pdf,
                    "update_index": update_index,
                    "index_sort_by": index_sort_by,
                    "index_only_with_pdf": index_only_with_pdf,
                    "index_limit": index_limit,
                    "error": error_message or None,
                },
            )


def archive_topic_from_json_file(
    json_path: Path,
    output_dir: Path,
    topic_url: str | None = None,
    download_images: bool = True,
    image_retry_count: int = 2,
    image_retry_delay_seconds: float = 1.5,
    generate_pdf: bool = False,
    keep_html_for_pdf: bool = True,
    pdf_style: dict[str, Any] | None = None,
    pdf_config_path: Path | None = None,
    update_index: bool = True,
    index_root: Path | None = None,
    index_sort_by: str = "updated_desc",
    index_only_with_pdf: bool = False,
    index_limit: int | None = None,
    enable_task_log: bool = True,
    task_log_path: Path | None = None,
) -> ArchiveResult:
    topic_data = json.loads(json_path.read_text(encoding="utf-8-sig"))
    topic_id = infer_topic_id_from_json(topic_data, fallback_name=json_path.stem)
    final_topic_url = topic_url or f"https://linux.do/t/topic/{topic_id}"
    return archive_topic_from_data(
        topic_data=topic_data,
        topic_url=final_topic_url,
        output_dir=output_dir,
        topic_id=topic_id,
        download_images=download_images,
        image_retry_count=image_retry_count,
        image_retry_delay_seconds=image_retry_delay_seconds,
        generate_pdf=generate_pdf,
        keep_html_for_pdf=keep_html_for_pdf,
        pdf_style=pdf_style,
        pdf_config_path=pdf_config_path,
        update_index=update_index,
        index_root=index_root,
        index_sort_by=index_sort_by,
        index_only_with_pdf=index_only_with_pdf,
        index_limit=index_limit,
        enable_task_log=enable_task_log,
        task_log_path=task_log_path,
    )
