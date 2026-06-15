/**
 * 联网搜索服务商端点表。
 * 当前仅内置官方端点；自定义端点由用户在设置中填写。
 */
const PROVIDER_ENDPOINTS = {
  feedcoop: 'https://open.feedcoopapi.com/search_api/web_search'
};

const DEFAULT_PROVIDER = 'feedcoop';

module.exports = { PROVIDER_ENDPOINTS, DEFAULT_PROVIDER };
