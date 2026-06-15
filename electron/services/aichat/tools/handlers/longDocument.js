/**
 * write_long_document：调用长文档管线，逐章流式产出 + 落盘成笔记。
 */

const WebSearchService = require('../../../websearch');
const { resolveDocType } = require('../../../longtask/docBlueprints');
const { compactSearchQuery } = require('../../utils');

const RESEARCH_TYPES = new Set([
  'analysis_report', 'proposal', 'postmortem', 'execution_plan', 'architecture_design'
]);

const write_long_document = async (args, runtime, services) => {
  const { onChunk, abortSignal } = runtime;
  const { webSearchService, longDocPipeline, noteDAO, logger } = services;

  const emitStep = (chunk) => { if (onChunk) onChunk(chunk); };
  const topic = String(args.topic || '').trim();
  if (!topic) return JSON.stringify({ error: '缺少写作主题 topic' });

  const ROOT = 'ld_root';
  const PLAN = 'ld_plan';
  const sectionStepId = (idx) => `ld_sec_${idx}`;
  emitStep({ type: 'step_start', stepId: ROOT, parentId: 0, stepType: 'root', title: '长文档生成' });

  let planningOpened = false;
  const openedSections = new Set();

  // 研究型文档（报告/方案/复盘等）在规划前先联网检索，把结果并入参考资料
  let extraContext = args.extra_context;
  try {
    const resolvedType = resolveDocType({ docTypeHint: args.doc_type, topic });
    if (webSearchService && RESEARCH_TYPES.has(resolvedType) && await webSearchService.isEnabled()) {
      const RESEARCH = 'ld_research';
      emitStep({ type: 'step_start', stepId: RESEARCH, parentId: ROOT, stepType: 'research', title: '联网检索资料' });
      const searchQuery = compactSearchQuery(topic);
      const res = await webSearchService.search(searchQuery, { abortSignal });
      if (res.success && res.results.length > 0) {
        const block = WebSearchService.formatResults(res.results);
        extraContext = extraContext ? `${extraContext}\n\n【联网检索资料】\n${block}` : `【联网检索资料】\n${block}`;
        emitStep({ type: 'step_end', stepId: RESEARCH, status: 'done', title: `联网检索完成（${res.results.length} 条）` });
      } else {
        emitStep({ type: 'step_end', stepId: RESEARCH, status: 'done', title: '联网检索无结果，跳过' });
      }
    }
  } catch (e) {
    if (e && e.aborted) throw e;
  }

  try {
    const result = await longDocPipeline.run(
      { topic, docType: args.doc_type, targetWords: args.target_words, extraContext },
      {
        abortSignal,
        onProgress: (evt) => {
          if (!evt) return;
          switch (evt.phase) {
            case 'planning':
              planningOpened = true;
              emitStep({ type: 'step_start', stepId: PLAN, parentId: ROOT, stepType: 'planning', title: '规划大纲' });
              break;
            case 'planned':
              if (!planningOpened) emitStep({ type: 'step_start', stepId: PLAN, parentId: ROOT, stepType: 'planning', title: '规划大纲' });
              emitStep({ type: 'step_end', stepId: PLAN, status: 'done', title: evt.message });
              emitStep({ type: 'step_update', stepId: ROOT, meta: { total: evt.totalSections } });
              break;
            case 'writing': {
              const sid = sectionStepId(evt.sectionIndex);
              openedSections.add(evt.sectionIndex);
              emitStep({
                type: 'step_start',
                stepId: sid,
                parentId: ROOT,
                stepType: 'section',
                title: `第${evt.sectionIndex + 1}章 · ${evt.sectionTitle}`,
                meta: { sectionIndex: evt.sectionIndex, total: evt.totalSections }
              });
              break;
            }
            case 'section_progress':
              emitStep({
                type: 'step_update',
                stepId: sectionStepId(evt.sectionIndex),
                meta: { words: evt.words, targetWords: evt.targetWords }
              });
              break;
            case 'section_done':
              emitStep({ type: 'step_end', stepId: sectionStepId(evt.sectionIndex), status: 'done' });
              break;
            case 'section_failed':
              emitStep({ type: 'step_end', stepId: sectionStepId(evt.sectionIndex), status: 'failed', title: evt.message });
              break;
            case 'merging':
              emitStep({ type: 'step_start', stepId: 'ld_merge', parentId: ROOT, stepType: 'merging', title: '归并成稿' });
              emitStep({ type: 'step_end', stepId: 'ld_merge', status: 'done' });
              break;
            default:
              break;
          }
        },
        onToken: (delta, meta) => {
          const idx = meta && typeof meta.sectionIndex === 'number' ? meta.sectionIndex : null;
          if (idx === null) return;
          if (!openedSections.has(idx)) return;
          emitStep({ type: 'step_token', stepId: sectionStepId(idx), token: delta });
        }
      }
    );

    let noteId = null;
    let noteTitle = result.title;
    try {
      const note = noteDAO.create({
        title: result.title,
        content: result.markdown,
        tags: '',
        category: ''
      });
      noteId = note.id;
      noteTitle = note.title;
    } catch (e) {
      logger.error('AIChatService', 'write_long_document save note failed', e);
    }

    emitStep({ type: 'step_end', stepId: ROOT, status: 'done', meta: { noteId, noteTitle, total: result.sections.length } });

    return JSON.stringify({
      success: true,
      delivered: true,
      title: result.title,
      section_count: result.sections.length,
      note_id: noteId,
      note: '长文档已生成并完整展示给用户，并已保存为笔记，无需再次输出全文。请仅用一两句话简要收尾或询问是否需要调整。'
    });
  } catch (error) {
    if (error && error.aborted) {
      emitStep({ type: 'step_end', stepId: ROOT, status: 'failed', title: '已取消生成' });
      return JSON.stringify({ cancelled: true, error: '长文档生成已取消' });
    }
    emitStep({ type: 'step_end', stepId: ROOT, status: 'failed', title: `生成失败: ${error.message}` });
    logger.error('AIChatService', 'write_long_document failed', error);
    return JSON.stringify({ error: `长文档生成失败: ${error.message}` });
  }
};

module.exports = { write_long_document };
