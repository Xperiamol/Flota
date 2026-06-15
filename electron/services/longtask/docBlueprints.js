/**
 * 文档类型蓝图。
 *
 * 作用：
 * 1. 统一归一化用户传入的 docType；
 * 2. 在未显式指定时，基于主题关键词粗略推断文档体裁；
 * 3. 为不同体裁提供规划阶段的大纲指引。
 */

const DOC_TYPE_ORDER = [
  'novel',
  'prd',
  'analysis_report',
  'proposal',
  'postmortem',
  'execution_plan',
  'tutorial',
  'architecture_design',
  'general_document'
];

const DEFAULT_DOC_TYPE = 'general_document';

const DOC_TYPE_ALIASES = {
  小说: 'novel',
  故事: 'novel',
  novel: 'novel',
  fiction: 'novel',
  story: 'novel',

  prd: 'prd',
  需求文档: 'prd',
  产品文档: 'prd',
  产品需求: 'prd',

  研究报告: 'analysis_report',
  调研报告: 'analysis_report',
  分析报告: 'analysis_report',
  报告: 'analysis_report',
  report: 'analysis_report',
  analysis: 'analysis_report',

  方案: 'proposal',
  方案设计: 'proposal',
  proposal: 'proposal',

  复盘: 'postmortem',
  复盘报告: 'postmortem',
  postmortem: 'postmortem',

  计划: 'execution_plan',
  执行计划: 'execution_plan',
  实施计划: 'execution_plan',
  plan: 'execution_plan',

  教程: 'tutorial',
  指南: 'tutorial',
  tutorial: 'tutorial',
  guide: 'tutorial',

  技术文档: 'architecture_design',
  架构设计: 'architecture_design',
  架构: 'architecture_design',
  architecture: 'architecture_design',

  通用文档: 'general_document',
  文档: 'general_document'
};

const DOC_TYPE_KEYWORDS = {
  novel: ['小说', '故事', '剧情', '主角', '人物', '章回', '世界观', '情节', '悬疑', '恐怖', '言情', '科幻', '武侠'],
  prd: ['需求', 'prd', '功能', '用户故事', '验收', '埋点', '版本计划', '产品'],
  analysis_report: ['分析', '调研', '综述', '洞察', '现状', '原因', '数据', '趋势', '研究'],
  proposal: ['方案', '选型', '对比', '评审', '成本', '收益', '可行性', '路线'],
  postmortem: ['复盘', '事故', '问题回溯', '根因', '改进', '行动项'],
  execution_plan: ['计划', '里程碑', '排期', '交付', '执行路径', '资源'],
  tutorial: ['教程', '入门', '指南', '手把手', '步骤', '实战', '上手', '怎么做', '如何'],
  architecture_design: ['架构', '模块', '接口', '数据流', '扩展性', '性能', '系统设计']
};

