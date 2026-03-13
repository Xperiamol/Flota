# Flota 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范。

## [3.0.0] - 2026-03-13

### Added / 新增
- 新增 FlotaAI：内置 AI 对话与辅助能力，可在应用内直接进行内容生成与整理。
- 新增全新的所见即所得编辑模式，支持更直观的富文本编辑体验。
- 新增手机同步能力，实现桌面端与移动端的数据联动。

### Changed / 变更
- 品牌与应用名称正式切换为 Flota（由原名称升级）。
- 完成一轮 UI 整体调整，改进界面结构、交互流与视觉一致性。
- 将部分原插件能力迁移至应用本体，降低依赖并提升开箱可用性。

### Fixed / 修复
- 修复部分插件模式下能力不可用或配置分散的问题，迁移后稳定性更高。
- 修复编辑与展示割裂带来的体验问题，统一为更连续的编辑-预览流程。

### Docs / 文档
- 更新 3.0.0 发布说明，明确改名、FlotaAI、编辑模式升级与手机同步等核心变化。
- 继续沿用 `npm run release:notes` 从 CHANGELOG 自动提取最新版条目，用于 CI 与 GitHub/Gitee Release 描述同步。

## 2.3.1 (2026-01-13)

### 🔥 重大修复

#### Google Calendar 同步数据完整性修复
- **修复高风险**: description 字段双向同步一致性问题，避免空值覆盖
- **修复中风险**: 四象限属性（重要/紧急）现在完整同步
- **修复中风险**: 标签现在完整同步
- **实现方案**: 元数据编码系统，将扩展字段嵌入 description
  - 格式: `[重要][紧急][标签:tag1,tag2]\n原始描述内容`
  - 向后兼容：旧数据无元数据前缀正常解析
  - 手动编辑：可在 Google Calendar 删除元数据标记

#### 同步字段扩展
- **新增同步**: is_important（重要标记）
- **新增同步**: is_urgent（紧急标记）
- **新增同步**: tags（标签）
- **同步字段数**: 5 → 8 个（+60%）

### 📊 测试覆盖
- 新增编码/解码测试套件（9 个测试用例）
- 测试通过率: 100%
- 包含向后兼容性测试

### 📚 文档更新
- 新增: [Google Calendar 同步数据流分析](docs/GOOGLE_CALENDAR_SYNC_DATA_FLOW.md)
- 新增: [Google Calendar 同步修复说明](docs/GOOGLE_CALENDAR_SYNC_FIX.md)
- 详细的迁移指南和使用示例

### 🔗 相关文件
- `electron/services/GoogleCalendarService.js` - 核心修复（L682-768）
- `electron/services/__test_google_calendar_encoding.js` - 测试套件

---

## 2.3.0 Zeta (2025-12-16)

### 亮点 🎉
- **修复 Windows 通知显示问题**：正确设置 `appUserModelId`，使通知显示正确的应用名称 "Flota" 和应用图标，而不是 "electron.app.Flota"。
- 改进了 AI 服务对第三方/自定义 OpenAI 兼容 API 的支持，修复了空响应导致的 JSON 解析错误以及自定义 API URL 未附带 /chat/completions 导致的 404 问题。
- 优化独立窗口（Standalone）行为：关闭托盘内的“退出”或在应用退出时将强制销毁所有窗口，避免进程残留导致重复启动或主应用无法重新打开的问题。
- Windows 安装程序（NSIS）新增交互式卸载选项，用户可在卸载时选择是否删除本地数据（笔记 / 数据库 / 设置）。
- 修复若干 UI/UX 和前端逻辑问题，包括拖放、HTML 嵌套/水合报错，以及笔记/待办独立窗口的保存/关闭流程。

---

## 主要修复与改进

### Windows 通知系统
- **修复**：在 Windows 平台上设置正确的 `appUserModelId` (`com.flota.app`)，解决通知显示为 "electron.app.Flota" 的问题。
- **改进**：所有通知标题统一使用 "Flota" 或 "Flota - [功能名]" 格式，提升品牌一致性。
- **改进**：为所有通知添加应用图标支持，确保在 Windows 通知中心正确显示应用图标。
- **改进**：优化 NSIS 安装脚本，在安装时正确配置快捷方式属性，确保通知系统能够正确识别应用。

