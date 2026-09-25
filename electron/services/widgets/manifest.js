/**
 * 组件清单：放在单文件 HTML 的 <script type="application/flota-widget"> 里。
 * 一个 HTML 文件就是一个完整组件，同时也是存储格式与分享格式（.flota-widget.html）。
 */

const MANIFEST_RE = /<script[^>]*type\s*=\s*["']application\/flota-widget["'][^>]*>([\s\S]*?)<\/script>/i;

const SIZES = ['compact', 'medium', 'full'];
const PERMISSIONS = new Set(['notes:read', 'notes:write', 'todos:read', 'todos:write', 'ai:complete']);
const LIBS = new Set(['preact', 'dayjs', 'marked', 'ts-fsrs', 'sortablejs', 'chart.js']);
const SDK_VERSION = 1;

const asStringArray = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()) : []);

const normalizeManifest = (raw = {}) => {
  const manifest = raw && typeof raw === 'object' ? raw : {};
  const sizes = asStringArray(manifest.sizes).filter((size) => SIZES.includes(size));
  return {
    name: typeof manifest.name === 'string' && manifest.name.trim() ? manifest.name.trim().slice(0, 80) : '未命名组件',
    description: typeof manifest.description === 'string' ? manifest.description.trim().slice(0, 500) : '',
    // 组件主页“帮助”里展示的使用说明（Markdown）
    help: typeof manifest.help === 'string' ? manifest.help.trim().slice(0, 4000) : '',
    icon: typeof manifest.icon === 'string' ? manifest.icon.trim().slice(0, 32) : '',
    sdkVersion: Number.isInteger(manifest.sdkVersion) ? manifest.sdkVersion : SDK_VERSION,
    sizes: sizes.length ? sizes : ['medium', 'full'],
    libs: asStringArray(manifest.libs).filter((lib) => LIBS.has(lib)),
    data: manifest.data && typeof manifest.data === 'object' && !Array.isArray(manifest.data) ? manifest.data : {},
    // "w_xxx.collection" 形式，声明要读取的其他组件数据
    imports: asStringArray(manifest.imports).filter((item) => /^[^.\s]+\.[A-Za-z_][\w-]*$/.test(item)),
    permissions: asStringArray(manifest.permissions).filter((permission) => PERMISSIONS.has(permission)),
  };
};

const parseManifest = (html) => {
  const match = MANIFEST_RE.exec(String(html || ''));
  if (!match) return { manifest: normalizeManifest({}), error: null, found: false };
  try {
    return { manifest: normalizeManifest(JSON.parse(match[1])), error: null, found: true };
  } catch (error) {
    return { manifest: normalizeManifest({}), error: `组件清单不是合法 JSON：${error.message}`, found: true };
  }
};

// 用新清单替换（或插入）HTML 中的清单块
const writeManifest = (html, manifest) => {
  const block = `<script type="application/flota-widget">\n${JSON.stringify(manifest, null, 2)}\n</script>`;
  const source = String(html || '');
  if (MANIFEST_RE.test(source)) return source.replace(MANIFEST_RE, block);
  const headMatch = /<head[^>]*>/i.exec(source);
  if (headMatch) {
    const at = headMatch.index + headMatch[0].length;
    return `${source.slice(0, at)}\n${block}${source.slice(at)}`;
  }
  return `${block}\n${source}`;
};

module.exports = {
  SDK_VERSION,
  SIZES,
  PERMISSIONS,
  LIBS,
  parseManifest,
  writeManifest,
  normalizeManifest,
};
