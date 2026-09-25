const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const WidgetDAO = require('../../dao/WidgetDAO');
const { parseManifest } = require('./manifest');

const COLLECTION_RE = /^[A-Za-z_][\w-]{0,63}$/;
const DRAFT_PREFIX = '__draft__';
const DRAFT_TTL_MS = 6 * 60 * 60 * 1000;
const RECENTLY_DELETED_MS = 30 * 24 * 60 * 60 * 1000;
const AI_DAILY_LIMIT = 50;
const MAX_CODE_SIZE = 2 * 1024 * 1024;
const STORAGE_PREFIX = 'widget:';
// 生成组件时作为参考范例的商店组件
const FEW_SHOT_EXAMPLES = ['flashcards', 'kanban'];

class WidgetError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const today = () => new Date().toISOString().slice(0, 10);

const matchesWhere = (record, where) => {
  if (!where || typeof where !== 'object') return true;
  return Object.entries(where).every(([key, expected]) => {
    const actual = record[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if ('in' in expected) return Array.isArray(expected.in) && expected.in.includes(actual);
      if ('ne' in expected) return actual !== expected.ne;
      if ('lt' in expected && !(actual < expected.lt)) return false;
      if ('lte' in expected && !(actual <= expected.lte)) return false;
      if ('gt' in expected && !(actual > expected.gt)) return false;
      if ('gte' in expected && !(actual >= expected.gte)) return false;
      if ('contains' in expected) return String(actual ?? '').toLowerCase().includes(String(expected.contains).toLowerCase());
      return true;
    }
    return actual === expected;
  });
};

const compareBy = (field, desc) => (a, b) => {
  const x = a[field];
  const y = b[field];
  if (x === y) return 0;
  if (x === undefined || x === null) return 1;
  if (y === undefined || y === null) return -1;
  const result = x < y ? -1 : 1;
  return desc ? -result : result;
};

const parseNoteMeta = (note) => {
  try { return note?.meta ? JSON.parse(note.meta) : null; } catch { return null; }
};

const pickNote = (note) => {
  if (!note) return null;
  const source = parseNoteMeta(note)?.source;
  return {
    id: note.id,
    syncId: note.sync_id,
    title: note.title,
    content: note.content,
    tags: note.tags ? String(note.tags).split(',').map((tag) => tag.trim()).filter(Boolean) : [],
    category: note.category,
    type: note.note_type || 'markdown',
    // 剪藏来源：{ type: 'clip', url, site, kind, clippedAt }
    source: source ? { type: source.type, url: source.url, site: source.site, kind: source.kind, clippedAt: source.clippedAt } : null,
    createdAt: note.created_at,
    updatedAt: note.updated_at,
  };
};

/**
 * 组件服务。
 * 组件：小应用本身（单文件 HTML、说明、历史版本）；实例：组件的一次使用，数据属于实例；
 * 笔记、首页、桌面小窗只引用实例。组件运行时一律以实例 id（或草稿 id）定位。
 */
class WidgetService extends EventEmitter {
  /**
   * @param {object} deps
   * @param {object} deps.noteService
   * @param {object} deps.todoService
   * @param {object} [deps.aiService]
   * @param {(channel: string, payload: any) => void} [deps.broadcast]
   * @param {() => string} [deps.getStoreDir] 商店组件（plugins/widgets）所在目录
   */
  constructor({ noteService, todoService, aiService, broadcast, getStoreDir }) {
    super();
    this.noteService = noteService;
    this.noteDAO = noteService.noteDAO;
    this.todoService = todoService;
    this.aiService = aiService;
    this.broadcast = broadcast || (() => {});
    this.getStoreDir = getStoreDir || (() => path.join(__dirname, '..', '..', '..', 'plugins', 'widgets'));
    this.dao = new WidgetDAO();
    this.drafts = new Map();
  }

  getDB() {
    return this.dao.getDB();
  }

  emitChanged(reason) {
    this.broadcast('widget:list-changed', { at: Date.now(), reason });
  }

  // ==================== 组件 ====================

  describeWidget(widget, { withCode = false } = {}) {
    const { manifest, error } = parseManifest(widget.code);
    const { code, ...rest } = widget;
    return {
      ...rest,
      name: widget.name || manifest.name,
      manifest,
      manifestError: error,
      pendingApproval: Boolean(this.getStorage(widget.id, 'pendingApproval', false)),
      ...(withCode ? { code } : {}),
    };
  }

