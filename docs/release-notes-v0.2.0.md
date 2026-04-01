# v0.2.0

首个适合公开分享的版本。

## 这版包含什么

- 浏览器扩展可一键导出当前 Linux.do 帖子
- 支持导出 Markdown、原始 JSON、图片资源和带图 PDF
- 支持按楼层范围导出
- 扩展面板内可查看导出进度
- Windows 便携版可直接双击 `01-start-bridge.cmd` 启动本地桥
- 便携版已内置 Playwright/Chromium 运行时，不需要用户自己额外安装浏览器内核

## 适合谁下载

### 普通 Windows 用户
请优先下载便携版压缩包：

- `linuxdo-archive-assistant-windows-portable-v0.2.0.zip`

使用方式：

1. 解压压缩包
2. 双击 `01-start-bridge.cmd`
3. 在 Chrome 中加载 `browser-extension`
4. 打开 Linux.do 帖子并点击导出

### 开发者 / 想自行修改的人
可以直接使用源码仓库：

- 克隆仓库
- 按 `README.md` 安装依赖并运行

## 已知说明

- 当前 GitHub 仓库默认提供的是源码，不是便携版成品目录
- 便携版需要从 Release 附件下载
- 本工具定位是单帖归档，不是批量抓取工具

## 建议下载顺序

- 只想直接用：下载便携版 `zip`
- 想自己改：看源码仓库
