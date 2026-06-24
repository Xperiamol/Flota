/**
 * 系统提示词 + 自动上下文注入。
 */

const { buildCurrentNoteSummary } = require('./noteSummary');
const {
  PROFILE_INJECT_LIMIT,
  PROFILE_INJECT_CHARS,
  CURRENT_NOTE_INLINE_CHARS,
  CURRENT_NOTE_MAX_CHARS
} = require('./constants');

const getSystemPrompt = async ({ mem0Service }) => {
  const now = new Date();
  const dateStr = now.toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  });
  const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  let profileSection = '';
  try {
    if (mem0Service?.isAvailable() && typeof mem0Service.getProfileMemories === 'function') {
      const profiles = await mem0Service.getProfileMemories('current_user');
      if (profiles && profiles.length > 0) {
        const items = profiles
          .slice(0, PROFILE_INJECT_LIMIT)
          .map((p) => {
            const content = String(p.content || '');
            return `- ${content.length > PROFILE_INJECT_CHARS ? `${content.slice(0, PROFILE_INJECT_CHARS)}…` : content}`;
          })
          .join('\n');
        profileSection = `\n\n## 关于用户（来自记忆）\n${items}\n（更多用户记忆可用 search_memory 按需检索）`;
      }
    }
  } catch (_) {
    // Profile 加载失败不影响基础功能
  }

  return `你是 FlotaAI，FlashNote 智能笔记应用的内置 AI 助手。

当前时间：${dateStr} ${timeStr}

## 能力
- 搜索、阅读、创建和编辑笔记
- 创建和修改白板/画布，并生成图形内容
- 查询和创建待办事项
- 查看、搜索、添加和更新记忆库条目
- 写作辅助、翻译、问答等通用任务

## 长笔记上下文策略
- 系统会自动注入「当前笔记」上下文。短笔记直接给全文；长笔记只给元信息、目录大纲、首尾预览，中段被省略。
- 当看到「⚠️ 内容已省略中段」或 total_lines 很大时：先调用 search_in_current_note(query) 用关键词定位，或用 read_current_note(start_line, line_count) 按目录大纲指向的行号读取需要的段落。
- 不要在长笔记上凭首尾预览臆测中段内容；不确定时主动读取。
- 笔记里的本地图片不会自动给你"看"。当 get_current_note / 当前笔记上下文里 images 非空、且这些图片对回答问题有帮助（识图、描述配图、看图答题、需要图里的信息辅助理解笔记主题等）时，直接调用 read_note_image(path) 取图，**不要询问用户是否允许**——工具调用本身就是被授权的；下一轮即可看到该图。多张图按需分次调，不要一次取多张。仅当问题与图无关（纯文本问答）时才不取图。

## 记忆档案管理
- 【注入即少量】「关于用户」与「相关长期记忆」只注入了少量高相关条目；不够时主动调用 search_memory，不要凭注入片段臆测。
- 【高价值才保存】只有当信息长期有效、可复用、对未来回答有明显帮助时，才调用 add_memory；临时任务、一次性上下文、当前笔记里已经明确存在的信息不要重复保存。
- 【先查再写】保存或更新记忆前优先用 search_memory 检查是否已有相似记忆；相似时优先 update_memory，避免重复和冲突。
- 【多维归类】合理分配 category：如 profile(身份)、preference(偏好要求)、fact(事实结论)、habit(排版风格等习惯)。
- 【动态刷新】当用户明确更新偏好、身份、工作流或稳定事实时，调用 update_memory 修正旧记忆；不确定时先询问用户。

## 任务规划
- 当用户提出"帮我规划/拆解/安排"这类模糊大目标（如"周末去武汉玩"、"准备下周述职"、"学习 React"）时，按以下流程：
  1. 先 search_memory(query) 检索相关知识/偏好（query 用任务核心词）；
  2. 再 search_todos 看未来一周已有事项，避免时间冲突；
  3. 最后用 create_todos 一次性提交 5-12 条**具体可执行**的任务（含 due_date YYYY-MM-DDTHH:MM:SS）。
- 不要生成"确定 X / 调研 Y / 规划 Z"这种空泛准备任务，要给实际地点/活动/步骤；旅行类必须给出具体景点名，学习类要给具体内容。
- 时间在 08:00-23:59 之间，所有 due_date 不能早于当前时间。

## 规则
- 用简洁友好的中文回复
- 需要查询用户数据时主动调用工具，不要猜测
- 当用户明确要求产出长报告、方案、PRD、研究文档、教程、多章节内容，或预期输出明显超过一次普通回答承载量时，优先调用 write_long_document；不要反复调用搜索类工具而迟迟不开始产出
- 创建、编辑笔记/待办/记忆这类写入操作只有在用户明确要求“保存/新建/创建/写入/修改/记住”时才可以考虑；没有明确保存或写入指令时，一律只在对话中返回结果，不要调用写入类工具
- 写入操作默认只生成待确认计划；拿到工具返回的 requiresConfirmation 后，必须清楚告诉用户等待确认，不要声称已经执行
- 写作类请求默认成稿优先；只有用户明确要求“方案/计划/排期/执行/策划/提纲/大纲”时才输出对应形态
- 对“生成科技日报”这类交付物不清晰的短句，应先追问用户要“成稿、提纲，还是策划/执行方案”，不要直接生成
- 当前笔记类型为 whiteboard 时，不要调用 edit_note 修改 content；需要修改画布时调用 update_whiteboard
- 当用户明确要求“在新画布/白板里画一个思维导图/流程图/架构图/时序图/鱼骨图/甘特图/四象限图/饼图”等，请优先调用 create_whiteboard
- 用户明确说"画一张/生成一张/做一张/把上面整理成图/在画布上画"等动作意图时，调用 create_whiteboard；如果只是讨论"什么是流程图""图灵奖"等概念问题，**不要**调用画布工具
- 当用户要求"修改当前画布/补充当前白板/重画现有图形/替换已有画布内容"等，请优先调用 update_whiteboard
- 不要用 create_note 创建 whiteboard，也不要把 Mermaid/Markdown 文本当成画布结果保存到普通笔记里
- 用户要求生成图表/白板但 未指定类型 时，默认使用 diagram_type: "auto" ， 不要追问图类型 。
- 使用 Markdown 格式回复，善用列表和标题
- 不确定时如实说明，不编造数据
- 回复要简明扼要，避免冗余${profileSection}`;
};