  listWidgets() {
    const counts = new Map(this.getDB().prepare(`
      SELECT widget_id, COUNT(*) AS count FROM widget_instances WHERE is_deleted = 0 GROUP BY widget_id
    `).all().map((row) => [row.widget_id, row.count]));
    return this.dao.listWidgets().map((widget) => ({ ...this.describeWidget(widget), instanceCount: counts.get(widget.id) || 0 }));
  }

  requireWidget(id) {
    const widget = this.dao.getWidget(id);
    if (!widget) throw new WidgetError('NOT_FOUND', '组件不存在或已删除');
    return widget;
  }

  getWidget(id, { withCode = true } = {}) {
    return this.describeWidget(this.requireWidget(id), { withCode });
  }

  validateCode(code) {
    if (typeof code !== 'string' || !code.trim()) throw new WidgetError('INVALID_CODE', '组件代码为空');
    if (code.length > MAX_CODE_SIZE) throw new WidgetError('INVALID_CODE', '组件代码超过 2MB 上限');
    const { manifest, error } = parseManifest(code);
    if (error) throw new WidgetError('INVALID_MANIFEST', error);
    return manifest;
  }

  /**
   * 新建组件，并同时创建第一个实例。
   * @returns {{ widget: object, instance: object }}
   */
  createWidget({ code, source = 'ai', storeId = null, pinned = true, instanceName, fromDraft, trusted = true, versionNote = '创建' }) {
    const manifest = this.validateCode(code);
    const widget = this.dao.insertWidget({ name: manifest.name, code, source, storeId, pinned });
    this.dao.addVersion(widget.id, code, versionNote);
    const instance = this.dao.insertInstance({ widgetId: widget.id, name: instanceName || manifest.name });
    if (fromDraft && this.isDraftId(fromDraft)) {
      this.dao.moveRecords(fromDraft, instance.id);
      this.drafts.delete(fromDraft);
    }
    if (!trusted) this.setStorage(widget.id, 'pendingApproval', true);
    this.emitChanged('widget-created');
    return { widget: this.describeWidget(widget), instance };
  }

  updateWidgetCode(id, code, versionNote = '修改') {
    this.requireWidget(id);
    const manifest = this.validateCode(code);
    const previousVersion = this.dao.latestVersion(id);
    const widget = this.dao.updateWidget(id, { code, name: manifest.name });
    const version = this.dao.addVersion(id, code, versionNote);
    this.emitChanged('widget-updated');
    return { widget: this.describeWidget(widget), version, previousVersion };
  }

  setPinned(id, pinned) {
    this.requireWidget(id);
    this.dao.updateWidget(id, { pinned: Boolean(pinned) });
    this.emitChanged('widget-pinned');
    return true;
  }

  listVersions(id) {
    this.requireWidget(id);
    return this.dao.listVersions(id);
  }

  rollback(id, version) {
    this.requireWidget(id);
    const target = this.dao.getVersion(id, Number(version));
    if (!target) throw new WidgetError('NOT_FOUND', `版本 ${version} 不存在`);
    return this.updateWidgetCode(id, target.code, `回滚到版本 ${version}`);
  }

  // 删除组件：连同全部实例一起进入“最近删除”
  deleteWidget(id) {
    this.requireWidget(id);
    const now = Date.now();
    for (const instance of this.dao.listInstances(id)) {
      this.dao.updateInstance(instance.id, { isDeleted: true, deletedAt: now });
    }
    this.dao.updateWidget(id, { isDeleted: true, deletedAt: now });
    this.emitChanged('widget-deleted');
    return true;
  }

  // ==================== 实例 ====================

  // 引用了该实例的笔记（正文里的 app://widget/<实例 id> 链接）
  findReferencingNotes(instanceId) {
    return this.getDB().prepare(`
      SELECT id, sync_id, title FROM notes WHERE is_deleted = 0 AND content LIKE ? ORDER BY updated_at DESC
    `).all(`%app://widget/${instanceId}%`).map((row) => ({ id: row.id, syncId: row.sync_id, title: row.title }));
  }

