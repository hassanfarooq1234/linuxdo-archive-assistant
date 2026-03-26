# Challenge 05 交接文档（Compact）

## 0. 范围
- 仅处理 `challenge-05-linuxdo-archive/`。
- 不涉及其它 Challenge，不修改根目录 `README`。

## 1. 当前状态
- 已完成三层结构：
  1. `archive_core.py`：归档核心（JSON/MD/图片/PDF）
  2. `save_linuxdo_topic.py`：CLI
  3. `local_bridge_server.py` + `browser-extension/`：插件桥接链路
- 已增加契约：
  - `docs/topic-import.schema.json`
- 已增加：
  - 默认 PDF 模板：`configs/pdf.default.json`
  - PDF profile：`configs/pdf.ctf-full.json`、`configs/pdf.ctf-brief.json`
  - `ctf-full` 模板支持封面页
  - 插件端本地历史记录与低频重试
  - 插件端自动分页拉取全部楼层（不止前 20 楼）
  - 图片下载低频重试参数（CLI/Bridge）
  - 楼层范围导出（CLI/Bridge/Plugin）
  - 导出后“打开输出目录”按钮（Plugin + Bridge `/open-folder`）
  - 自动汇总索引：`cases/index.md`
  - 索引排序/过滤参数与任务日志：`logs/archive_tasks.jsonl`
- 已验证：
  - CLI 帮助命令可用
  - 本地离线样例可生成 `Markdown + PDF`

## 2. 安全与约束（必须遵守）
- 账号安全优先，默认使用离线导入（`--input-json`）。
- 不做权限绕过，不做批量高频抓取，不做并发轰炸。
- 默认单帖单目录：`cases/<topic_id>/`。
- 本地服务仅绑定 `127.0.0.1`，仅接受 `linux.do` 主题 URL。
- 桥接服务已启用单任务串行与最小间隔限流。

## 3. 关键命令

### 3.1 环境准备（首次）
```powershell
cd challenge-05-linuxdo-archive
uv sync
uv run camoufox fetch
uv run playwright install chromium
```

### 3.2 离线导入（推荐）
```powershell
cd challenge-05-linuxdo-archive
uv run python .\save_linuxdo_topic.py --input-json "..\<topic_id>.json" --output-dir ".\cases\<topic_id>" --pdf
```

### 3.2.1 离线导入（带模板与重试参数）
```powershell
cd challenge-05-linuxdo-archive
uv run python .\save_linuxdo_topic.py --input-json "..\<topic_id>.json" --output-dir ".\cases\<topic_id>" --pdf --pdf-config ".\configs\pdf.default.json" --image-retry-count 2 --image-retry-delay 1.5
```

### 3.2.1b 离线导入（仅导出部分楼层）
```powershell
cd challenge-05-linuxdo-archive
uv run python .\save_linuxdo_topic.py --input-json "..\<topic_id>.json" --output-dir ".\cases\<topic_id>" --pdf --post-start 10 --post-end 30
```

### 3.2.2 离线导入（仅 Markdown，不生成 PDF）
```powershell
cd challenge-05-linuxdo-archive
uv run python .\save_linuxdo_topic.py --input-json "..\<topic_id>.json" --output-dir ".\cases\<topic_id>"
```

### 3.2.3 离线导入（索引过滤 + 任务日志）
```powershell
cd challenge-05-linuxdo-archive
uv run python .\save_linuxdo_topic.py --input-json "..\<topic_id>.json" --output-dir ".\cases\<topic_id>" --index-sort-by updated_desc --index-only-with-pdf --index-limit 100 --task-log-path ".\logs\archive_tasks.jsonl"
```

### 3.3 启动本地桥接服务（插件模式）
```powershell
cd challenge-05-linuxdo-archive
uv run python .\local_bridge_server.py
```

### 3.4 本地服务健康检查
```powershell
curl http://127.0.0.1:17805/health
```

## 4. 输出规范
- Markdown：`cases/<topic_id>/topic_<topic_id>.md`
- 原始 JSON：`cases/<topic_id>/raw/topic_<topic_id>.json`
- 图片：`cases/<topic_id>/images/post_<楼层>_img_<序号>.<ext>`
- PDF：`cases/<topic_id>/topic_<topic_id>.pdf`
- 中间 HTML（可选）：`cases/<topic_id>/topic_<topic_id>.html`
- 索引：`cases/index.md`
- 任务日志：`logs/archive_tasks.jsonl`（JSONL）

## 5. 插件调用约定
- 插件请求地址：`POST http://127.0.0.1:17805/import-topic`
- 打开输出目录：`GET http://127.0.0.1:17805/open-folder?path=...`
- 请求 Schema：`docs/topic-import.schema.json`
- 默认字段：
  - `output_root="cases"`
  - `download_images=true`
  - `image_retry_count=2`
  - `image_retry_delay=1.5`
  - `generate_pdf=true`
  - `pdf_config_path="configs/pdf.default.json"`
  - `keep_html_for_pdf=true`
  - `update_index=true`
  - `index_sort_by="updated_desc"`
  - `index_only_with_pdf=false`
  - `enable_task_log=true`
  - `post_start` / `post_end`：可选楼层范围

## 6. 下阶段建议（待办）
- 增加 `--no-download-images` 的后补下载工具。
- 增加索引筛选扩展（按日期范围、按关键字）。
- 增加 PDF 模板配置项（目录开关、字体集）。

## 7. Compact 续接指令（复制即用）
仅继续处理 `challenge-05-linuxdo-archive`。先读 `HANDOFF.md`，严格遵守“安全与约束”。默认使用离线导入（`--input-json`），输出到 `cases/<topic_id>/`。不得涉及其它 Challenge 或根目录 README 修改。
