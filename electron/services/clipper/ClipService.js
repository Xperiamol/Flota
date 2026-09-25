const path = require('path');
const { EventEmitter } = require('events');

const MAX_IMAGES = 40;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20000;
const TRACKING_PARAMS = /^(utm_\w+|spm|from|fbclid|gclid|share_source|share_medium|share_token|scene|srcid|sharer_\w+|clicktime|enterid|ref|ref_src|isappinstalled|timestamp|chksm|mpshare|sessionid)$/i;
const IMAGE_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/avif': '.avif' };
const DEFAULT_CATEGORY = '剪藏';

// 常见站点的正文容器：Readability 在这些站点上容易丢内容，优先按选择器截取
const SITE_RULES = [
  { host: /(^|\.)mp\.weixin\.qq\.com$/, content: '#js_content', title: '#activity-name', byline: '#js_name' },
  { host: /(^|\.)zhihu\.com$/, content: '.Post-RichText, .RichContent-inner, .RichText', title: '.Post-Title, .QuestionHeader-title' },
  { host: /(^|\.)juejin\.cn$/, content: '.article-content', title: '.article-title' },
  { host: /(^|\.)sspai\.com$/, content: '.article-body, .content', title: '.title' },
];

class ClipError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const loadParsers = () => ({
  parseHTML: require('linkedom').parseHTML,
  Readability: require('@mozilla/readability').Readability,
  TurndownService: require('turndown'),
  gfm: require('turndown-plugin-gfm').gfm,
});

const formatDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const escapeMdText = (text) => String(text || '').replace(/[[\]]/g, '').replace(/\n+/g, ' ').trim();

/**
 * 剪藏服务：把网页（URL / 扩展发来的正文 / 选区 / 书签）保存为笔记。
 * 入口：IngressService（浏览器扩展、MCP）与应用内“剪藏网页链接”。
 */
class ClipService extends EventEmitter {
  /**
   * @param {object} deps
   * @param {import('../NoteService')} deps.noteService
   * @param {import('../ImageService')} deps.imageService
   * @param {object} [deps.todoService]
   * @param {() => any} [deps.getChatService]
   * @param {object} [deps.aiService]
   * @param {(channel: string, payload: any) => void} [deps.broadcast]
   */
  constructor({ noteService, imageService, todoService, getChatService, aiService, broadcast, getDefaults }) {
    super();
    this.getDefaults = getDefaults || (() => ({}));
    this.noteService = noteService;
    this.noteDAO = noteService.noteDAO;
    this.imageService = imageService;
    this.todoService = todoService;
    this.getChatService = getChatService || (() => null);
    this.aiService = aiService;
    this.broadcast = broadcast || (() => {});
  }

  getDB() {
    return this.noteDAO.getDB();
  }

  // ==================== URL 与去重 ====================

