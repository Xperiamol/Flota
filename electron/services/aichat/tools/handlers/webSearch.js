/**
 * 联网搜索 handler。
 */

const web_search = async (args, runtime, { webSearchService }) => {
  if (!webSearchService) return JSON.stringify({ error: '联网搜索服务不可用' });
  const query = String(args.query || '').trim();
  if (!query) return JSON.stringify({ error: '缺少搜索关键词 query' });
  const res = await webSearchService.search(query, {
    count: args.count,
    abortSignal: runtime.abortSignal
  });
  if (!res.success) return JSON.stringify({ error: res.error });
  return JSON.stringify({ query, result_count: res.results.length, results: res.results });
};

module.exports = { web_search };