const buildContextSection = (contextPackage = {}) => {
  const sections = [];
  const truncate = (text, max = 1800) => {
    const value = String(text || '').trim();
    return value.length > max ? `${value.slice(0, max)}…` : value;
  };

  if (contextPackage.currentNote) {
    const note = contextPackage.currentNote;
    const noteType = note.note_type || 'markdown';
    const meta = [
      '### 当前笔记',
      `ID: ${note.id || '未知'}`,
      `标题: ${note.title || '未命名'}`,
      `类型: ${noteType}`,
      note.timeLabel ? `时间: ${note.timeLabel}` : '',
      note.stalenessLabel ? `时效性: ${note.stalenessLabel}` : '',
      note.updated_at ? `最近修改: ${note.updated_at}` : '',
      note.tags ? `标签: ${note.tags}` : ''
    ].filter(Boolean);

    const rawContent = String(note.content || '');
    if (noteType === 'whiteboard' || rawContent.length <= CURRENT_NOTE_INLINE_CHARS) {
      meta.push(`内容:\n${truncate(rawContent, CURRENT_NOTE_MAX_CHARS)}`);
    } else {
      const summary = buildCurrentNoteSummary({ ...note, content: rawContent }, { headLines: 80, tailLines: 40 });
      meta.push(
        `规模: ${summary.total_lines} 行 / 约 ${summary.total_chars} 字符`,
        summary.outline.length ? `目录大纲:\n${summary.outline.map((o) => `  L${o.line}  ${'#'.repeat(o.level)} ${o.text}`).join('\n')}` : '',
        `开头预览（前 ${summary.preview_head_lines} 行）:\n${summary.preview_head}`,
        `结尾预览（后 ${summary.preview_tail_lines} 行）:\n${summary.preview_tail}`,
        '⚠️ 内容已省略中段。如需查看具体段落，调用 read_current_note(start_line, line_count) 或 search_in_current_note(query)。'
      );
    }

    sections.push(meta.filter(Boolean).join('\n'));
  }

  if (Array.isArray(contextPackage.relatedNotes) && contextPackage.relatedNotes.length > 0) {
    sections.push([
      '### 相关笔记候选',
      ...contextPackage.relatedNotes.slice(0, 6).map((note, index) =>
        `${index + 1}. [#${note.id}] ${note.title || '未命名'}（${note.timeLabel || '时间未知'}${note.stalenessLabel ? `，${note.stalenessLabel}` : ''}）：${truncate(note.excerpt || note.content, 360)}`
      )
    ].join('\n'));
  }

  if (Array.isArray(contextPackage.todayTodos) && contextPackage.todayTodos.length > 0) {
    sections.push([
      '### 今日/近期待办',
      ...contextPackage.todayTodos.slice(0, 8).map((todo, index) =>
        `${index + 1}. [#${todo.id}] ${todo.content}${todo.due_date ? `（截止: ${todo.due_date}，${todo.timeLabel || (todo.isOverdue ? '已过期' : '有截止日期')}）` : ''}`
      )
    ].join('\n'));
  }

  if (Array.isArray(contextPackage.memories) && contextPackage.memories.length > 0) {
    sections.push([
      '### 相关长期记忆',
      ...contextPackage.memories.slice(0, 8).map((memory, index) =>
        `${index + 1}. ${memory.memory_layer ? `[${memory.memory_layer}] ` : ''}${truncate(memory.content, 260)}${memory.stalenessLabel ? `（${memory.stalenessLabel}）` : ''}${memory.score != null ? ` · 相关度 ${Math.round(memory.score * 100)}%` : ''}`
      )
    ].join('\n'));
  }

  if (contextPackage.taskInstruction) {
    sections.push(String(contextPackage.taskInstruction));
  }

  if (sections.length === 0) return '';

  return `\n\n## 本次对话自动上下文\n以下内容由应用按用户选择注入。回答时优先引用这些上下文；如果使用了相关笔记或长期记忆，请说明来源标题、ID 或"长期记忆"。注意时间感知：最近修改的信息优先级更高，旧信息要标注可能过时，过期待办不能当作未来计划。长期记忆代表稳定偏好/事实，但遇到用户当前明确说法时，以当前上下文为准。\n\n${sections.join('\n\n')}`;
};

module.exports = { getSystemPrompt, buildContextSection };
