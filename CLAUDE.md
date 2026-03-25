# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

将单个 linux.do 主题帖归档为本地 Markdown + 图片 + PDF。属于 CTF 网络安全大赛的 Challenge 05。

默认策略：**离线导入优先**（`--input-json`），账号安全优先于效率。

### 核心使用场景

生成的 PDF 包含完整的帖子文字和内嵌图片（Playwright 真实 Chromium 渲染），主要用途是**上传到 AI 大模型网页版（Claude / ChatGPT / Gemini）作为上下文进行提问**。这解决了主流 AI 侧边栏/AI 阅读工具只能提取文字、无法理解帖子中图片内容的问题。

典型工作流：点插件导出 → 拿到 PDF → 拖进 AI 对话框 → 带图提问。

## 环境与依赖

- Python ≥ 3.12，使用 `uv` 管理依赖（`pyproject.toml` + `uv.lock`）
- 关键依赖：`camoufox`（反指纹浏览器，用于在线抓取）、`playwright`（PDF 渲染）、`lxml`（HTML 解析）、`markdown`（MD→HTML）、`requests`（图片下载）
- 虚拟环境位于 `.venv/`

```powershell
# 首次初始化
uv sync
uv run camoufox fetch
uv run playwright install chromium
```

## 常用命令

```powershell
# 离线导入（推荐）
uv run python save_linuxdo_topic.py --input-json <path_to_json> --output-dir cases/<topic_id> --pdf

# 带 PDF 模板与图片重试
uv run python save_linuxdo_topic.py --input-json <path_to_json> --output-dir cases/<topic_id> --pdf --pdf-config configs/pdf.default.json --image-retry-count 2 --image-retry-delay 1.5

# 启动本地桥接服务（供浏览器插件调用）
uv run python local_bridge_server.py

# 桥接服务健康检查
curl http://127.0.0.1:17805/health

# 查看 CLI 帮助
uv run python save_linuxdo_topic.py --help
uv run python local_bridge_server.py --help
```

## 架构（三层）

```
browser-extension/   ──POST JSON──►  local_bridge_server.py  ──►  archive_core.py
       (采集)                         (HTTP 桥接 + 限流)           (核心归档管线)
                                              ▲
save_linuxdo_topic.py ─────────────────────────┘
       (CLI 入口)
```

### `archive_core.py` — 核心管线
所有归档逻辑的唯一实现，CLI 和桥接服务都调用它：
- `archive_topic_from_data()` — 主入口：接收 topic JSON dict，执行完整管线（写 raw JSON → 渲染 Markdown → 下载图片 → 可选生成 PDF → 更新索引 → 写任务日志）
- `archive_topic_from_json_file()` — 从本地 JSON 文件读入后委托给上面的函数
- `fetch_topic_json()` — 在线抓取（通过 Camoufox 反指纹浏览器），仅作为备选
- `render_markdown()` — 将 Discourse topic JSON 转为 Markdown，同时用 `rewrite_post_html_and_download_images()` 处理图片本地化
- `render_pdf_from_markdown()` — MD → HTML → PDF（Playwright Chromium）
- `build_cases_index()` — 扫描 `cases/` 目录生成索引表 `cases/index.md`
- `resolve_pdf_style()` — 深度合并默认样式 + 配置文件 + 运行时覆盖
- `ArchiveResult` — 归档结果 dataclass，包含所有输出路径

### `save_linuxdo_topic.py` — CLI 入口
argparse 封装，支持离线导入（`--input-json`）和在线抓取（传 topic URL）两种模式。所有业务逻辑委托给 `archive_core`。

### `local_bridge_server.py` — HTTP 桥接服务
- 端口 17805，仅绑定 `127.0.0.1`
- `GET /health` — 健康检查
- `POST /import-topic` — 接收浏览器插件提交的 JSON，调用 `archive_core.archive_topic_from_data()`
- `ImportGuard` — 单任务串行 + 最小间隔限流（默认 8 秒）
- 路径安全检查：output_dir 必须在 workspace_root 内，pdf_config_path 必须在项目目录内

### `browser-extension/` — Chrome Manifest V3 插件
`popup.js` 从当前 linux.do 页面采集 topic JSON，POST 到本地桥接服务。支持 md-only / md+pdf 模式切换、PDF profile 选择、失败重试、本地历史记录。

## 输出目录结构

```
cases/<topic_id>/
  ├── topic_<topic_id>.md        # 归档 Markdown
  ├── topic_<topic_id>.pdf       # 可选 PDF
  ├── topic_<topic_id>.html      # 可选中间 HTML
  ├── raw/topic_<topic_id>.json  # 原始 JSON 备份
  └── images/post_NNN_img_NN.ext # 本地化图片
cases/index.md                   # 自动生成的归档索引
logs/archive_tasks.jsonl         # 任务日志（JSONL）
```

## 安全与约束（必须遵守）

- 不做权限绕过，不做批量高频抓取，不做并发轰炸
- 本地桥接服务仅绑定 `127.0.0.1`，仅接受 `linux.do` 主题 URL
- PDF 配置文件路径必须在本项目目录内（`is_within_root` 检查）
- 默认单帖单目录归档，避免覆盖与交叉污染

## 契约文件

- `docs/topic-import.schema.json` — 插件→桥接服务的请求 JSON Schema
- `configs/pdf.default.json` — 默认 PDF 样式
- `configs/pdf.ctf-full.json` — CTF 完整报告模板（含封面页）
- `configs/pdf.ctf-brief.json` — CTF 精简模板
