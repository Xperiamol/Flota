/**
 * pi-agent-core / pi-ai 是纯 ESM 包，主进程是 CommonJS：第一次用到时 import()，之后复用。
 *
 * 加载 pi-ai 的 OpenAI Chat Completions 与 Anthropic Messages 两种实现。其余模型 SDK
 * （Google、Bedrock 等）在 package.json 里换成了空包（stubs/pi-ai-unused），既不安装也不打包。
 */
let loading = null;

const loadPi = () => {
  loading ||= Promise.all([
    import('@earendil-works/pi-agent-core'),
    import('@earendil-works/pi-ai'),
    import('@earendil-works/pi-ai/api/openai-completions'),
    import('@earendil-works/pi-ai/api/anthropic-messages'),
  ]).then(([core, ai, openai, anthropic]) => ({
    Agent: core.Agent,
    normalizeContext: ai.normalizeContext,
    createAssistantMessageEventStream: ai.createAssistantMessageEventStream,
    streamOpenAI: openai.stream,
    streamAnthropic: anthropic.stream,
  }));
  return loading;
};

module.exports = { loadPi };
