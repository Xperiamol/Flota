# Flota 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范。

## [3.3.0] - 2026-06-15

### Added / 新增
- **AI 助手「联网搜索」**：新增 `electron/services/websearch/` 服务（默认对接 feedcoop `/search_api/web_search`），AI 设置面板可配置开关 / 服务商 / API Key / 端点 / 返回数，工具循环可在对话中直接检索网络结果。
- **AI 助手「长文档生成」管线**：新增 `electron/services/longtask/`，引入 Planner → SectionAgent → Merge 三段式流式写作（按章节滚动摘要续写、字数估算、可中断），对话中以 `LongDocSteps` 步骤树展示规划/逐章/归并进度，可点开成稿笔记。
- **切换笔记自动 AI 标注**：新增 `useAIAutoAnnotate` hook 与 `ai_auto_title_enabled` / `ai_auto_tags_enabled` 设置，对空标题笔记自动生成标题、对内容自动推荐并合并标签。
- **双链 `[[wiki-link]]` 体系**：新增 tiptap 扩展 `WikiLinkMark` / `WikiLinkSuggestion`，配套 `BacklinksPanel`、`UnlinkedMentionsPanel`、`WikiLinkHoverPreview`、`WikiLinkSuggestionPopup` 组件，新增 `useLinkGraph` 双链索引（自动跳过代码块与行内代码），笔记重命名时全库改写 `[[old]]` → `[[new]]`，保留 `|别名` 与 `#章节`。
- **一级侧栏「最近笔记」轨道**：新增 `RecentNotesRail` 组件 + `useRecentNotes` store（不限数、tab 语义稳定排序、记滚动百分比、不持久化）。
- **知识图谱视图改为「真分离」插件**：内置 `knowledge-graph` 插件通过 manifest `capabilities.views` 声明，运行时经新增的 `app://plugin/<id>/<rel>` 协议按需 ESM 加载、由 esbuild 预编译，禁用插件后主应用 dist 不再包含图谱代码。新增 `usePluginViews` / `usePluginEnabled` store，主侧栏改为数据驱动渲染插件视图（含 `DynamicIcon` 名称解析）。
- 新增 `src/utils/aiCore/`（contextBuilder / intentRouter）、`aiIntentUtils.js`（写作场景意图路由）、`floatingGlassSx.js`（浮窗统一玻璃风样式）。
- AI 配置新增 `ai_limit_max_tokens` 开关与 `ai_vision_enabled` 多模态开关。

### Changed / 变更
- **主进程瘦身重构**：`electron/main.js` 拆出 16 个 IPC handler 模块到 `electron/ipc/`（ai / attachments / dataIO / media / mem0 / note / pluginStore / setting / shortcut / stt / system / systemMisc / tag / whiteboard / window 等），main.js 仅保留启动编排与协议注册；CSP `script-src` 加入 `app:` 来源。
- **AI 服务层重写**：原 `AIChatService.js` 重写为 `electron/services/aichat/` 子模块（tools/dispatcher、stream/streamRequest + sseParser + toolLoop、systemPrompt、memoryContext、noteSummary、PendingActionStore），与新增 longtask、websearch 共同构成 AI 服务层。
- **组件目录大规模重组**：`src/components/` 按职责拆为 `ai/ common/ editor/ filters/ layout/ notes/ plugins/ settings/ sync/ todos/` 子目录，全部 import 路径同步更新。
- 主入口 `src/index.jsx` 注入冻结的 `window.__flotaHost__` 宿主单例（React / MUI / 主题工具 / store / utils），插件视图共享主应用 React 实例，避免双 React / 双 MUI 主题上下文。
- `PluginManager.preinstallExamplePlugins` 支持按 `manifest.version` 自动升级覆盖内置示例插件。
- `App.jsx` 的 `appTheme` 改为 `useMemo` 缓存，并修正初始化 effect 依赖避免重复触发；插件视图统一以 `Suspense + lazyComponent` 渲染。

