/**
 * pi-agent-core / pi-ai 是纯 ESM 包，主进程是 CommonJS：第一次用到时 import()，之后复用。
 *
 * 只加载 pi-ai 的 OpenAI Chat Completions 实现。其余模型 SDK 在 package.json 里换成了空包
 * （stubs/pi-ai-unused），既不安装也不打包。
 */
let loading = null;

const loadPi = () => {
  loading ||= Promise.all([
    import('@earendil-works/pi-agent-core'),
    import('@earendil-works/pi-ai'),
    import('@earendil-works/pi-ai/api/openai-completions'),
  ]).then(([core, ai, openai]) => ({
    Agent: core.Agent,
    normalizeContext: ai.normalizeContext,
    createAssistantMessageEventStream: ai.createAssistantMessageEventStream,
    streamOpenAI: openai.stream,
  }));
  return loading;
};

module.exports = { loadPi };
