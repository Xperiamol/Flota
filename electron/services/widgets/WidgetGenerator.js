const { SDK_DOC } = require('./sdkDoc');
const { parseManifest } = require('./manifest');

const MAX_EXISTING_WIDGETS = 20;
const MAX_ERROR_CHARS = 4000;

/** 从模型输出中取出完整 HTML：优先 ```html 代码块，其次裸露的 <!doctype ... </html> */
const extractHtml = (text) => {
  const source = String(text || '');
  const fenced = /```(?:html)?\s*\n([\s\S]*?)```/i.exec(source);
  const candidate = fenced ? fenced[1] : source;
  const start = candidate.search(/<!doctype html|<html[\s>]/i);
  if (start < 0) return null;
  const end = candidate.toLowerCase().lastIndexOf('</html>');
  if (end < 0) return null;
  return candidate.slice(start, end + '</html>'.length).trim();
};

const formatErrors = (errors = []) => errors
  .slice(0, 8)
  .map((error, index) => `${index + 1}. ${error.message}${error.stack ? `\n${String(error.stack).split('\n').slice(0, 4).join('\n')}` : ''}`)
  .join('\n')
  .slice(0, MAX_ERROR_CHARS);

/**
 * 组件生成器：根据自然语言需求生成或修改组件代码（单文件 HTML）。
 * 预跑与自修复循环由渲染层驱动（需要在沙箱里真实运行），这里只负责一次“生成/修改”调用。
 */
class WidgetGenerator {
  /**
   * @param {object} deps
   * @param {() => any} deps.getChatService 返回 AIChatService（流式生成，可能尚未初始化）
   * @param {any} deps.aiService 兜底的非流式调用
   * @param {import('./WidgetService')} deps.widgetService
   */
  constructor({ getChatService, aiService, widgetService }) {
    this.getChatService = getChatService;
    this.aiService = aiService;
    this.widgetService = widgetService;
    this.running = new Map();
  }

  describeExistingWidgets(excludeId) {
    const widgets = this.widgetService.listWidgets()
      .filter((widget) => widget.id !== excludeId)
      .slice(0, MAX_EXISTING_WIDGETS);
    if (!widgets.length) return '（用户还没有其他组件）';
    return widgets.map((widget) => `- ${widget.name}：${widget.manifest.description || '无描述'}（${widget.instanceCount} 个实例）`).join('\n');
  }

  buildExamples() {
    return this.widgetService.listExamples()
      .map((example) => `### 示例：${example.name}\n\`\`\`html\n${example.code}\n\`\`\``)
      .join('\n\n');
  }

  buildSystemPrompt({ widgetId }) {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return [
      '你是 Flota 的组件工程师，根据用户的需求编写可以直接运行的组件（单文件 HTML 小应用）。',
      '用户的需求千差万别，请准确理解意图，做出真正好用、细节完整的组件，而不是简单的演示。',
      `今天是 ${date}。`,
      '',
      SDK_DOC,
      '',
      '## 用户已有的其他组件（避免做出重复的组件）',
      this.describeExistingWidgets(widgetId),
      '',
      '## 参考示例（展示了推荐的写法，不要照搬功能）',
      this.buildExamples(),
    ].join('\n');
  }

  buildDataSummary(instanceId) {
    if (!instanceId) return '';
    const collections = this.widgetService.dao.listCollections(instanceId);
    if (!collections.length) return '当前实例还没有数据。';
    return collections.map((item) => {
      const samples = this.widgetService.dao.listRecords(instanceId, item.collection).slice(0, 3)
        .map((record) => JSON.stringify(record).slice(0, 400));
      return `- 集合 ${item.collection}：${item.count} 条，示例：\n  ${samples.join('\n  ')}`;
    }).join('\n');
  }

  /**
   * @param {object} params
   * @param {string} params.instruction 用户需求或修改要求
   * @param {string} [params.baseCode] 在此代码基础上修改
   * @param {string} [params.widgetId] 被修改的组件
   * @param {string} [params.instanceId] 提供数据概况的实例（修改时数据必须保持兼容）
   * @param {Array<{message: string, stack?: string}>} [params.errors] 预跑中捕获的错误，要求修复
   * @param {Array<{role: string, content: string}>} [params.history] 本次工作台里之前的需求（不含代码）
   * @param {string} params.requestId
   * @param {(progress: { chars: number }) => void} [params.onProgress]
   */
  async generate({ instruction, baseCode, widgetId, instanceId, errors, history = [], requestId, onProgress }) {
    const messages = [{ role: 'system', content: this.buildSystemPrompt({ widgetId }) }];
    for (const item of history.slice(-6)) {
      if (item && typeof item.content === 'string' && (item.role === 'user' || item.role === 'assistant')) {
        messages.push({ role: item.role, content: item.content.slice(0, 2000) });
      }
    }

    const parts = [];
    if (baseCode) {
      parts.push('这是组件当前的完整代码：', '```html', baseCode, '```');
      const dataSummary = this.buildDataSummary(instanceId);
      if (dataSummary) parts.push('', '组件现有数据概况（修改时必须兼容这些数据）：', dataSummary);
    }
    if (errors?.length) {
      parts.push('', '这段代码在运行时出现了下面的问题，请找出原因并修复：', formatErrors(errors));
    }
    if (instruction) parts.push('', baseCode ? `修改要求：${instruction}` : `需求：${instruction}`);
    parts.push('', '请输出修改后的完整 HTML（```html 代码块）。');
    messages.push({ role: 'user', content: parts.join('\n') });

    const controller = new AbortController();
    this.running.set(requestId, controller);
    try {
      const content = await this.complete(messages, { abortSignal: controller.signal, onProgress });
      const code = extractHtml(content);
      if (!code) throw Object.assign(new Error('AI 没有输出完整的 HTML 代码，请重试或换个说法'), { code: 'NO_HTML', raw: content.slice(0, 500) });
      const { found, error } = parseManifest(code);
      if (!found) throw Object.assign(new Error('生成的代码缺少组件清单'), { code: 'NO_MANIFEST' });
      if (error) throw Object.assign(new Error(error), { code: 'INVALID_MANIFEST' });
      return { code, explanation: content.replace(/```[\s\S]*?```/g, '').trim().slice(0, 500) };
    } finally {
      this.running.delete(requestId);
    }
  }

  async complete(messages, { abortSignal, onProgress }) {
    const chatService = this.getChatService?.();
    if (chatService?._generatePlainText) {
      let chars = 0;
      let lastReport = 0;
      const result = await chatService._generatePlainText(messages, {
        temperature: 0.3,
        abortSignal,
        timeoutMs: 10 * 60 * 1000,
        onToken: (token) => {
          chars += String(token || '').length;
          if (onProgress && chars - lastReport >= 200) {
            lastReport = chars;
            onProgress({ chars });
          }
        },
      });
      if (result.truncated) throw Object.assign(new Error('生成内容超出模型输出长度上限，请简化需求或在设置中调高输出上限'), { code: 'TRUNCATED' });
      return String(result.content || '');
    }
    const result = await this.aiService.chat(messages, { temperature: 0.3, bypassTokenLimit: true, timeoutMs: 300000 });
    if (!result?.success) throw new Error(result?.error || 'AI 调用失败');
    return String(result.data?.content || '');
  }

  cancel(requestId) {
    const controller = this.running.get(requestId);
    if (!controller) return false;
    controller.abort();
    this.running.delete(requestId);
    return true;
  }
}

WidgetGenerator.extractHtml = extractHtml;

module.exports = WidgetGenerator;