  describeInstance(instance) {
    return {
      ...instance,
      recordCount: this.dao.countRecords(instance.id),
      notes: this.findReferencingNotes(instance.id),
    };
  }

  listInstances(widgetId, { deleted = false } = {}) {
    this.requireWidget(widgetId);
    this.purgeExpiredInstances();
    return this.dao.listInstances(widgetId, { deleted }).map((instance) => this.describeInstance(instance));
  }

  // 所有实例（选择器用），附带组件名称与图标
  listAllInstances() {
    const widgets = new Map(this.listWidgets().map((widget) => [widget.id, widget]));
    return this.dao.listAllInstances()
      .filter((instance) => widgets.has(instance.widgetId))
      .map((instance) => {
        const widget = widgets.get(instance.widgetId);
        return { ...instance, widgetName: widget.name, widgetIcon: widget.manifest.icon, sizes: widget.manifest.sizes };
      });
  }

  getInstance(id) {
    const instance = this.dao.getInstance(id, { includeDeleted: true });
    if (!instance) throw new WidgetError('NOT_FOUND', '实例不存在');
    const widget = this.dao.getWidget(instance.widgetId, { includeDeleted: true });
    if (!widget) throw new WidgetError('NOT_FOUND', '组件不存在');
    return { instance: this.describeInstance(instance), widget: this.describeWidget(widget) };
  }

  createInstance(widgetId, name) {
    const widget = this.requireWidget(widgetId);
    const existing = this.dao.listInstances(widgetId).length;
    const instance = this.dao.insertInstance({ widgetId, name: String(name || '').trim().slice(0, 80) || `${widget.name} ${existing + 1}` });
    this.emitChanged('instance-created');
    return instance;
  }

  renameInstance(id, name) {
    const trimmed = String(name || '').trim().slice(0, 80);
    if (!trimmed) throw new WidgetError('INVALID_NAME', '实例名称不能为空');
    const instance = this.dao.updateInstance(id, { name: trimmed });
    if (!instance) throw new WidgetError('NOT_FOUND', '实例不存在');
    this.emitChanged('instance-renamed');
    return instance;
  }

  deleteInstance(id) {
    const instance = this.dao.updateInstance(id, { isDeleted: true, deletedAt: Date.now() });
    if (!instance) throw new WidgetError('NOT_FOUND', '实例不存在');
    this.emitChanged('instance-deleted');
    return true;
  }

  restoreInstance(id) {
    const instance = this.dao.getInstance(id, { includeDeleted: true });
    if (!instance) throw new WidgetError('NOT_FOUND', '实例不存在');
    const widget = this.dao.getWidget(instance.widgetId, { includeDeleted: true });
    if (widget?.isDeleted) this.dao.updateWidget(widget.id, { isDeleted: false, deletedAt: null });
    this.dao.updateInstance(id, { isDeleted: false, deletedAt: null });
    this.emitChanged('instance-restored');
    return true;
  }

  purgeExpiredInstances() {
    const threshold = Date.now() - RECENTLY_DELETED_MS;
    const expired = this.getDB().prepare('SELECT id FROM widget_instances WHERE is_deleted = 1 AND deleted_at < ?').all(threshold);
    for (const row of expired) this.dao.purgeInstance(row.id);
  }

  // ==================== 草稿（AI 生成 / 修改时预跑与预览） ====================

  isDraftId(ref) {
    return typeof ref === 'string' && ref.startsWith(DRAFT_PREFIX);
  }

  /**
   * @param {string} code
   * @param {object} [options]
   * @param {string} [options.widgetId] 修改哪个组件（用于权限与保存）
   * @param {string} [options.cloneDataFrom] 预览用哪个实例的数据副本（预览中的改动不影响原数据）
   */
  createDraft(code, { widgetId = null, cloneDataFrom } = {}) {
    this.validateCode(code);
    this.pruneDrafts();
    const id = `${DRAFT_PREFIX}${crypto.randomUUID()}`;
    this.drafts.set(id, { code, widgetId, createdAt: Date.now() });
    if (cloneDataFrom && this.dao.getInstance(cloneDataFrom)) this.dao.cloneRecords(cloneDataFrom, id);
    return id;
  }

