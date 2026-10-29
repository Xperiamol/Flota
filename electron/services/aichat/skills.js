const fs = require('fs');
const path = require('path');
const { TOOLS } = require('./tools/schema');

const SKILLS = {
  notes: { title: '笔记', description: '搜索、按段阅读、创建、局部修改和批量整理笔记', tools: ['search_notes', 'read_note', 'get_current_note', 'read_current_note', 'read_note_image', 'search_in_current_note', 'summarize_current_note_section', 'create_note', 'edit_note', 'edit_notes'] },
  planning: { title: '待办与规划', description: '查询日程、拆解目标、创建待办；从笔记提取行动项并嵌入实时清单', tools: ['search_todos', 'get_today_todos', 'create_todo', 'create_todos'] },
  canvas: { title: '画布', description: '创建或修改流程图、思维导图等可编辑画布', tools: ['create_whiteboard', 'update_whiteboard'] },
  widgets: { title: '组件', description: '生成交互工具、修改组件、创建实例与录入数据', tools: ['list_widgets', 'get_widget', 'create_widget', 'update_widget', 'create_widget_instance', 'add_widget_records'] },
  writing: { title: '长文写作', description: '多章节小说、报告、方案、教程，分段写作并保存', tools: ['write_long_document'] },
  memory: { title: '长期记忆', description: '检索用户偏好和背景，按明确要求记住或更正信息', tools: ['search_memory', 'add_memory', 'update_memory', 'list_memories'] },
  settings: { title: '应用设置', description: '查看和调整主题、排版、显示偏好、历史快照等设置', tools: ['get_settings', 'update_settings'] },
  web: { title: '联网检索', description: '查找实时信息与来源', tools: ['web_search'] },
};
const READ_SKILL = { type: 'function', function: {
  name: 'read_skill', description: '按需读取一个技能的操作说明，并开放其工具。只选择当前任务需要的技能；已有上下文能回答的问题无需调用。',
  parameters: { type: 'object', properties: { skill: { type: 'string', enum: Object.keys(SKILLS) } }, required: ['skill'], additionalProperties: false },
} };
const getSkillDirectory = () => Object.entries(SKILLS).map(([id, skill]) => `- ${id}（${skill.title}）：${skill.description}`).join('\n');

// 每次用户请求独立持有加载状态；并发会话之间不会互相开放工具。
const createSkillSession = ({ disabledTools = [], webSearchEnabled = false, memoryEnabled = true } = {}) => {
  const disabled = new Set(disabledTools);
  if (!webSearchEnabled) disabled.add('web_search');
  if (!memoryEnabled) SKILLS.memory.tools.forEach(name => disabled.add(name));
  const loaded = new Set();
  let exposed = new Set(['read_skill']);
  const available = id => SKILLS[id].tools.filter(name => !disabled.has(name));
  return {
    getTools: () => {
      const enabled = new Set([...loaded].flatMap(available));
      const tools = [READ_SKILL, ...TOOLS.filter(tool => enabled.has(tool.function.name))];
      exposed = new Set(tools.map(tool => tool.function.name));
      return tools;
    },
    canExecute: name => exposed.has(name) && !disabled.has(name),
    read: id => {
      if (!Object.hasOwn(SKILLS, id)) return { success: false, error: '未知技能，请从能力目录选择' };
      const tools = available(id);
      if (!tools.length) return { success: false, error: '此技能当前未启用，请告知用户需要先配置对应功能' };
      loaded.add(id);
      return { success: true, skill: id, title: SKILLS[id].title, instructions: fs.readFileSync(path.join(__dirname, 'skills', id, 'SKILL.md'), 'utf8'), tools, note: '这些工具已开放，可在下一轮调用。其他技能仍需按需加载。' };
    },
  };
};
module.exports = { SKILLS, createSkillSession, getSkillDirectory };
