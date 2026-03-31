# Linux.do 归档助手

把当前 `linux.do` 帖子导出到本地，生成可长期保存和二次利用的归档目录：

- `Markdown`
- `原始 JSON`
- `图片`
- `PDF`

这个项目采用 **浏览器扩展 + 本地桥** 的方式工作：

1. 你在浏览器里打开 `linux.do` 帖子
2. 点击扩展里的“导出当前帖子”
3. 扩展读取当前帖子的 JSON 数据
4. 本地桥负责落盘、下载图片、生成 PDF

这样做的好处是：

- 不需要自动化登录抓站
- 不做高频批量抓取
- 更适合个人归档、研究整理、AI 上下文打包

## 当前状态

当前版本已经适合作为公开原型使用，主要能力包括：

- 导出当前 Linux.do 帖子到本地目录
- 自动补齐分页楼层，不只抓首屏楼层
- 可选生成 PDF
- 支持导出指定楼层范围
- 插件内显示导出阶段进度
- 导出完成后可直接打开结果目录
- 本地桥限制为单任务串行，降低误触和风控风险

## 目录结构

- `archive_core.py`：归档核心逻辑
- `save_linuxdo_topic.py`：命令行入口
- `local_bridge_server.py`：本地桥 HTTP 服务
- `browser-extension/`：浏览器扩展
- `configs/pdf.default.json`：默认 PDF 样式配置
- `docs/topic-import.schema.json`：扩展传给本地桥的数据契约

## 环境准备

先安装依赖：

```powershell
uv sync
uv run playwright install chromium
```

## 使用方式

### 方式 A：浏览器扩展 + 本地桥

先启动本地桥：

```powershell
uv run python .\local_bridge_server.py
```

如果你想把输出统一放到某个工作区目录，也可以这样启动：

```powershell
uv run python .\local_bridge_server.py --workspace-root "C:\path\to\workspace"
```

然后：

1. 打开 `chrome://extensions/`
2. 打开“开发者模式”
3. 选择“加载已解压的扩展程序”
4. 选择 `browser-extension`
5. 打开任意 `https://linux.do/t/...` 帖子页
6. 点击扩展里的“导出当前帖子”

导出完成后，结果会出现在：

- 默认：`cases/<topic_id>/`
- 如果使用了 `--workspace-root`：`<workspace_root>/cases/<topic_id>/`

### 方式 B：命令行直接导入 JSON

如果你已经拿到帖子 JSON，也可以直接走 CLI：

```powershell
uv run python .\save_linuxdo_topic.py --input-json ".\topic.json" --output-dir ".\cases\1773192" --pdf
```

指定楼层范围示例：

```powershell
uv run python .\save_linuxdo_topic.py --input-json ".\topic.json" --output-dir ".\cases\1773192" --pdf --post-start 10 --post-end 30
```

## 浏览器扩展说明

当前扩展界面提供：

- `同时生成 PDF`
- `高级选项 > 起始楼层 / 结束楼层`
- `导出阶段进度显示`
- `打开最近一次输出目录`

说明：

- 默认导出整帖
- 楼层范围留空时表示不截断
- 进度条主要覆盖“本地桥处理阶段”
- 读取页面 JSON 的这一步仍然需要等浏览器完成

## 输出内容

每个帖子一般会生成这些文件：

- `topic_<topic_id>.md`
- `topic_<topic_id>.pdf`
- `raw/topic_<topic_id>.json`
- `images/...`

还可能包含：

- `topic_<topic_id>.html`
- `cases/index.md`
- `logs/archive_tasks.jsonl`

## 安全原则

- 只处理当前打开的帖子页
- 只和本机 `127.0.0.1` 通信
- 不存储账号密码
- 不导出 Cookie
- 本地桥默认单任务串行
- 不建议做批量高频连续导出

## 快速验证

```powershell
uv run python .\save_linuxdo_topic.py --help
uv run python .\local_bridge_server.py --help
node --check .\browser-extension\popup.js
```

## 适合谁

这个项目更适合：

- 想把帖子长期留档的人
- 想把完整图文内容喂给 AI 的人
- 想保留楼层、图片、PDF 成果的人

如果你的目标是“一键安装、完全无本地依赖、普通用户零配置”，那这项目还可以继续往前包装一层，但当前版本已经适合作为开源原型发布和收集反馈。