  updateDraft(id, code) {
    const draft = this.drafts.get(id);
    if (!draft) throw new WidgetError('NOT_FOUND', '组件草稿已过期');
    this.validateCode(code);
    this.drafts.set(id, { ...draft, code, createdAt: Date.now() });
    return id;
  }

  getDraft(id) {
    return this.drafts.get(id) || null;
  }

  discardDraft(id) {
    if (!this.isDraftId(id)) return false;
    this.drafts.delete(id);
    this.dao.dropRecords(id);
    return true;
  }

  pruneDrafts() {
    const now = Date.now();
    for (const [id, draft] of this.drafts) {
      if (now - draft.createdAt > DRAFT_TTL_MS) this.discardDraft(id);
    }
  }

  /**
   * 保存草稿：修改已有组件时更新代码（预览数据副本丢弃）；否则新建组件与第一个实例（预览数据转为实例数据）。
   */
  saveDraft(draftId, { instanceName, versionNote } = {}) {
    const draft = this.getDraft(draftId);
    if (!draft) throw new WidgetError('NOT_FOUND', '组件草稿已过期，请重新生成');
    if (draft.widgetId) {
      const result = this.updateWidgetCode(draft.widgetId, draft.code, versionNote || 'AI 修改');
      this.discardDraft(draftId);
      return result;
    }
    return this.createWidget({ code: draft.code, source: 'ai', instanceName, fromDraft: draftId, versionNote: versionNote || 'AI 生成' });
  }

  // 协议层取代码：实例 → 所属组件的代码；草稿 → 内存中的代码
  getCodeForRuntime(ref) {
    if (this.isDraftId(ref)) return this.getDraft(ref)?.code || null;
    const instance = this.dao.getInstance(ref, { includeDeleted: true });
    if (!instance) return null;
    return this.dao.getWidget(instance.widgetId, { includeDeleted: true })?.code || null;
  }

  // ==================== 商店与参考范例 ====================

  readStoreFile(file) {
    return fs.readFileSync(path.join(this.getStoreDir(), file), 'utf-8');
  }

