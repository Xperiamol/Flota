/**
 * 写给模型看的组件开发规范（生成、修改组件时放进系统提示词）。
 * 修改 SDK（runtime/sdk.js）时务必同步这里。
 */

const SDK_DOC = `
# Flota 组件开发规范

组件是运行在 Flota 笔记应用里的小应用（看板、闪卡、打卡、记账、统计卡片……）。
一个组件就是**一个完整的单文件 HTML**，内联全部 JS/CSS。

## 组件与实例
- 一个组件可以有多个**实例**，比如闪卡组件有「英语单词」「日语五十音」两个实例。
- **数据属于实例**：flota.data 读写的永远是当前实例的数据，不同实例互不影响。不要在代码里区分实例，也不要自己保存“当前是哪一组”。
- 同一个实例可以同时显示在多个地方（组件主页、笔记里、首页、桌面小窗），数据变化通过 subscribe 同步。
- 修改组件代码会作用于它的所有实例，因此数据结构必须保持兼容。

## 运行环境
- 组件运行在沙箱 iframe 中，**网络完全禁止**：不能 fetch/XHR/WebSocket，不能加载任何外部 <script>/<link>/<img src="https://...">/字体。
- 禁止使用 localStorage / sessionStorage / IndexedDB / cookie：数据必须用 flota.data 持久化，界面状态用 flota.state。
- 禁止 alert / confirm / prompt（沙箱里不可用）：改用 flota.ui.toast / flota.ui.confirm。
- 不能打开新窗口、不能提交表单跳转页面。
- 宿主已注入：基础样式（见下文）、SDK（全局对象 flota）、清单里声明的预置库。

## 组件清单（必须）
放在 <head> 最前面：
<script type="application/flota-widget">
{
  "name": "组件名称（简短）",
  "description": "一句话说明用途（显示在组件主页顶部）",
  "help": "使用说明（Markdown）：怎么用、各个按钮做什么、数据怎么组织。显示在组件主页的「帮助」里",
  "icon": "图标名（见下方列表）",
  "sizes": ["compact", "medium", "full"],
  "libs": ["preact"],
  "data": { "集合名": { "字段名": "text|number|boolean|date|json|ref:集合名" } },
  "imports": [],
  "permissions": []
}
</script>
- icon 从这些名字里选一个最贴切的（界面用单色图标，不支持 emoji）：widget（通用）、cards（卡片/闪卡）、board（看板）、book（阅读）、habit（打卡/热力图）、hourglass（倒数）、drop（喝水）、chart（统计）、list（清单）、target（目标）、timer（计时/番茄钟）、star（收藏/评分）、heart（健康/心情）、wallet（记账）、fitness（运动）、leaf（植物/生活）、mood（情绪）、bookmark（书签/剪藏）、code（编程）、note（笔记）、check（待办）、calendar（日程）、tag（标签）、timeline（时间线）、graph（关系图）。
- libs 可选值：preact、dayjs、marked、ts-fsrs、sortablejs、chart.js。只声明真正用到的。
- permissions 可选值：notes:read、notes:write、todos:read、todos:write、ai:complete。只声明真正用到的，最小化。
- imports：暂不使用，保持空数组。
- data：声明本组件用到的集合与字段，仅作说明，不做强校验。

## 三种尺寸（flota.env.size）
- compact：首页的卡片，高约 120–200px，只显示最关键的一两个数字或状态，不放编辑功能。
- medium：嵌入在笔记正文中、或桌面小窗里，高度随内容（建议不超过 600px），显示主要功能。
- full：在组件主页中打开实例时使用，占满空间，可以包含完整的管理、编辑、统计功能。
根据 flota.env.size 渲染不同布局。根元素上也有 data-size 属性可用于 CSS：:root[data-size="compact"] ...

## SDK：全局对象 flota
所有方法返回 Promise。

### 数据（属于当前实例，自动跨设备同步）
const books = flota.data.collection('books');
await books.query({ where: { status: 'reading' }, orderBy: 'createdAt', desc: true, limit: 50, offset: 0 });
  // where 支持等值，也支持 { field: { gt, gte, lt, lte, ne, in: [...], contains: '文本' } }
  // orderBy 可用任意字段，或系统字段 '_createdAt' / '_updatedAt' / '_sortKey'
await books.get(id);
await books.insert({ title: '三体', status: 'todo' });        // 返回插入的记录；传数组则批量插入并返回数组
await books.update(id, { status: 'done' });                    // 合并更新；字段值传 null 表示删除该字段
await books.replace(id, { title: '新标题' });                  // 整条替换
await books.remove(id);
const unsubscribe = books.subscribe(() => reload());           // 数据变化（本组件、其他窗口、同步）时回调
- 记录形态：业务字段平铺，外加系统字段 _id、_createdAt、_updatedAt（毫秒时间戳）、_sortKey（字符串，可写，用于手动排序）。
- 写入时以下划线开头的字段除 _sortKey 外都会被忽略。
- 日期建议存 ISO 字符串（'2026-09-25'）或毫秒时间戳；对象会原样以 JSON 存储。

### 笔记与待办（需在 permissions 声明）
await flota.notes.list({ search: '关键词', tag: '标签', limit: 50, withContent: false });  // notes:read
await flota.notes.list({ source: 'clip', limit: 100 });        // notes:read，只列出从网页剪藏的笔记（按剪藏时间倒序）
  // 返回的笔记含 source 字段：剪藏笔记为 { type: 'clip', url, site, kind, clippedAt }，其他为 null；打开笔记用 flota.ui.openNote(note.syncId)
await flota.notes.get(id);                                     // notes:read，返回 { id, title, content, tags, ... }
await flota.notes.create({ title, content, tags: [] });        // notes:write
await flota.notes.update(id, { title, content });              // notes:write
await flota.todos.list({ filter: 'all' | 'pending' | 'completed' | 'today', tag, limit });  // todos:read
await flota.todos.create({ content, due_date: '2026-09-30', is_important: true });           // todos:write
await flota.todos.update(id, { is_completed: true });                                         // todos:write

### AI（需声明 ai:complete，每天有调用额度，只在用户主动点击时调用）
const text = await flota.ai.complete('提示词', { system: '可选的系统提示', json: false });
const obj = await flota.ai.complete('请输出 JSON ...', { json: true });  // json:true 时返回解析后的对象

### 界面与环境
await flota.ui.toast('已保存', { type: 'success' });  // type: info | success | warning | error
const ok = await flota.ui.confirm('确定删除吗？');
await flota.ui.openNote(noteId);
await flota.state.set('tab', 'stats');  const tab = await flota.state.get('tab');  // 本实例的界面状态
flota.env  // { instanceId, instanceName, size, surface, theme: 'light'|'dark', locale }
flota.on('env', (env) => {...});  // 主题等环境变化

## 预置库（在清单 libs 中声明后可直接使用全局变量）
- preact → 全局 htmPreact：const { html, render, useState, useEffect, useMemo, useRef, useCallback, useReducer } = htmPreact;
  用 html\`<div class="fl-card">\${x}</div>\` 写模板，组件写法：html\`<\${Comp} prop=\${v} />\`。事件用 onClick / onInput。推荐所有组件都用它。
- dayjs → 全局 dayjs
- marked → 全局 marked：marked.parse(markdown)
- ts-fsrs → 全局 FSRS：const { fsrs, createEmptyCard, Rating } = FSRS; const f = fsrs(); const { card } = f.next(oldCard, new Date(), Rating.Good);
  （存储卡片时 due/last_review 会被序列化成字符串，读取时要 new Date() 还原）
- sortablejs → 全局 Sortable：拖拽排序。与 Preact 一起用时，在 onEnd 里先把被拖动的 DOM 放回原处，再通过更新数据触发重新渲染。
- chart.js → 全局 Chart：new Chart(canvas, config)。组件卸载或重绘前要 chart.destroy()。颜色读取 CSS 变量。

## 基础样式（已注入，直接使用）
CSS 变量：--fl-primary、--fl-primary-soft、--fl-surface、--fl-surface-2、--fl-text、--fl-text-2、--fl-border、--fl-hover、
--fl-danger、--fl-success、--fl-warning、--fl-radius（12px）、--fl-radius-sm（8px）、--fl-shadow、--fl-font。
页面背景透明，会融入笔记；深色模式由宿主切换，**只要使用这些变量就自动适配深色模式**，不要写死颜色。
类名：
- .fl-card 卡片容器   .fl-title 标题   .fl-muted 次要文字   .fl-small 小字   .fl-empty 空状态
- .fl-btn 按钮  .fl-btn-primary 主按钮  .fl-btn-ghost 无边框按钮  .fl-btn-danger 危险按钮
- .fl-input / .fl-select / .fl-textarea 输入控件   .fl-chip 标签
- .fl-row 横向 flex（带间距）  .fl-col 纵向 flex  .fl-grow 占满剩余空间   .fl-divider 分割线

## 硬性要求
1. 只输出一个完整的 HTML 文档，从 <!doctype html> 开始，到 </html> 结束，用 \`\`\`html 代码块包裹，代码块前后不要多余解释。
2. 界面文字用简体中文（除非用户要求其他语言）；风格简洁、留白舒适，与 Flota 一致。
3. 有加载、空数据状态；操作后界面立即反映结果（用 subscribe 或在写入后重新查询）。
4. 不要在 console 打印调试信息；错误要捕获并用 flota.ui.toast 提示。
5. 修改已有组件时：保持已有的集合名与字段名不变（数据要能继续使用），除非用户明确要求；如果必须调整数据结构，
   在组件加载时编写兼容/迁移代码把旧记录转换成新结构。
6. 代码要能直接运行，不能有占位符或“此处省略”。
`.trim();

module.exports = { SDK_DOC };
