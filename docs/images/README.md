# README 截图 / Screenshot provenance

拍摄日期 / Captured: 2026-11-07（Asia/Singapore）

基于桌面版 4.5.4 源码，包含本次窗口适配修复。使用独立临时数据目录与演示数据，没有加载个人数据库。截图由当前 Electron 应用原生生成，笔记、首页和待办窗口内容尺寸为 1360 × 850，AI 和记忆为 1360 × 862；导出宽度均为 1440 像素。没有重绘界面或伪造 AI 回复。

| 文件 | 内容 |
| --- | --- |
| `home-light-zh.png` | 中文首页与默认卡片 |
| `notes-light-zh.png` / `notes-light-en.png` | 中文 / 英文演示笔记与任务列表 |
| `todos-dark-zh.png` / `todos-dark-en.png` | 深色主题四象限与中文 / 英文演示待办 |
| `ai-agent-zh.png` / `ai-agent-en.png` | 自定义 Prompt 快捷方式与待发送的工作请求；未调用外部 AI 服务 |
| `memory-personal-zh.png` | 真实记忆管理界面；手动加入的偏好与知识演示数据，使用本地向量模型 |

`en` 文件使用英文演示内容和应用的英文语言设置；当前应用中部分界面标签与 AI 建议仍是固定中文，截图保留实际状态。首页与记忆各维护一张中文截图，英文 README 明确注明语言。演示记忆不代表真实用户信息，也不用于声称自动提取效果；AI 图片仅展示未发送的草稿。

更新时：使用新的独立演示目录，准备笔记与待办，关闭开发者工具后拍摄；验证窗口尺寸与页面视口一致，并逐张检查文字、裁切和主题。不要使用会改变真实窗口截图比例的设备模拟。界面发生明显变化时更新对应图片及本页版本 / 日期，中英文 README 一起检查。历史图片放在 `../history/images/`，保持不变。

These are native screenshots of the current Electron app, using an isolated demo profile and no external AI calls. English captures retain labels that the app has not yet translated. Refresh the version and date when replacing images; keep historical assets in the history archive.