### Fixed / 修复
- 当用户停留在某插件视图（如图谱）时该插件被禁用/卸载，自动回退到「笔记」视图，避免空白页。
- 修复插件视图选择器在每次 store 通知时返回新数组导致 React `getSnapshot should be cached` 警告与无限重渲染。
- `AIService.saveConfig` 仅在字段存在时写入联网搜索 / Vision / auto-title / auto-tags 等字段，避免被 `undefined` 覆盖。
- 双链索引与全库改名正确跳过 ``` / ~~~ 围栏代码块与行内 `` ` `` 代码，不再误改代码示例中的 `[[xxx]]` 字面量。

### Removed / 清理
- 删除 `electron/services/AIChatService.js`（1105 行单体），逻辑全部并入 `electron/services/aichat/`。
- 删除内置示例插件 `ai-task-planner`（README / icon / index.js / manifest / planner-mui.html）及 `plugins/registry.json` / README 中的对应条目，由 `knowledge-graph` 取代为「视图贡献」类示例。
- 删除 `src/components/notes/GraphView.jsx`（1085 行），其全部逻辑随 `knowledge-graph` 插件包发布。
- 移除 `main.js` 中随 IPC 拆分一同失效的 imports（ipcMain / dialog / clipboard / crypto / https / ImageStorageService / getLocalUsageStats 等）。
- 精简 `window.__flotaHost__`：移除未被任何插件视图使用的 `ReactJSXRuntime / Emotion / Zustand` 三个 import 与暴露字段。
- 简化 `usePluginViews.js` 中 `React.lazy` 加载器：移除冗余的 `Component.default || Component` 二次解包。

## [3.2.1] - 2026-06-03

### Added / 新增
- 新增「笔记导航小窗」（默认快捷键 `CmdOrCtrl+J`）：仿 AI 小窗的浮动玻璃面板，左上角入口在 AI 按钮右侧；展示当前笔记大纲（H1~H6）+ 最近笔记列表，支持搜索、点击大纲条目平滑滚动到对应位置、点击列表项快速切换笔记。Standalone 独立窗口模式同样支持，浮窗位置分别独立持久化（`flota.noteNavigator.position` / `flota.noteNavigator.standalone.position`）。

### Fixed / 修复
- **彻底修复笔记编辑器顶部工具栏在某些窗口宽度下不自动折叠/展开的问题**：之前使用 `scrollWidth` 真实溢出检测，但左侧标题区是 `flex:1 minWidth:0` 会无限压缩到 min-content，导致中等宽度场景永远测不到溢出。改为「实测左侧固定块（标签按钮 / 类型切换器）宽度 + 标题最小可视宽度」做阈值映射，标题不长时也能在窗口稍变窄就立即开始折叠。
- 修复重新打开笔记时上方工具栏不重新计算可见数的问题：新增 `toolbarMeasureSignature` 触发重测；修复因此引入的 `Cannot access ... before initialization` 与 `Rendered more hooks than during the previous render` 错误（抽出 `computeFromClientWidth` `useCallback`、把 `if (!selectedNoteId) return` 早退移到所有 Hook 之后）。
- 修复尝试基于 `useLayoutEffect` 兜底导致的「`Maximum update depth exceeded`」死循环。

### Changed / 变更
- 上下两个工具栏的折叠/展开微动画完全统一：`max-width 160ms ease, margin-right 160ms ease, opacity 140ms ease, transform 160ms ease`，且「更多」按钮的弹出/隐藏与图标项使用同一组过渡。
- 笔记导航小窗与 AI 小窗一致地从应用顶层渲染，非全屏 portal 到 `document.body`、笔记 fullscreen 时 portal 到全屏元素，确保面板永远位于最顶层 stacking context，不再被祖先 `transform/filter` 等限制。
- `compactToolbar` 模式（`max-width: 1180px`）下笔记类型切换按钮只显示图标，节省横向空间。

## [3.2.0] - 2026-06-02

### Added / 新增
- 表格在窗口底部新增常驻浮动横向滚动条，过宽表格不再需要拉到最下面才能左右滚动（`useFloatingTableScrollbar`）。
- 笔记编辑器大工具栏与编辑器内工具栏在窗口宽度不足时自动按优先级折叠到「更多」菜单，避免按钮重叠。
- AI 长笔记上下文管理：短笔记直接全文注入；长笔记仅注入元信息、目录大纲、首尾预览，并新增 `read_current_note` / `search_in_current_note` / `summarize_current_note_section` 三个工具，AI 可按需读取或摘要任意段落。
- 个人中心活跃度热力图改为基于变更日志（`changes` 表）的真实编辑次数统计，新增 `note:get-activity-heatmap` IPC。

