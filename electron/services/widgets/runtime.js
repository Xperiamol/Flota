const fs = require('fs');
const path = require('path');
const { parseManifest } = require('./manifest');

const RUNTIME_DIR = path.join(__dirname, 'runtime');
const APP_ROOT = path.join(__dirname, '..', '..', '..');

// 预置库：键为清单 libs 中的名字，值为 node_modules 下的 UMD 文件与注入的全局变量
const LIB_FILES = {
  preact: { file: 'htm/preact/standalone.umd.js', global: 'htmPreact' },
  dayjs: { file: 'dayjs/dayjs.min.js', global: 'dayjs' },
  marked: { file: 'marked/lib/marked.umd.js', global: 'marked' },
  'ts-fsrs': { file: 'ts-fsrs/dist/index.umd.js', global: 'FSRS' },
  sortablejs: { file: 'sortablejs/Sortable.min.js', global: 'Sortable' },
  'chart.js': { file: 'chart.js/dist/chart.umd.js', global: 'Chart' },
};

// 组件文档专用 CSP：禁止一切网络请求，只允许内联脚本/样式与本地运行时资源
const WIDGET_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' app:",
  "style-src 'unsafe-inline' app:",
  'img-src app: data: blob:',
  'font-src app: data:',
  'media-src app: data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const assetCache = new Map();

const readCached = (filePath) => {
  if (!assetCache.has(filePath)) assetCache.set(filePath, fs.readFileSync(filePath));
  return assetCache.get(filePath);
};

const isHexColor = (value) => /^#[0-9a-f]{3,8}$/i.test(value || '');

const hexToRgba = (hex, alpha) => {
  let value = hex.replace('#', '');
  if (value.length === 3) value = value.split('').map((c) => c + c).join('');
  const int = parseInt(value.slice(0, 6), 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
};

const escapeAttr = (value) => String(value).replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c]));

/**
 * 读取运行时静态资源：app://widget-runtime/<path>
 * @returns {{ body: Buffer, type: string } | null}
 */
const readRuntimeAsset = (assetPath) => {
  if (assetPath === 'sdk.js') return { body: readCached(path.join(RUNTIME_DIR, 'sdk.js')), type: 'text/javascript; charset=utf-8' };
  if (assetPath === 'base.css') return { body: readCached(path.join(RUNTIME_DIR, 'base.css')), type: 'text/css; charset=utf-8' };
  const libMatch = /^lib\/([\w.-]+)\.js$/.exec(assetPath);
  if (libMatch && LIB_FILES[libMatch[1]]) {
    return { body: readCached(path.join(APP_ROOT, 'node_modules', LIB_FILES[libMatch[1]].file)), type: 'text/javascript; charset=utf-8' };
  }
  return null;
};

/**
 * 组装组件文档：在组件 HTML 的 <head> 开头注入主题变量、基础样式、SDK 与声明的预置库。
 */
const buildWidgetDocument = (code, searchParams) => {
  const { manifest } = parseManifest(code);
  const theme = searchParams.get('theme') === 'dark' ? 'dark' : 'light';
  const size = ['compact', 'medium', 'full'].includes(searchParams.get('size')) ? searchParams.get('size') : 'medium';
  const primary = isHexColor(searchParams.get('primary')) ? searchParams.get('primary') : '#1976d2';

  const injected = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<link rel="stylesheet" href="app://widget-runtime/base.css">',
    `<style>:root{--fl-primary:${primary};--fl-primary-soft:${hexToRgba(primary, theme === 'dark' ? 0.18 : 0.1)};}</style>`,
    // crossorigin + 服务端 CORS 头：否则经过这些脚本抛出的异常会被浏览器屏蔽成 "Script error."
    '<script src="app://widget-runtime/sdk.js" crossorigin="anonymous"></script>',
    ...manifest.libs.map((lib) => `<script src="app://widget-runtime/lib/${escapeAttr(lib)}.js" crossorigin="anonymous"></script>`),
  ].join('\n');

  const source = String(code || '');
  const htmlAttrs = `data-theme="${theme}" data-size="${size}"`;
  const headMatch = /<head[^>]*>/i.exec(source);
  if (headMatch) {
    const at = headMatch.index + headMatch[0].length;
    const withHead = `${source.slice(0, at)}\n${injected}\n${source.slice(at)}`;
    return /<html[^>]*>/i.test(withHead)
      ? withHead.replace(/<html([^>]*)>/i, (match, attrs) => (/data-theme=/.test(attrs) ? match : `<html${attrs} ${htmlAttrs}>`))
      : withHead;
  }
  const htmlMatch = /<html[^>]*>/i.exec(source);
  if (htmlMatch) {
    const at = htmlMatch.index + htmlMatch[0].length;
    return `${source.slice(0, at)}<head>\n${injected}\n</head>${source.slice(at)}`.replace(/<html([^>]*)>/i, `<html$1 ${htmlAttrs}>`);
  }
  return `<!doctype html>\n<html ${htmlAttrs}><head>\n${injected}\n</head><body>\n${source}\n</body></html>`;
};

module.exports = {
  WIDGET_CSP,
  LIB_FILES,
  readRuntimeAsset,
  buildWidgetDocument,
};
