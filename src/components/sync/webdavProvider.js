// WebDAV 同步的服务商识别：坚果云是默认服务，其余（自建、NAS、其他网盘）统称 WebDAV。
// 只用于界面文案和帮助链接，后端节流在 electron/services/sync/webdavClient.js 里单独判断。

export const NUTSTORE_BASE_URL = 'https://dav.jianguoyun.com/dav';

export const isNutstoreUrl = (url) => {
  try {
    return /(^|\.)jianguoyun\.com$/.test(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
};

export const getWebdavProviderName = (url) => (isNutstoreUrl(url) ? '坚果云' : 'WebDAV');

// 账户卡片上显示的服务器：坚果云显示名称，其他显示主机名
export const getWebdavServerLabel = (url) => {
  if (isNutstoreUrl(url)) return '坚果云';
  try {
    return new URL(url).host;
  } catch {
    return url || '';
  }
};
