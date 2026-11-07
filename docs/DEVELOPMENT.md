# Flota 开发指南 / Development

[返回中文 README](../README.md) · [English](#english)

## 环境与运行

需要 Node.js、npm，以及当前 Electron 版本支持的系统。安装依赖时需要下载 Electron；原生模块可能需要本机编译工具。

```bash
npm install
npm run electron-dev
```

`electron-dev` 会准备 SQLite 原生模块、启动 Vite（5174 端口），再打开 Electron。只调试前端时使用 `npm run dev`；部分功能依赖 Electron IPC，不能在普通浏览器中完整使用。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run build` | 构建前端，并生成第三方许可清单 |
| `npm run electron-build` | 准备 SQLite、模型与剪藏扩展，构建并打包桌面应用 |
| `npm test` | 运行默认单元回归 |
| `npm run test:editor` | 编辑器浏览器集成回归，需要本机 Chromium / Chrome |
| `npm run test:sync` | 同步集成回归 |
| `npm run test:backup` | 备份恢复集成回归 |
| `npm run build:clipper` | 准备浏览器剪藏扩展资源 |

完整命令见 [`package.json`](../package.json)，发版操作见 [发布流程](./RELEASE_FLOW.md)。

## 代码位置

- `src/components/`：编辑器、待办、首页、AI、设置等 React 界面。
- `src/store/`、`src/hooks/`：Zustand 状态与交互逻辑。
- `src/styles/`、`src/locales/`：主题与中英文文案。
- `electron/dao/`、`electron/services/`、`electron/ipc/`：SQLite、应用服务和 IPC。
- `plugins/`、`extensions/chrome-clipper/`：插件与浏览器扩展。
- `scripts/tests/`：回归测试；`docs/images/`：当前 README 截图。

主要使用 React 18、Vite、Electron、Material UI / Emotion、Zustand、TipTap、Excalidraw 和 better-sqlite3。准确版本以 `package.json` 和锁文件为准。

## 数据库维护

`npm run repair-db` 是故障排查工具，会修改数据库、重建全文索引，不属于日常构建流程。先退出 Flota，完整备份数据目录，再运行；可用 `FLOTA_DB_PATH` 指定待修复的数据库。原生模块版本不匹配时，先运行 `npm run sqlite:node`；完成维护后，运行 `npm run sqlite:electron` 再启动桌面应用。

## README 与截图维护

中英文 README 的功能范围保持一致。界面有明显变化时一起更新截图，使用演示数据，记录版本与拍摄日期，避免拍入个人笔记或服务凭据。历史快照只追加，不把当前说明反向更新进旧档案。

---

## English

Install Node.js and npm on a system supported by the bundled Electron runtime. Dependency installation downloads Electron; native modules may require local build tools.

```bash
npm install
npm run electron-dev
```

This prepares SQLite and starts both Vite on port 5174 and Electron. Use `npm run dev` for frontend-only work; features relying on Electron IPC are unavailable in a regular browser.

| Command | Purpose |
| --- | --- |
| `npm run build` | Build frontend assets and generate third-party notices |
| `npm run electron-build` | Prepare SQLite, models, and the clipper, then build and package the app |
| `npm test` | Run default unit regressions |
| `npm run test:editor` | Run browser editor integration tests; requires local Chromium / Chrome |
| `npm run test:sync` | Run sync integration tests |
| `npm run test:backup` | Run backup / restore integration tests |
| `npm run build:clipper` | Prepare browser extension assets |

See [`package.json`](../package.json) for all scripts and the [release workflow](./RELEASE_FLOW.md) for publishing (Chinese).

React views live in `src/components/`, state in `src/store/`, and desktop services, SQLite access, and IPC in `electron/`. Regression tests live in `scripts/tests/`. See the [plugin documentation](../plugins/docs/README.md) for extension APIs.

`npm run repair-db` modifies the database and rebuilds its full-text index. Quit Flota and back up the entire data directory first. Set `FLOTA_DB_PATH` to target a specific database. If the native module ABI does not match Node, run `npm run sqlite:node`; switch back with `npm run sqlite:electron` before launching the desktop app.

Keep both READMEs aligned. Refresh screenshots after visible UI changes, use demo data, and record the capture date and version. Preserve historical snapshots without rewriting them to describe the current app.