  normalizeUrl(rawUrl) {
    let url;
    try {
      url = new URL(String(rawUrl || '').trim());
    } catch {
      throw new ClipError('INVALID_URL', '链接格式不正确');
    }
    if (!/^https?:$/.test(url.protocol)) throw new ClipError('INVALID_URL', '只支持 http / https 链接');
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, '');
  }

  findByUrl(urlKey) {
    return this.getDB().prepare(`
      SELECT id, sync_id, title FROM notes
      WHERE is_deleted = 0 AND meta IS NOT NULL AND json_extract(meta, '$.source.urlKey') = ?
      ORDER BY updated_at DESC LIMIT 1
    `).get(urlKey) || null;
  }

  ensureCategory(name) {
    if (!name || name === 'default') return 'default';
    this.getDB().prepare(`
      INSERT OR IGNORE INTO categories (name, color, icon, sort_order) VALUES (?, '#0ea5e9', 'bookmark', 99)
    `).run(name);
    return name;
  }

  // ==================== 抓取与解析 ====================

  async fetchText(url) {
    const { net } = require('electron');
    const fetchImpl = net?.fetch ? net.fetch.bind(net) : fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      });
      if (!response.ok) throw new ClipError('FETCH_FAILED', `网页请求失败（${response.status}）`);
      const type = response.headers.get('content-type') || '';
      if (type && !/html|xml|text\/plain/i.test(type)) throw new ClipError('UNSUPPORTED', `暂不支持剪藏这种内容（${type.split(';')[0]}）`);
      return { html: await response.text(), finalUrl: response.url || url };
    } catch (error) {
      if (error instanceof ClipError) throw error;
      throw new ClipError('FETCH_FAILED', error.name === 'AbortError' ? '网页加载超时' : `网页加载失败：${error.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 从 HTML 提取正文：站点规则优先，其次 Readability。
   * @returns {{ title: string, byline: string, siteName: string, excerpt: string, cover: string, contentHtml: string }}
   */
  parseHtml(html, pageUrl) {
    const { parseHTML, Readability } = loadParsers();
    const { document } = parseHTML(html);
    const meta = (selector) => document.querySelector(selector)?.getAttribute('content')?.trim() || '';
    const host = (() => { try { return new URL(pageUrl).hostname; } catch { return ''; } })();

    // 懒加载图片：把 data-src 等提升为 src，否则转换后图片为空
    document.querySelectorAll('img').forEach((img) => {
      const lazy = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-actualsrc') || img.getAttribute('data-lazy-src');
      if (lazy && (!img.getAttribute('src') || /^data:/.test(img.getAttribute('src')))) img.setAttribute('src', lazy);
    });

    const base = {
      title: meta('meta[property="og:title"]') || document.querySelector('title')?.textContent?.trim() || '',
      siteName: meta('meta[property="og:site_name"]') || host,
      excerpt: meta('meta[property="og:description"]') || meta('meta[name="description"]'),
      cover: meta('meta[property="og:image"]'),
      byline: meta('meta[name="author"]'),
    };

    const rule = SITE_RULES.find((item) => item.host.test(host));
    if (rule) {
      const node = document.querySelector(rule.content);
      if (node && node.textContent.trim().length > 50) {
        return {
          ...base,
          title: (rule.title && document.querySelector(rule.title)?.textContent?.trim()) || base.title,
          byline: (rule.byline && document.querySelector(rule.byline)?.textContent?.trim()) || base.byline,
          contentHtml: node.innerHTML,
        };
      }
    }

    const article = new Readability(document, { charThreshold: 200 }).parse();
    if (!article || !article.content || (article.textContent || '').trim().length < 50) {
      throw new ClipError('NO_CONTENT', '没有识别到正文，可以改用浏览器扩展剪藏，或保存为书签');
    }
    return {
      ...base,
      title: article.title || base.title,
      byline: article.byline || base.byline,
      siteName: article.siteName || base.siteName,
      excerpt: base.excerpt || article.excerpt || '',
      contentHtml: article.content,
    };
  }

  htmlToMarkdown(contentHtml, pageUrl) {
    const { parseHTML, TurndownService, gfm } = loadParsers();
    // 相对链接转绝对链接
    const { document } = parseHTML(`<!doctype html><html><body><div id="root">${contentHtml}</div></body></html>`);
    const root = document.getElementById('root');
    root.querySelectorAll('img[src]').forEach((img) => {
      try { img.setAttribute('src', new URL(img.getAttribute('src'), pageUrl).toString()); } catch {}
    });
    root.querySelectorAll('a[href]').forEach((a) => {
      try { a.setAttribute('href', new URL(a.getAttribute('href'), pageUrl).toString()); } catch {}
    });
    root.querySelectorAll('script, style, noscript, iframe, form, button, svg').forEach((node) => node.remove());

    const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
    turndown.use(gfm);
    return turndown.turndown(root.innerHTML).replace(/\n{3,}/g, '\n\n').trim();
  }

  // ==================== 图片本地化 ====================

  async downloadImage(url) {
    const { net } = require('electron');
    const fetchImpl = net?.fetch ? net.fetch.bind(net) : fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      // 不带 Referer：公众号等站点的防盗链会拒绝外站 Referer，但允许空 Referer
      const response = await fetchImpl(url, { signal: controller.signal, referrerPolicy: 'no-referrer', headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!response.ok) return null;
      const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return null;
      const urlExt = path.extname(new URL(url).pathname).toLowerCase();
      const ext = IMAGE_EXT[type] || (/^\.(png|jpe?g|gif|webp|svg|avif)$/.test(urlExt) ? urlExt : '');
      if (!ext && !/^image\//.test(type)) return null;
      return this.imageService.saveImage(buffer, `clip${ext || '.jpg'}`);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 把正文中的远程图片下载到本地，替换为 images/xxx；下载失败的保留原链接 */
  async localizeImages(markdown) {
    const re = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g;
    const urls = [...new Set([...markdown.matchAll(re)].map((match) => match[2]))].slice(0, MAX_IMAGES);
    const mapping = new Map();
    const queue = [...urls];
    const workers = Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const url = queue.shift();
        const local = await this.downloadImage(url);
        if (local) mapping.set(url, local);
      }
    });
    await Promise.all(workers);
    const replaced = markdown.replace(re, (match, alt, url) => (mapping.has(url) ? `![${alt}](${mapping.get(url)})` : match));
    return { markdown: replaced, localized: mapping.size, total: urls.length };
  }

  // ==================== 保存 ====================

  buildContent({ kind, url, title, siteName, byline, excerpt, cover, markdown }) {
    const sourceLine = [
      `来源：[${escapeMdText(siteName || title || url)}](${url})`,
      byline ? `作者：${escapeMdText(byline)}` : '',
      `剪藏于 ${formatDate()}`,
    ].filter(Boolean).join(' · ');
    const parts = [`> ${sourceLine}`];
    if (kind === 'bookmark') {
      if (cover) parts.push(`![](${cover})`);
      if (excerpt) parts.push(excerpt);
    } else if (markdown) {
      parts.push(markdown);
    }
    return parts.join('\n\n');
  }

  /**
   * 保存剪藏。
   * @param {object} clip
   * @param {'article'|'selection'|'bookmark'} [clip.kind]
   * @param {string} clip.url
   * @param {string} [clip.title]
   * @param {string} [clip.markdown] 扩展已转换好的 Markdown（kind 为 article/selection 时）
   * @param {string} [clip.html] 或者传正文 HTML，由这里转换
   * @param {object} [clip.target] { category, tags }
   * @param {object} [options] { aiSummary, aiTags, createTodo, allowDuplicate, source }
   */
  async saveClip(clip = {}, rawOptions = {}) {
    // 未显式指定的选项使用“设置 → 网页剪藏”中的默认值
    const defaults = this.getDefaults() || {};
    const options = {
      ...rawOptions,
      aiSummary: rawOptions.aiSummary ?? defaults.aiSummary ?? false,
      aiTags: rawOptions.aiTags ?? defaults.aiTags ?? false,
      createTodo: rawOptions.createTodo ?? defaults.createTodo ?? false,
    };
    const kind = ['article', 'selection', 'bookmark'].includes(clip.kind) ? clip.kind : 'article';
    const urlKey = this.normalizeUrl(clip.url);
    if (!options.allowDuplicate) {
      const existing = this.findByUrl(urlKey);
      if (existing && kind !== 'selection') {
        return { duplicate: true, noteId: existing.id, syncId: existing.sync_id, title: existing.title };
      }
    }

    let markdown = typeof clip.markdown === 'string' ? clip.markdown : '';
    if (!markdown && clip.html) markdown = this.htmlToMarkdown(clip.html, clip.url);
    if (kind !== 'bookmark' && !markdown.trim()) throw new ClipError('NO_CONTENT', '剪藏内容为空');
    if (markdown.length > 2 * 1024 * 1024) throw new ClipError('TOO_LARGE', '剪藏内容过大');

    let imageStats = { localized: 0, total: 0 };
    if (markdown && options.localizeImages !== false) {
      const result = await this.localizeImages(markdown);
      markdown = result.markdown;
      imageStats = { localized: result.localized, total: result.total };
    }
    let cover = clip.cover || '';
    if (cover && !/^(https?:|images\/)/.test(cover)) {
      try { cover = new URL(cover, clip.url).toString(); } catch { cover = ''; }
    }
    if (kind === 'bookmark' && /^https?:/.test(cover)) cover = (await this.downloadImage(cover)) || cover;

    const title = String(clip.title || '').trim().slice(0, 200) || urlKey;
    const fallbackCategory = defaults.defaultCategory || DEFAULT_CATEGORY;
    const category = this.ensureCategory(String(clip.target?.category || fallbackCategory).trim() || fallbackCategory);
    const tags = Array.isArray(clip.target?.tags) ? clip.target.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 10) : [];
    const content = this.buildContent({ kind, url: clip.url, title, siteName: clip.siteName, byline: clip.byline, excerpt: clip.excerpt, cover, markdown });

    const result = await this.noteService.createNote({
      title,
      content,
      tags,
      category,
      note_type: 'markdown',
      meta: {
        source: {
          type: 'clip',
          kind,
          url: clip.url,
          urlKey,
          site: clip.siteName || '',
          byline: clip.byline || '',
          via: options.source || 'app',
          clippedAt: Date.now(),
        },
      },
    });
    if (!result?.success) throw new ClipError('SAVE_FAILED', result?.error || '保存笔记失败');
    const note = result.data;
    this.broadcast('clipper:clipped', { note, via: options.source || 'app' });

    if (options.createTodo && this.todoService) {
      try {
        this.todoService.createTodo({ content: `阅读：${title}`, description: clip.url });
        this.broadcast('todo:changed', { source: 'clipper' });
      } catch (error) {
        console.warn('[Clip] 创建阅读待办失败:', error.message);
      }
    }

    if (options.aiSummary || options.aiTags) {
      this.enrichWithAI(note.id, { summary: Boolean(options.aiSummary), tags: Boolean(options.aiTags) })
        .catch((error) => console.warn('[Clip] AI 处理失败:', error.message));
    }

    return { noteId: note.id, syncId: note.sync_id, title: note.title, category, images: imageStats };
  }

  async clipUrl(url, options = {}) {
    const urlKey = this.normalizeUrl(url);
    if (!options.allowDuplicate) {
      const existing = this.findByUrl(urlKey);
      if (existing) return { duplicate: true, noteId: existing.id, syncId: existing.sync_id, title: existing.title };
    }
    const { html, finalUrl } = await this.fetchText(url);
    if (options.kind === 'bookmark') {
      const parsed = (() => { try { return this.parseHtml(html, finalUrl); } catch { return null; } })();
      const { parseHTML } = loadParsers();
      const { document } = parseHTML(html);
      const meta = (selector) => document.querySelector(selector)?.getAttribute('content')?.trim() || '';
      return this.saveClip({
        kind: 'bookmark',
        url: finalUrl,
        title: parsed?.title || meta('meta[property="og:title"]') || document.querySelector('title')?.textContent?.trim(),
        siteName: parsed?.siteName || meta('meta[property="og:site_name"]'),
        excerpt: parsed?.excerpt || meta('meta[name="description"]'),
        cover: parsed?.cover || meta('meta[property="og:image"]'),
        target: options.target,
      }, { ...options, allowDuplicate: true });
    }
    const parsed = this.parseHtml(html, finalUrl);
    return this.saveClip({
      kind: 'article',
      url: finalUrl,
      title: parsed.title,
      siteName: parsed.siteName,
      byline: parsed.byline,
      excerpt: parsed.excerpt,
      cover: parsed.cover,
      markdown: this.htmlToMarkdown(parsed.contentHtml, finalUrl),
      target: options.target,
    }, { ...options, allowDuplicate: true });
  }

  // ==================== AI 摘要与标签 ====================

  async enrichWithAI(noteId, { summary, tags }) {
    const chatService = this.getChatService();
    if (!chatService) return;
    const config = await this.aiService?.getConfig?.();
    if (!config?.success || !config.data?.enabled || !config.data?.apiKey) return;

    const note = this.noteDAO.findById(noteId);
    if (!note) return;
    const text = String(note.content || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').slice(0, 12000);
    const patch = {};

    if (summary && text.length > 300) {
      const result = await chatService._generatePlainText([
        { role: 'system', content: '你是阅读助手。用简体中文为文章写 3-5 条要点摘要，每条一行，以“- ”开头，不超过 40 字，只输出要点本身。' },
        { role: 'user', content: `标题：${note.title}\n\n${text}` },
      ], { temperature: 0.2, maxTokens: 600 });
      const lines = String(result?.content || '').split('\n').map((line) => line.trim()).filter((line) => /^[-*•]\s*/.test(line)).slice(0, 6);
      if (lines.length) {
        const callout = ['> [!abstract] AI 摘要', ...lines.map((line) => `> - ${line.replace(/^[-*•]\s*/, '')}`)].join('\n');
        const content = String(note.content || '');
        // 放在来源行之后
        const firstBreak = content.indexOf('\n\n');
        patch.content = firstBreak > 0
          ? `${content.slice(0, firstBreak)}\n\n${callout}${content.slice(firstBreak)}`
          : `${callout}\n\n${content}`;
      }
    }

    if (tags && typeof chatService.autoAnnotate === 'function') {
      const library = this.getDB().prepare('SELECT name FROM tags ORDER BY usage_count DESC LIMIT 60').all().map((row) => row.name);
      const existing = String(note.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean);
      const result = await chatService.autoAnnotate({ title: note.title, content: text, existingTags: existing, libraryTags: library });
      const suggested = result?.success ? result.data.tags || [] : [];
      if (suggested.length) patch.tags = [...new Set([...existing, ...suggested])].slice(0, 10).join(',');
    }

    if (!Object.keys(patch).length) return;
    await this.noteService.updateNote(noteId, patch);
    const updated = this.noteDAO.findById(noteId);
    if (updated) this.broadcast('ai:notes-changed', [updated]);
  }
}

ClipService.ClipError = ClipError;
ClipService.DEFAULT_CATEGORY = DEFAULT_CATEGORY;

module.exports = ClipService;
