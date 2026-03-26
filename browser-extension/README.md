# Browser Extension (MV3) - Challenge 05

## 用途
- 手动点击按钮，采集当前 `linux.do` 主题帖 JSON。
- 发送到本地桥接服务 `http://127.0.0.1:17805/import-topic`。
- 由本地 Python 服务完成 `Markdown + 图片 + PDF` 归档。
- 导出失败自动低频重试（最多 3 次，递增等待）。
- 保存最近导出历史到本地（可在弹窗清空）。
- 支持导出模式切换：`md-only` 或 `md+pdf`。
- 支持 PDF 模板选择：`ctf-full`、`ctf-brief`。
- 自动更新 `cases/index.md`，并记录 `logs/archive_tasks.jsonl`。
- 可检测本地桥是否在线；安装 Windows 协议后，可从插件内自动拉起本地桥。

## 加载方式
1. 打开浏览器扩展管理页（开发者模式）。
2. 选择“加载已解压扩展程序”。
3. 指向本目录：`browser-extension/`。

## 前置条件
- 本地桥接服务已启动：
```powershell
cd challenge-05-linuxdo-archive
uv run python .\local_bridge_server.py
```

如需让插件自动拉起本地桥，可先注册一次 Windows 协议：
```powershell
cd challenge-05-linuxdo-archive
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\windows\register-protocol.ps1
```

## 使用步骤
1. 打开目标帖子页面（`https://linux.do/t/...`）。
2. 点击插件按钮。
3. 看到“导出完成”后，到 `cases/<topic_id>/` 查看结果。
4. 归档完成后会自动刷新 `cases/index.md`。
5. 如需查看历史，直接在插件弹窗底部查看最近导出记录。

如果插件检测到本地桥未启动，会显示“启动本地桥”按钮，并尝试通过 `linuxdo-archive://start` 自动启动。

## 安全约束
- 仅处理当前标签页，不做批量自动操作。
- 不存储账号密码，不导出 Cookie。
- 所有数据仅发送到 `127.0.0.1` 本地服务。