  listExamples() {
    return FEW_SHOT_EXAMPLES.map((name) => {
      try {
        const code = this.readStoreFile(`${name}.flota-widget.html`);
        return { id: name, name: parseManifest(code).manifest.name, code };
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  /**
   * @param {Array<object>} entries 注册表中 type 为 widget 的条目
   * @param {(entry: object) => string} resolvePath 条目 → 本地 HTML 文件路径
   */
  listStoreWidgets(entries, resolvePath) {
    const installed = new Map(this.dao.listWidgets().filter((widget) => widget.storeId).map((widget) => [widget.storeId, widget.id]));
    return entries.map((entry) => {
      let manifest = {};
      try {
        manifest = parseManifest(fs.readFileSync(resolvePath(entry), 'utf-8')).manifest;
      } catch {
        manifest = {};
      }
      return {
        id: entry.id,
        name: entry.name || manifest.name,
        description: entry.description || manifest.description || '',
        help: manifest.help || '',
        icon: manifest.icon || '',
        version: entry.version || '1.0.0',
        author: entry.author || null,
        categories: entry.categories || [],
        tags: entry.tags || [],
        permissions: manifest.permissions || [],
        sizes: manifest.sizes || [],
        installed: installed.has(entry.id),
        widgetId: installed.get(entry.id) || null,
      };
    });
  }

  installFromStore(entry, resolvePath) {
    const code = fs.readFileSync(resolvePath(entry), 'utf-8');
    return this.createWidget({ code, source: 'store', storeId: entry.id, trusted: entry.trusted !== false, versionNote: `从商店添加「${entry.name}」` });
  }

  // 商店试用：用临时草稿运行，数据不保存
  createStorePreview(entry, resolvePath) {
    return this.createDraft(fs.readFileSync(resolvePath(entry), 'utf-8'));
  }

  // ==================== 本地存储（授权、界面状态、AI 额度；不同步） ====================

  getStorage(widgetId, key, fallback = null) {
    const row = this.getDB().prepare('SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?')
      .get(`${STORAGE_PREFIX}${widgetId}`, key);
    if (!row) return fallback;
    try { return JSON.parse(row.value); } catch { return fallback; }
  }

  setStorage(widgetId, key, value) {
    const pluginId = `${STORAGE_PREFIX}${widgetId}`;
    if (value === undefined || value === null) {
      this.getDB().prepare('DELETE FROM plugin_storage WHERE plugin_id = ? AND key = ?').run(pluginId, key);
      return;
    }
    this.getDB().prepare(`
      INSERT OR REPLACE INTO plugin_storage (plugin_id, key, value, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).run(pluginId, key, JSON.stringify(value));
  }

  approve(widgetId) {
    this.setStorage(widgetId, 'pendingApproval', null);
    this.emitChanged('widget-approved');
    return true;
  }

  getAiUsage(widgetId) {
    return { used: Number(this.getStorage(widgetId, `aiUsage:${today()}`, 0)) || 0, limit: AI_DAILY_LIMIT };
  }

  // ==================== 组件 RPC ====================

  /** 运行上下文：实例 id 或草稿 id → { scopeId（数据归属）, widgetId, manifest, draft } */
  resolveContext(ref) {
    if (this.isDraftId(ref)) {
      const draft = this.getDraft(ref);
      if (!draft) throw new WidgetError('NOT_FOUND', '组件草稿已过期');
      return { scopeId: ref, widgetId: draft.widgetId, manifest: parseManifest(draft.code).manifest, draft: true };
    }
    const instance = this.dao.getInstance(ref);
    if (!instance) throw new WidgetError('NOT_FOUND', '实例不存在或已删除');
    const widget = this.dao.getWidget(instance.widgetId);
    if (!widget) throw new WidgetError('NOT_FOUND', '组件不存在或已删除');
    return { scopeId: instance.id, widgetId: widget.id, manifest: parseManifest(widget.code).manifest, draft: false };
  }

  assertPermission(ctx, permission) {
    if (!ctx.manifest.permissions.includes(permission)) {
      throw new WidgetError('PERMISSION_DENIED', `组件清单未声明权限 ${permission}`);
    }
    if (!ctx.draft && ctx.widgetId && this.getStorage(ctx.widgetId, 'pendingApproval', false)) {
      throw new WidgetError('PERMISSION_REQUIRED', '需要先授权这个组件');
    }
  }

  // 数据只能读写本实例；读取其他实例须在 imports 中声明对应组件的集合（只读）
  resolveDataTarget(ctx, params, mode) {
    const collection = params?.collection;
    if (typeof collection !== 'string' || !COLLECTION_RE.test(collection)) {
      throw new WidgetError('INVALID_COLLECTION', `集合名不合法：${collection}`);
    }
    const target = params?.instance && params.instance !== ctx.scopeId ? String(params.instance) : ctx.scopeId;
    if (target === ctx.scopeId) return { scopeId: ctx.scopeId, collection };
    if (mode !== 'read') throw new WidgetError('PERMISSION_DENIED', '不能修改其他实例的数据');
    const other = this.dao.getInstance(target);
    if (!other) throw new WidgetError('NOT_FOUND', `被引用的实例 ${target} 不存在`);
    if (!ctx.manifest.imports.includes(`${other.widgetId}.${collection}`)) {
      throw new WidgetError('PERMISSION_DENIED', `组件清单未在 imports 中声明 ${other.widgetId}.${collection}`);
    }
    return { scopeId: target, collection };
  }

  notifyDataChanged(scopeId, collection) {
    this.broadcast('widget:data-changed', { instanceId: scopeId, collection, at: Date.now() });
  }

  async handleRpc(ref, method, params = {}, context = {}) {
    const ctx = this.resolveContext(ref);
    switch (method) {
      case 'data.query': {
        const { scopeId, collection } = this.resolveDataTarget(ctx, params, 'read');
        let records = this.dao.listRecords(scopeId, collection);
        if (params.where) records = records.filter((record) => matchesWhere(record, params.where));
        if (params.orderBy) records.sort(compareBy(String(params.orderBy), Boolean(params.desc)));
        const offset = Math.max(0, Number(params.offset) || 0);
        const limit = params.limit ? Math.max(0, Number(params.limit)) : undefined;
        return limit === undefined ? records.slice(offset) : records.slice(offset, offset + limit);
      }
      case 'data.get': {
        const { scopeId, collection } = this.resolveDataTarget(ctx, params, 'read');
        return this.dao.getRecord(scopeId, collection, String(params.id));
      }
      case 'data.insert': {
        const { scopeId, collection } = this.resolveDataTarget(ctx, params, 'write');
        const items = Array.isArray(params.items) ? params.items : [];
        if (!items.length) return [];
        if (items.length > 1000) throw new WidgetError('TOO_MANY', '单次最多插入 1000 条记录');
        const records = this.dao.insertRecords(scopeId, collection, items.map((item) => (item && typeof item === 'object' ? item : { value: item })));
        this.notifyDataChanged(scopeId, collection);
        return records;
      }
      case 'data.update': {
        const { scopeId, collection } = this.resolveDataTarget(ctx, params, 'write');
        const record = this.dao.updateRecord(scopeId, collection, String(params.id), params.patch || {}, { replace: Boolean(params.replace) });
        if (!record) throw new WidgetError('NOT_FOUND', `记录 ${params.id} 不存在`);
        this.notifyDataChanged(scopeId, collection);
        return record;
      }
      case 'data.delete': {
        const { scopeId, collection } = this.resolveDataTarget(ctx, params, 'write');
        const removed = this.dao.deleteRecord(scopeId, collection, String(params.id));
        if (removed) this.notifyDataChanged(scopeId, collection);
        return removed;
      }
      case 'data.collections':
        return this.dao.listCollections(ctx.scopeId);

      case 'notes.list': {
        this.assertPermission(ctx, 'notes:read');
        const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 200);
        if (params.source === 'clip') {
          // 剪藏的笔记（按剪藏时间倒序）
          const rows = this.getDB().prepare(`
            SELECT * FROM notes WHERE is_deleted = 0 AND meta IS NOT NULL AND json_extract(meta, '$.source.type') = 'clip'
            ORDER BY created_at DESC LIMIT ?
          `).all(limit);
          return rows.map((note) => {
            const picked = pickNote(note);
            if (!params.withContent) delete picked.content;
            return picked;
          });
        }
        const result = await this.noteService.getNotes({
          search: params.search || null,
          tags: params.tag ? [String(params.tag)] : null,
          category: params.category || null,
          limit,
          sortBy: params.orderBy === 'created_at' ? 'created_at' : 'updated_at',
          pinnedFirst: false,
        });
        return (result?.data?.notes || []).map((note) => {
          const picked = pickNote(note);
          if (!params.withContent) delete picked.content;
          return picked;
        });
      }
      case 'notes.get': {
        this.assertPermission(ctx, 'notes:read');
        const note = this.noteDAO.findBySyncId(String(params.id)) || this.noteDAO.findById(Number(params.id));
        return note && !note.is_deleted ? pickNote(note) : null;
      }
      case 'notes.create': {
        this.assertPermission(ctx, 'notes:write');
        const result = await this.noteService.createNote({
          title: params.title || '',
          content: params.content || '',
          tags: params.tags || [],
          category: params.category || 'default',
        });
        if (!result?.success) throw new WidgetError('SAVE_FAILED', result?.error || '创建笔记失败');
        return pickNote(result.data);
      }
      case 'notes.update': {
        this.assertPermission(ctx, 'notes:write');
        const note = this.noteDAO.findBySyncId(String(params.id)) || this.noteDAO.findById(Number(params.id));
        if (!note) throw new WidgetError('NOT_FOUND', '笔记不存在');
        const patch = {};
        if (typeof params.title === 'string') patch.title = params.title;
        if (typeof params.content === 'string') patch.content = params.content;
        const result = await this.noteService.updateNote(note.id, patch);
        if (result && result.success === false) throw new WidgetError('SAVE_FAILED', result.error || '更新笔记失败');
        return pickNote(this.noteDAO.findById(note.id));
      }

      case 'todos.list': {
        this.assertPermission(ctx, 'todos:read');
        let todos = this.todoService.getAllTodos({ includeCompleted: params.filter !== 'pending' }) || [];
        if (params.filter === 'completed') todos = todos.filter((todo) => todo.is_completed);
        if (params.filter === 'today') {
          const day = today();
          todos = todos.filter((todo) => String(todo.due_date || '').slice(0, 10) === day);
        }
        if (params.tag) todos = todos.filter((todo) => String(todo.tags || '').split(',').map((t) => t.trim()).includes(params.tag));
        return todos.slice(0, Math.min(Math.max(Number(params.limit) || 200, 1), 1000));
      }
      case 'todos.create': {
        this.assertPermission(ctx, 'todos:write');
        const todo = this.todoService.createTodo({ ...(params || {}) });
        this.broadcast('todo:changed', { source: 'widget' });
        return todo;
      }
      case 'todos.update': {
        this.assertPermission(ctx, 'todos:write');
        const { id, ...patch } = params || {};
        const todo = typeof patch.is_completed === 'boolean' && Object.keys(patch).length === 1
          ? this.toggleTodoTo(id, patch.is_completed)
          : this.todoService.updateTodo(id, patch);
        this.broadcast('todo:changed', { source: 'widget' });
        return todo;
      }

      case 'ai.complete':
        return this.completeWithAI(ctx, params);

      // 界面状态：按实例 + 放置位置区分（同一实例在笔记里和首页可以停在不同的页签）
      case 'state.get':
        return this.getStorage(ctx.widgetId || ctx.scopeId, `state:${ctx.scopeId}:${context.placement || 'default'}:${params.key}`, null);
      case 'state.set':
        this.setStorage(ctx.widgetId || ctx.scopeId, `state:${ctx.scopeId}:${context.placement || 'default'}:${params.key}`, params.value ?? null);
        return true;

      default:
        throw new WidgetError('UNKNOWN_METHOD', `未知的组件调用：${method}`);
    }
  }

  toggleTodoTo(id, completed) {
    const todo = this.todoService.getTodoById(id);
    if (!todo) throw new WidgetError('NOT_FOUND', '待办不存在');
    if (Boolean(todo.is_completed) === completed && (!todo.repeat_type || todo.repeat_type === 'none')) return todo;
    return this.todoService.toggleTodoComplete(id);
  }

  async completeWithAI(ctx, params) {
    this.assertPermission(ctx, 'ai:complete');
    if (!this.aiService) throw new WidgetError('AI_UNAVAILABLE', 'AI 服务未初始化');
    const owner = ctx.widgetId || ctx.scopeId;
    const usageKey = `aiUsage:${today()}`;
    const used = Number(this.getStorage(owner, usageKey, 0)) || 0;
    if (used >= AI_DAILY_LIMIT) {
      throw new WidgetError('QUOTA_EXCEEDED', `这个组件今天的 AI 调用已达上限（${AI_DAILY_LIMIT} 次）`);
    }
    const messages = Array.isArray(params.messages)
      ? params.messages.filter((m) => m && typeof m.content === 'string' && ['system', 'user', 'assistant'].includes(m.role))
      : [
        ...(params.system ? [{ role: 'system', content: String(params.system) }] : []),
        { role: 'user', content: String(params.prompt || '') },
      ];
    if (!messages.some((m) => m.role === 'user' && m.content.trim())) {
      throw new WidgetError('INVALID_PARAMS', 'AI 调用缺少 prompt');
    }
    this.setStorage(owner, usageKey, used + 1);
    const result = await this.aiService.chat(messages, { temperature: params.temperature, bypassTokenLimit: true, timeoutMs: 120000 });
    if (!result?.success) throw new WidgetError('AI_FAILED', result?.error || 'AI 调用失败');
    const content = result.data?.content || '';
    if (!params.json) return content;
    const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      throw new WidgetError('AI_BAD_JSON', 'AI 返回的内容不是合法 JSON');
    }
  }

  // AI 对话写入实例数据（add_widget_records 工具）
  addRecordsFromAI(instanceId, collection, records) {
    if (!this.dao.getInstance(instanceId)) throw new WidgetError('NOT_FOUND', '实例不存在');
    if (typeof collection !== 'string' || !COLLECTION_RE.test(collection)) throw new WidgetError('INVALID_COLLECTION', `集合名不合法：${collection}`);
    const items = (Array.isArray(records) ? records : []).filter((item) => item && typeof item === 'object').slice(0, 1000);
    if (!items.length) throw new WidgetError('INVALID_PARAMS', '没有要写入的记录');
    const inserted = this.dao.insertRecords(instanceId, collection, items);
    this.notifyDataChanged(instanceId, collection);
    return inserted.length;
  }
}

WidgetService.WidgetError = WidgetError;
WidgetService.DRAFT_PREFIX = DRAFT_PREFIX;

module.exports = WidgetService;