### Changed / 变更
- 同步状态弹窗：当 provider 为 webdav 时，待办与其它项时间/失败状态展示统一。
- 抽取 `src/utils/fileUrl.js` 集中处理本地资源路径解析，减少各组件重复实现。
- 精简 `AIChatService` 中三个新工具的样板代码，统一 `_getCurrentNoteLines` 辅助方法。

### Fixed / 修复
- 修复 AI 工具读取长笔记时只能拿到开头内容的问题（前端 `formatNoteContentForAI` 与后端 `truncate` 串联截断）。
- 修复 `AIChatView` / `AICommandCenter` 渲染代码块时控制台 `<pre> cannot appear as a descendant of <p>` 警告。
- 修复 `TimelineView` 同一图片/附件/录音 url 出现多次时 React `key` 重复警告（5 处）。
- 修复历史笔记中残留的内联 `data:image/...` base64 图片在时间轴卡片渲染时触发 `ERR_INVALID_URL` 的问题。

### Removed / 清理
- 删除 12+ 个冗余文件：`OPPOSans R.ttf`、`docs/site/index.html`、`SyncConfigPage`、`SyncProviderSettings`、`syncRegistry`、`ConflictResolver`、`RetryHelper` 以及 4 个废弃 `scripts/`，并清理 `tagUtils` / `shortcutUtils` / `aiContextUtils` 中的死代码。


## [3.1.6] - 2026-06-01

### Added / 新增
- 新增通用附件上传：拖入 / 粘贴 / 复制 PDF、Word、Excel 等任意文件，自动按内容 SHA-1 去重存入 `attachments/` 并支持云同步。
- 新增"附件最大文件大小"设置项（默认 50 MB，可设为 0 不限），超过限制会有明确提示。
- 新增附件块状卡片渲染：编辑器和预览中的附件以蓝色图标 + 文件名的卡片展示，与录音块视觉一致，单击用系统默认应用打开。

### Changed / 变更
- 统一时间轴和笔记编辑器的附件拖入行为，所有入口走相同的存储与渲染管线。
- 改善 WebDAV 同步错误信息：附带具体请求方法和路径，便于定位坚果云流量耗尽等问题。
- CSP 放行 `http:` 图片源，修复内网图片被拦截。

### Fixed / 修复
- 修复拖入文件后显示成 `<a href="attachments/...">…</a>` 字面 HTML 的问题（tiptap-markdown 的 `insertContent` vs `insertContentAt` 行为差异）。
- 修复点击应用内附件链接时被 `system:open-external` 的 URL 校验拒绝的问题；新增 `attachments:open` 专用 IPC，限定仅可打开 `attachments/`、`audio/`、`images/` 白名单目录，并校验文件名防止路径穿越。
- 修复附件保存失败被静默吞掉的问题，现会以弹窗提示具体原因。
- 修复粘贴附件时未识别 `attachments/` 路径导致预览出现链接占位的问题。


## [3.1.5] - 2026-05-22

### Changed / 更新内容
- feat(filters): draggable filter popover with new dimensions and tag waterfall


## [3.1.4] - 2026-05-19

### Changed / 更新内容
- fix(editor): stabilize selection and ai toolbar behavior


## [3.1.3] - 2026-05-19

### Changed / 更新内容
- fix: improve editor window and whiteboard ai flows


## [3.1.2] - 2026-05-18

### Added / 新增
- 新增画布组合图生成管线，支持流程图、时序图、类图、ER 图、思维导图、鱼骨图、甘特图、时间轴、四象限、饼图和架构图的统一编排。
- 新增 Mermaid 图片的 DSL 重画能力，可在画布中选中图像后直接编辑 DSL 并原位替换。

### Changed / 变更
- 重构画布编辑器与 Excalidraw 主题定制，统一顶部工具栏、菜单、属性面板、素材库和滚动条的毛玻璃视觉风格。
- 优化全屏沉浸式写作体验，全屏下隐藏应用顶部栏，同时保留 AI 小窗在全屏容器内可用。
- 优化笔记内 AI 与全局 AI 小窗的联动方式，统一为单实例动态 Portal，避免全屏切换时流式状态中断。