### AI 服务
- 修复：当第三方/自定义 AI 服务返回空或 malformed JSON 时，之前使用 `response.json()` 会抛出 "Unexpected end of JSON input" 的异常。现在统一使用 `response.text()` + JSON.parse 的安全处理方式并捕获错误，防止主进程崩溃。
- 新增：对自定义 OpenAI 兼容 API 的 URL 自动标准化（normalizeApiUrl），当用户填写的 URL 以 `/v1`, `/v2`, `/v3` 等结尾时，会自动追加 `/chat/completions`，避免 404 错误导致请求失败。
- 修复：AI 服务测试接口（testOpenAI、testQwen 等）也采用了更健壮的错误处理与超时保护。

### Windows 安装/卸载与数据保留
- 改进：NSIS 安装脚本（Electron-builder 配置）支持自定义卸载脚本，卸载时弹窗询问用户是否删除数据（包括数据库、配置文件、缓存等）。默认保留（便于重装时恢复），用户选择“删除”则会清理 APPDATA/local 目录中的 Flota 数据。
- 注意：如果你希望默认自动删除，请在 `package.json` 的 NSIS 配置中切换 `deleteAppDataOnUninstall`。

### 独立窗口与进程管理
- 修复：独立窗口（例如笔记独立窗口、Todo 独立窗口）在关闭时可能由于 `close` 事件中 `preventDefault()` 的处理而被阻止退出，配合 `before-quit` 的应用退出流程，导致进程残留。现在，在应用退出时（通过托盘菜单或其他方式触发）会强制销毁所有窗口（`window.destroy()`）以确保程序正确退出。
- 改进：在 `window-all-closed` 事件中，增加对主窗口存在性的检测。如果主窗口仍存在且仅被隐藏（托盘），则不退出；如果主窗口已经被销毁（例如独立窗口单独运行场景），则退出应用。

### 前端/界面修复
- 修复：Quadrant 视图中钩子和 `renderTodoItem` 中未传递 `onDragStart`/`onDragEnd` 导致无法拖动的问题（支持将待办从一个象限拖到另一个象限）。
- 修复：MUI `ListItemText` 的 secondary 中包裹 `div` 导致的 `<div> cannot be a descendant of <p>` 水合错误，统一改为 `secondaryTypographyProps={{ component: 'div' }}` 来避免报错和样式问题。
- 修复：独立窗口关闭前保存逻辑增加超时保护，避免 UI 锁死或窗口无法关闭的问题。

### 其他修复
- 版本号统一：从 “Epsilon” 更新为 “Zeta” 并同步到 `package.json`、主进程以及 README/文档中的版本引用。
- 修复若干插件管理、快捷键、托盘图标显示相关的 bug 和异常处理逻辑，提升稳定性与恢复能力。

---

## 开发者说明 / 升级须知
- 自定义 AI 提供者：现已支持更宽松的自定义地址格式；如果此前遇到 404 或 “Unexpected end of JSON input” 的问题，建议更新到该版本。
- NSIS 卸载脚本：我们引入了 `build/installer.nsh` 的自定义脚本来询问是否删除应用数据；如需更改默认行为，请修改 `package.json` 的 `nsis` 配置（`deleteAppDataOnUninstall` / `include`）。
- 应用退出：为了保证数据一致性和避免残留进程，我们在 `before-quit` 中使用强制销毁窗口来保证退出流程完成。如果你的插件或窗口依赖 `close` 事件上的交互，最好升级并适配新的退出行为，或在窗口中监听 `beforeunload` 并做相应的数据同步。

---

## 已知问题及后续计划
- 部分自定义插件在旧版本中可能依赖 `close` 事件阻塞行为，建议插件作者检查并兼容 `beforeunload` / `__saveBeforeClose` 的调用时机。
- 我们计划在下一版本中：
  - 改善托盘交互体验（图标状态和快捷动作）
  - 提供更详细的卸载清理控制（只删除特定部分数据）
  - 增强插件 API 的退出钩子兼容性

---

感谢你使用 Flota！如需帮助或想查看详细变更，请访问我们的 GitHub 仓库或在应用中提交反馈。