const DOC_TYPE_BLUEPRINT = {
  novel: `
需要撰写的文档类型为：小说/故事。
请按叙事作品的需要设计章节结构，而不是套用说明文模板。
通常需要考虑：
- 整体设定与基调（世界观、时代/场景、风格与氛围）
- 核心人物与动机（主角、关键配角、人物关系与目标）
- 故事主线与张力推进（起承转合、悬念铺垫、冲突升级）
- 关键转折与高潮（重要事件节点、反转、情感爆点）
- 结局与收束（主线收尾、人物归宿、留白或回响）
各章应是连贯的情节推进，避免分点说明式写法；可按情节自由划分章节数量与篇幅。`.trim(),

  prd: `
需要撰写的文档类型为：产品需求文档（PRD）。
请优先根据用户需求设计合适结构，不要机械套用固定模板。这类文档通常关注：
- 做什么、为什么做（背景、目标、范围边界、成功指标）
- 面向谁、什么场景（目标用户、关键场景、主要痛点）
- 要实现什么能力、大致怎么实现（核心功能、交互流程、关键规则、权限/合规）
- 如何验证做对了（关键指标、数据/埋点思路、验收方式）
- 何时上线、有什么风险（计划、依赖、主要风险与应对）`.trim(),

  analysis_report: `
需要撰写的文档类型为：分析/调研报告。
请根据实际问题灵活设计章节，保证以下信息链条完整：
- 研究背景与问题（背景、研究范围、关键定义/口径）
- 事实与证据（数据与事实、对比基线、关键发现）
- 原因与机制（核心假设、验证思路、拆解分析）
- 结论与建议（策略选项、取舍理由、推荐结论）
- 风险与下一步（不确定性、行动建议、待补充信息）`.trim(),

  proposal: `
需要撰写的文档类型为：方案设计（Proposal）。
重点是让读者快速理解问题、方案和落地路径，常见需覆盖：
- 当前问题或机会，以及目标与约束
- 备选方案/思路及其适用场景
- 各方案在成本、收益、复杂度、风险、依赖上的差异
- 推荐方案的核心设计（关键架构、流程、数据要点）
- 如何落地（阶段计划、资源需求、验收、灰度/回滚）`.trim(),

  postmortem: `
需要撰写的文档类型为：复盘报告（Postmortem）。
围绕“发生了什么、为什么、以后怎样避免”组织，通常需让读者清楚：
- 事件时间线、影响范围与程度
- 直接原因与更深层的系统性原因、触发条件
- 处置过程、关键决策、做得好/不足之处
- 后续改进（短期修复、中长期治理、防再发机制）
- 跟进行动项（负责人、时间节点、跟踪方式）`.trim(),

  execution_plan: `
需要撰写的文档类型为：执行计划。
让相关方看懂“做什么、怎么做、何时完成、有什么风险”，通常覆盖：
- 目标、范围边界与成功衡量标准
- 工作如何拆分到阶段/任务及对应交付物
- 排期、里程碑、资源与依赖、节奏安排
- 主要风险与保障措施（预案、质量与验收、沟通机制）
- 如何跟踪进展与复盘（指标、复盘与迭代机制）`.trim(),

  tutorial: `
需要撰写的文档类型为：教程/指南。
目标是让读者循序渐进地学会某项技能或完成某个任务，通常覆盖：
- 面向的读者与前置条件（适用人群、需要的基础与环境）
- 核心概念铺垫（必要的背景知识、术语解释）
- 分步骤的操作主体（由浅入深、每步有明确目标与可验证结果）
- 常见问题与排错（易错点、调试思路、注意事项）
- 进阶与延伸（最佳实践、拓展方向、参考资源）
章节应按学习路径递进，步骤清晰、示例充分。`.trim(),

  architecture_design: `
需要撰写的文档类型为：技术架构设计。
根据具体系统与读者灵活设计结构，一般可考虑覆盖：
- 业务背景与需求（业务目标、功能/非功能需求、关键约束）
- 总体架构视图（模块划分、组件关系、核心数据流向）
- 关键设计点（接口、存储、一致性、容灾、高可用/扩展性）
- 性能与安全（性能目标、压测思路、安全、权限与合规）
- 部署与运维（发布方式、监控告警、回滚策略、演进路线）`.trim(),

  general_document: `
需要撰写的文档类型为：通用文档。
当无法可靠判定单一体裁时使用，结构应稳健、清晰、不过度假设，通常覆盖：
- 要解决的问题、适用范围与主要读者关注点
- 已知事实、关键背景、当前约束与边界
- 最重要的结论、建议、风险与待确认事项
- 若有下一步动作，明确行动建议与依赖
你可根据上下文自由决定章节顺序、颗粒度与命名。`.trim()
};

function normalizeDocTypeHint(hint) {
  const raw = String(hint || '').trim().toLowerCase();
  if (!raw) return null;
  if (DOC_TYPE_ORDER.includes(raw)) return raw;
  for (const [alias, type] of Object.entries(DOC_TYPE_ALIASES)) {
    if (raw.includes(String(alias).toLowerCase())) return type;
  }
  return null;
}

function detectFromText(text) {
  const lowered = String(text || '').toLowerCase();
  if (!lowered.trim()) return null;

  let best = null;
  let bestHits = 0;

  for (const type of DOC_TYPE_ORDER) {
    const keywords = DOC_TYPE_KEYWORDS[type] || [];
    const hits = keywords.reduce((count, keyword) => {
      return lowered.includes(String(keyword).toLowerCase()) ? count + 1 : count;
    }, 0);
    if (hits > bestHits) {
      bestHits = hits;
      best = type;
    }
  }

  return bestHits > 0 ? best : null;
}

function resolveDocType({ docTypeHint, topic } = {}) {
  return (
    normalizeDocTypeHint(docTypeHint) ||
    detectFromText(`${docTypeHint || ''} ${topic || ''}`) ||
    DEFAULT_DOC_TYPE
  );
}

function getBlueprint(docType) {
  return DOC_TYPE_BLUEPRINT[docType] || DOC_TYPE_BLUEPRINT[DEFAULT_DOC_TYPE];
}

module.exports = {
  DOC_TYPE_ORDER,
  DEFAULT_DOC_TYPE,
  resolveDocType,
  getBlueprint
};
