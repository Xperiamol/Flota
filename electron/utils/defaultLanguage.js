/**
 * 根据系统语言选择默认界面语言：中文系统用 zh-CN，其余（含未设置/C 语言环境）一律回退到 en-US。
 */
function detectDefaultLanguage() {
  let locale = '';
  try {
    const { app } = require('electron');
    if (app && typeof app.getLocale === 'function') locale = app.getLocale();
  } catch (e) {
    // 独立运行模式（如 MCP Server）
  }
  if (!locale) {
    locale = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  }
  return /^zh\b/i.test(String(locale).replace('_', '-')) ? 'zh-CN' : 'en-US';
}

module.exports = { detectDefaultLanguage };