### Fixed / 修复
- 修复全屏按钮文案 key 错误、全屏时 AI 助手浮窗不可见的问题。
- 修复画布 AI 追加后图片资源可能丢失、保存失败仍误报成功的问题。
- 修复组合图 DSL 生成失败被静默吞掉，导致空白或缺块仍提示成功的问题。


## [3.1.1] - 2026-05-13

### Added / 新增
- 新增桌面端本地资源使用量水波展示，并将今日完成率卡片升级为可复用的主题色水波样式。
- 新增 AI 小窗“新建对话”入口，并打通笔记内 AI 与全局对话历史的统一线程管理。

### Changed / 变更
- 重构个人页卡片信息结构，保留瀑布流布局的同时提升浏览顺序，并支持从今日待办/逾期待办直接跳转到待办筛选结果。
- 优化块多选入口与交互，支持工具栏与右键菜单默认显示、重复点击开关、块拖拽排序与更稳定的覆盖层刷新。
- 优化关于页版本与更新体验，应用启动后自动静默检查更新，关于页仅保留轻量状态反馈。

### Fixed / 修复
- 修复桌面端与移动端编辑器在空行、空格和 metadata-only 保存场景下的格式漂移问题。
- 修复 AI 对话历史缺失、笔记内 AI 不生成独立会话、主页面与小窗对话不同步的问题。
- 修复检查更新 403、主进程 handler 丢失、GitHub release fallback 解析失败等更新链路问题。
- 修复个人页“编辑资料”跳转错误、今日完成率空态展示不准等仪表盘问题。

## [3.1.0] - 2026-05-09

### Added / 新增
- 新增全局 AI 命令中心，支持当前笔记问答、知识库搜索、创建待办、总结本周和关联内容发现。
- 新增 AI 上下文包，整合当前笔记、相关笔记、近期待办和 Mem0 记忆，并在回答中展示来源。
- 新增笔记详情浮窗，集中展示笔记元数据与 AI 发现，替代侧边栏推荐入口。
- 新增公共图片预览组件，统一 Markdown、所见即所得编辑器和画布导出的图片查看体验。

### Changed / 变更
- 升级 AI 写入确认链路，待办、笔记和记忆写入前先确认，执行后按类型刷新对应视图。
- 优化同步协议兼容性，桌面端支持 settings 逐 key 时间戳，移动端可解包新格式并保持旧格式写入兼容。
- 优化日历月视图样式，非本月日期整格弱化，选中态恢复轻圆角主色高亮。
- 优化右键菜单、笔记详情浮窗和推荐上下文面板的视觉一致性。

### Fixed / 修复
- 修复图片预览在 100% 附近缩放突变、触控板手势失效和图片导出空 blob 边界问题。
- 修复 AI 待确认操作失败时误报成功、创建待办后待办/日历未刷新的问题。
- 修复笔记列表滚动区域因推荐入口改动失效的问题。
- 修复多端同步中的 manifest 重建保护、settings 类型恢复和画布预览 hash 保留问题。

## [3.0.5] - 2026-03-31

### Changed / 更新内容
- ci: add OSS publish flow and website latest-version download page


## [3.0.4] - 2026-03-30

### Changed / 更新内容
- feat(ai): optimize Mem0Service retrieval and AIChatService prompt rules
- build: auto-generate CHANGELOG.md during npm version lifecycle


## [3.0.3] - 2026-03-30

### Fixed / 修复
- 修复独立窗口模式下笔记保存失败并频繁提示“保存失败，请重试”的问题。
- 修复前端状态管理器对 IPC 返回数据的解构错误，防止笔记数据在同步时被意外清空标签。

### Changed / 变更
- 重构全应用卡片拖拽预览视觉：现在拖拽笔记或待办时，悬浮的卡片将像素级还原列表中的真实样式。
- 新增拖拽边界提示：拖动过程中下方会动态显示常驻的操作引导文本。

## [3.0.2] - 2026-03-27

### Fixed / 修复
- 多选工具栏关闭按钮与顶部栏对齐
- 多选菜单按钮样式统一和优化，增强视觉一致性

### Changed / 变更
- 改进一键版本发布流程，新增 `npm run release:patch:push` 等快捷命令，简化发布操作

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
