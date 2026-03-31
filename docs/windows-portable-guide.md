# Windows 便携版使用说明

这是给普通 Windows 用户的发布形态，目标是尽量不依赖 Python / uv 等开发环境。

## 便携版里应包含什么

- `linuxdo-archive-bridge.exe`
- `01-启动本地桥.cmd`
- `02-停止本地桥.cmd`
- `03-打开扩展目录.cmd`
- `04-打开输出目录.cmd`
- `browser-extension/`
- `configs/`
- 本说明文件

## 普通用户使用步骤

1. 解压整个便携包到任意目录
2. 双击 `01-启动本地桥.cmd`
3. 打开 `chrome://extensions/`
4. 开启开发者模式
5. 选择“加载已解压的扩展程序”
6. 选择 `browser-extension/`
7. 打开 Linux.do 帖子页，点击扩展导出

## 输出在哪里

- 默认输出目录：`workspace/cases/`
- 日志目录：`workspace/logs/`

## 注意事项

- 首次运行时，Windows 可能弹出安全提示
- 如果旧 PDF 正在被占用，新版本会自动改名生成带时间戳的 PDF
- 本地桥只监听 `127.0.0.1:17805`

## 适合谁

- 不想安装 Python 环境的 Windows 用户
- 只想双击启动并使用扩展的人

