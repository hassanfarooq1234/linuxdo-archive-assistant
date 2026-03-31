# Challenge 05：linux.do 主题帖归档（独立项目）

## 项目定位
- 仅处理 `challenge-05-linuxdo-archive/` 内能力建设。
- 目标：将单个 linux.do 主题帖归档为本地 `Markdown + 图片 + PDF`。
- 默认策略：**离线导入优先**（`--input-json`），账号安全优先于效率。

## 为什么需要这个
主流 AI 侧边栏（Kimi、Monica、Sider 等）阅读网页时只提取文字，**丢失帖子中的所有图片**。linux.do 帖子中大量关键信息存在于截图、图表、代码截图里，纯文本上下文等于丢了一半。

本项目生成的 PDF 通过 Playwright 真实 Chromium 渲染，**文字和图片完整内嵌**，可直接上传到 Claude / ChatGPT / Gemini 等多模态 AI 网页版作为上下文进行带图提问。

**典型工作流：** 在 linux.do 帖子页点插件导出 → 拿到带图 PDF → 拖进 AI 对话框 → 提问。

## 当前能力
- `save_linuxdo_topic.py`
  - 离线导入本地 JSON（推荐）。
  - 可选输出 PDF（`--pdf`）。
  - 支持图片下载低频重试（`--image-retry-count`、`--image-retry-delay`）。
  - 支持 PDF 配置文件（`--pdf-config`）。
  - 支持按楼层范围导出（`--post-start`、`--post-end`）。
  - 默认更新归档索引 `cases/index.md`（可用 `--no-index` 关闭）。
  - 支持索引排序/过滤（`--index-sort-by`、`--index-only-with-pdf`、`--index-limit`）。
  - 默认写入任务日志 `logs/archive_tasks.jsonl`（可关闭或改路径）。
- `local_bridge_server.py`
  - 本地桥接服务（给浏览器插件调用）。
  - 单任务串行 + 最小间隔限流（默认 8 秒）。
  - 支持 `--workspace-root`，可将 `cases/` 与 `logs/` 重定向到桌面工作区等目录。
  - 支持索引排序字段、楼层范围与任务日志字段透传。
- `browser-extension/`
  - Manifest V3 插件原型。
  - 点击一次按钮即可导出当前帖子到本地服务。
  - 插件端会自动分页拉取全部楼层，不止首页默认返回的 20 楼。
  - 失败低频重试（最多 3 次，递增等待）。
  - 支持导出模式切换：`md-only` / `md+pdf`。

## 目录结构
- `archive_core.py`：核心归档能力（JSON/MD/图片/PDF）
- `save_linuxdo_topic.py`：CLI 入口
- `local_bridge_server.py`：本地 HTTP 服务（`/health`、`/import-topic`）
- `browser-extension/manifest.json`：插件清单
- `browser-extension/popup.html`：插件弹窗
- `browser-extension/popup.js`：插件采集与提交逻辑
- `configs/pdf.default.json`：默认 PDF 样式模板
- `logs/archive_tasks.jsonl`：任务日志（运行后生成）
- `docs/topic-import.schema.json`：插件 -> 本地服务请求契约
- `cases/<topic_id>/...`：归档输出目录

## 环境准备
```powershell
cd challenge-05-linuxdo-archive
uv sync
uv run playwright install chromium
```

## 推荐流程 A：离线导入（最安全）
```powershell
cd challenge-05-linuxdo-archive
uv run python .\save_linuxdo_topic.py --input-json "..\<topic_id>.json" --output-dir ".\cases\<topic_id>" --pdf
```

可选增强参数：
```powershell
uv run python .\save_linuxdo_topic.py --input-json "..\<topic_id>.json" --output-dir ".\cases\<topic_id>" --pdf --pdf-config ".\configs\pdf.default.json" --image-retry-count 2 --image-retry-delay 1.5
```

按楼层范围导出示例：
```powershell
uv run python .\save_linuxdo_topic.py --input-json "..\<topic_id>.json" --output-dir ".\cases\<topic_id>" --pdf --post-start 10 --post-end 30
```

索引与日志参数示例：
```powershell
uv run python .\save_linuxdo_topic.py --input-json "..\<topic_id>.json" --output-dir ".\cases\<topic_id>" --index-sort-by updated_desc --index-limit 100 --index-only-with-pdf --task-log-path ".\logs\archive_tasks.jsonl"
```

## 流程 B：插件 + 本地转换器
1. 启动本地服务：
```powershell
cd challenge-05-linuxdo-archive
uv run python .\local_bridge_server.py
```

如需将输出与日志统一放到桌面工作区，可这样启动：
```powershell
cd challenge-05-linuxdo-archive
uv run python .\local_bridge_server.py --workspace-root "C:\Users\<你的用户名>\Desktop\LinuxDo归档工作区"
```
2. 在浏览器扩展管理页加载 `browser-extension/`（开发者模式）。
3. 打开目标主题帖，点击插件按钮 `导出当前帖（JSON → MD+PDF）`。
5. 输出落地到 `cases/<topic_id>/`。

## 输出规范
- Markdown：`cases/<topic_id>/topic_<topic_id>.md`
- 原始 JSON：`cases/<topic_id>/raw/topic_<topic_id>.json`
- 图片：`cases/<topic_id>/images/post_<楼层>_img_<序号>.<ext>`
- PDF：`cases/<topic_id>/topic_<topic_id>.pdf`
- 中间 HTML（可选保留）：`cases/<topic_id>/topic_<topic_id>.html`
- 索引：`cases/index.md`
- 任务日志：`logs/archive_tasks.jsonl`（JSONL）

## 安全与约束
- 优先离线导入，不依赖自动化登录抓取。
- 不做权限绕过，不做批量高频抓取，不做并发轰炸。
- 默认单帖单目录归档，避免覆盖与交叉污染。
- 本地桥接服务仅绑定 `127.0.0.1`，仅允许 `linux.do` 主题 URL。
- PDF 配置文件路径限制在本项目目录内，禁止越界读取。

## 快速验收
```powershell
cd challenge-05-linuxdo-archive
uv run python .\save_linuxdo_topic.py --help
uv run python .\local_bridge_server.py --help
```
