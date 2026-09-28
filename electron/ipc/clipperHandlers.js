const { ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// 浏览器扩展目录：开发环境在仓库内，打包后随 extraResources 放在 resources/extensions
const getExtensionDir = () => {
  const candidates = [
    path.join(process.resourcesPath || '', 'extensions', 'chrome-clipper'),
    path.join(__dirname, '..', '..', 'extensions', 'chrome-clipper'),
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'manifest.json'))) || candidates[candidates.length - 1];
};

// 剪藏按「标签」归类（「分类」已废弃）：默认给剪藏笔记打上这些标签，逗号分隔
const SETTING_KEYS = {
  defaultTags: { key: 'clipper_default_tags', type: 'string', fallback: '剪藏' },
  aiSummary: { key: 'clipper_ai_summary', type: 'boolean', fallback: false },
  aiTags: { key: 'clipper_ai_tags', type: 'boolean', fallback: true },
  createTodo: { key: 'clipper_create_todo', type: 'boolean', fallback: false },
};

const parseTagList = (value) => (Array.isArray(value) ? value : String(value ?? '').split(/[,，]/))
  .map((tag) => String(tag).trim())
  .filter(Boolean)
  .slice(0, 10);

/** 读取剪藏偏好（设置表中缺失时用默认值） */
const readClipperSettings = (dao) => {
  const result = {};
  for (const [name, def] of Object.entries(SETTING_KEYS)) {
    const row = dao?.get(def.key);
    result[name] = row ? row.value : def.fallback;
  }
  // 旧版本的「默认分类」：还没设置过默认标签时，把它当作默认标签沿用
  if (!dao?.get(SETTING_KEYS.defaultTags.key)) {
    const legacy = dao?.get('clipper_default_category')?.value;
    if (legacy && legacy !== 'default' && legacy !== '剪藏') result.defaultTags = `剪藏,${legacy}`;
  }
  result.defaultTags = parseTagList(result.defaultTags);
  return result;
};

const ok = (data) => ({ success: true, data });
const fail = (error) => ({ success: false, error: error?.message || String(error), code: error?.code || 'ERROR' });

/**
 * 剪藏相关 IPC：本地接收通道状态、配对、应用内剪藏链接、剪藏偏好。
 * @param {object} deps
 * @param {() => import('../services/clipper/IngressService')} deps.getIngress
 * @param {() => import('../services/clipper/ClipService')} deps.getClipService
 * @param {() => any} deps.getPluginManager
 * @param {() => any} deps.getSettingDAO
 */
const registerClipperHandlers = ({ getIngress, getClipService, getPluginManager, getSettingDAO }) => {
  const handle = (channel, fn) => ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return ok(await fn(...args));
    } catch (error) {
      if (!error?.code) console.error(`[Clipper] ${channel} 失败:`, error);
      return fail(error);
    }
  });

  const readSettings = () => readClipperSettings(getSettingDAO());

  const isPluginEnabled = () => {
    const state = getPluginManager()?.getPluginStateSnapshot?.('web-clipper');
    return Boolean(state?.enabled);
  };

  handle('clipper:status', async () => ({
    extensionDir: getExtensionDir(),
    ...(getIngress()?.status() || { running: false, port: null, pairing: null, clients: [] }),
    pluginEnabled: isPluginEnabled(),
    settings: readSettings(),
  }));
  handle('clipper:create-pairing-code', () => {
    const ingress = getIngress();
    if (!ingress?.status().running) throw Object.assign(new Error('本地接收服务未启动（端口 47831–47835 可能都被占用）'), { code: 'NOT_RUNNING' });
    return ingress.createPairingCode();
  });
  handle('clipper:open-extension-folder', async () => {
    const dir = getExtensionDir();
    const error = await shell.openPath(dir);
    if (error) throw new Error(error);
    return dir;
  });
  handle('clipper:issue-token', (name) => {
    const ingress = getIngress();
    if (!ingress?.status().running) throw Object.assign(new Error('本地接收服务未启动'), { code: 'NOT_RUNNING' });
    return { ...ingress.issueToken(name || 'MCP 客户端'), port: ingress.status().port };
  });
  handle('clipper:revoke-client', (clientId) => getIngress()?.revokeClient(clientId) || false);
  handle('clipper:save-settings', (patch = {}) => {
    const dao = getSettingDAO();
    for (const [name, value] of Object.entries(patch)) {
      const def = SETTING_KEYS[name];
      if (!def) continue;
      // 默认标签允许清空（不打任何默认标签），其他字符串为空时回到默认值
      const stored = def.type === 'boolean'
        ? Boolean(value)
        : name === 'defaultTags' ? parseTagList(value).join(',') : String(value || def.fallback);
      dao.set(def.key, stored, def.type, `剪藏：${name}`);
    }
    return readSettings();
  });
  handle('clipper:clip-url', async (url, options = {}) => {
    if (!isPluginEnabled()) throw Object.assign(new Error('请先在插件中心启用“网页剪藏”插件'), { code: 'PLUGIN_DISABLED' });
    const settings = readSettings();
    return getClipService().clipUrl(url, {
      kind: options.kind === 'bookmark' ? 'bookmark' : 'article',
      target: { tags: options.tags || [] },
      aiSummary: options.aiSummary ?? settings.aiSummary,
      aiTags: options.aiTags ?? settings.aiTags,
      createTodo: options.createTodo ?? settings.createTodo,
      allowDuplicate: Boolean(options.allowDuplicate),
      source: 'app',
    });
  });
};

module.exports = { registerClipperHandlers, readClipperSettings, parseTagList, CLIPPER_SETTING_KEYS: SETTING_KEYS };
