/**
 * 发起一次模型流式请求：pi-ai 的 OpenAI Chat Completions 实现 + 空闲超时。
 *
 * openai SDK 的 timeout 只管到服务器开始响应为止，正文流到一半卡住会一直等下去。
 * 这里按「多久没有收到任何数据」判定超时：每收到一个事件重新计时，长回答只要还在输出就不会被误判。
 * 超时与用户停止分开处理：超时 → 最终消息 stopReason 'error' 并说明原因；用户停止 → 'aborted'。
 */
const { loadPi } = require('./piRuntime');

const DEFAULT_IDLE_TIMEOUT_MS = 120000;

const timeoutMessage = (ms) => `AI 请求超时（${Math.round(ms / 1000)} 秒没有收到数据），请检查网络或 AI 服务状态`;

/**
 * @param {object} model     buildModel() 的结果
 * @param {object} context   pi TranscriptContext
 * @param {object} options   buildRequestOptions() 的结果；timeoutMs 作为空闲超时
 * @returns {Promise<AssistantMessageEventStream>}
 */
const openStream = async (model, context, options = {}) => {
  const { streamOpenAI, createAssistantMessageEventStream } = await loadPi();
  const idleMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_IDLE_TIMEOUT_MS;
  const controller = new AbortController();
  const userSignal = options.signal;
  let timedOut = false;
  let timer = null;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, idleMs);
  };
  const onUserAbort = () => controller.abort();
  if (userSignal?.aborted) controller.abort();
  else userSignal?.addEventListener('abort', onUserAbort, { once: true });
  arm();

  const inner = streamOpenAI(model, context, { ...options, signal: controller.signal, timeoutMs: idleMs });
  const out = createAssistantMessageEventStream();
  (async () => {
    try {
      for await (const event of inner) {
        arm();
        // 被空闲超时中止时，pi-ai 报的是「已中止」；改成带原因的错误，别和用户停止混在一起
        if (event.type === 'error' && timedOut) {
          out.push({ ...event, reason: 'error', error: { ...event.error, stopReason: 'error', errorMessage: timeoutMessage(idleMs) } });
        } else {
          out.push(event);
        }
      }
      out.end();
    } catch (error) {
      out.end();
      throw error;
    } finally {
      clearTimeout(timer);
      userSignal?.removeEventListener('abort', onUserAbort);
    }
  })().catch(() => {});
  return out;
};

module.exports = { openStream, DEFAULT_IDLE_TIMEOUT_MS };
