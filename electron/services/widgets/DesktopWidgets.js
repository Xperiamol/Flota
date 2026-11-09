/**
 * 桌面卡片：把组件实例或首页内置卡片（今日待办、快速记录……）固定在桌面上（独立的无边框小窗口）。
 *
 * 记住每张桌面卡片的位置、大小、显示尺寸（组件可在卡片 compact / 展开 medium 间切换）和层级，
 * 下次启动时按设置自动恢复（不抢焦点）。只保存在本机（不随同步），各台电脑的桌面布局互不影响。
 * 用户点小窗上的 × 是「从桌面移除」；退出应用时窗口随之关闭，但仍保留在桌面列表里。
 *
 * 层级（layer）：
 *   desktop 贴在桌面（默认）：普通窗口层级，其他窗口可以盖住它；macOS 上在每个桌面空间都显示、不进调度中心；
 *           Windows 上是不占任务栏和 Alt+Tab 的工具窗口，「显示桌面」把它收起时立即放回。
 *           系统没有「固定在桌面底层又能点击」的接口（macOS 的桌面层窗口收不到鼠标事件），这是能做到的最接近的效果。
 *   top     置顶：始终浮在其他窗口上面。
 */
const STORAGE_KEY = 'desktop_widgets';
const RESTORE_KEY = 'desktop_widgets_restore';
const SAVE_DELAY_MS = 400;
const SIZES = ['compact', 'medium'];
const LAYERS = ['desktop', 'top'];
// 首页内置卡片的 id（与 src/store/useHomeStore.js 的 HOME_BUILTIN_CARDS 一致）
const HOME_CARD_IDS = new Set(['quick-note', 'todo-rate', 'todo-today', 'upcoming', 'recent-notes', 'todo-overdue', 'notes-overview', 'focus', 'heatmap', 'top-words', 'plugins', 'recent-clips', 'pinned-notes', 'review', 'tags']);
const HOME_PREFIX = 'home:';

/** 桌面卡片的唯一键：组件实例用实例 id，内置卡片用 home:卡片 id */
const keyOf = (entry) => (entry.cardId ? `${HOME_PREFIX}${entry.cardId}` : entry.instanceId);
/** 旧记录只有 alwaysOnTop 布尔值 */
const layerOf = (entry) => (LAYERS.includes(entry.layer) ? entry.layer : entry.alwaysOnTop === true ? 'top' : 'desktop');
const DEFAULT_BOUNDS = { compact: { width: 340, height: 300 }, medium: { width: 380, height: 520 } };

class DesktopWidgets {
  /**
   * @param {object} deps
   * @param {{ get: Function, set: Function }} deps.settingDAO
   * @param {object} deps.windowManager  提供 createWidgetWindow / widgetWindows
   * @param {object} deps.widgetService  校验实例是否存在、读取组件支持的尺寸
   * @param {object} [deps.screen]       electron.screen（测试时可注入）
   */
  constructor({ settingDAO, windowManager, widgetService, screen = null, logger = console }) {
    this.settingDAO = settingDAO;
    this.windowManager = windowManager;
    this.widgetService = widgetService;
    this.screen = screen;
    this.logger = logger;
    this.quitting = false;
    this.saveTimers = new Map();
  }

  // ---- 存储 ----

  list() {
    try {
      const raw = this.settingDAO.get(STORAGE_KEY)?.value;
      const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(list)
        ? list.filter((entry) => entry && (typeof entry.instanceId === 'string' || HOME_CARD_IDS.has(entry.cardId))).map((entry) => ({ ...entry, key: keyOf(entry), layer: layerOf(entry) }))
        : [];
    } catch (_) {
      return [];
    }
  }

  _write(list) {
    const stored = list.map(({ key, alwaysOnTop, ...entry }) => entry);
    this.settingDAO.set(STORAGE_KEY, JSON.stringify(stored), 'string', '固定在桌面的卡片（仅本机）');
  }

  _update(key, changes) {
    const list = this.list();
    const index = list.findIndex((entry) => entry.key === key);
    if (index < 0) return null;
    list[index] = { ...list[index], ...changes };
    this._write(list);
    return list[index];
  }

  getRestoreOnLaunch() {
    const value = this.settingDAO.get(RESTORE_KEY)?.value;
    return value !== false && value !== 'false';
  }

  setRestoreOnLaunch(enabled) {
    this.settingDAO.set(RESTORE_KEY, Boolean(enabled), 'boolean', '启动时恢复桌面组件');
    return this.getRestoreOnLaunch();
  }

  /** 卡片还在不在：内置卡片看 id 是否有效，组件看实例是否存在 */
  _exists(entry) {
    return entry.cardId ? HOME_CARD_IDS.has(entry.cardId) : Boolean(this._info(entry.instanceId));
  }

  /** 实例信息；不存在或已在回收站里时返回 null */
  _info(instanceId) {
    try {
      const info = this.widgetService.getInstance(instanceId);
      if (!info || info.instance?.deletedAt || info.widget?.deletedAt) return null;
      return info;
    } catch (_) {
      return null;
    }
  }

  // ---- 尺寸与位置 ----

  /** 组件不支持请求的尺寸时，退到它支持的另一个 */
  _resolveSize(instanceId, requested) {
    const info = this._info(instanceId);
    const declared = info?.widget?.manifest?.sizes;
    const supported = Array.isArray(declared) && declared.length ? SIZES.filter((size) => declared.includes(size)) : SIZES;
    if (supported.includes(requested)) return requested;
    return supported[0] || 'medium';
  }

  /** 保存的位置不在任何屏幕上（换了显示器）时，放回主屏幕右上角 */
  _visibleBounds(bounds, size) {
    const base = { ...DEFAULT_BOUNDS[size], ...(bounds || {}) };
    if (!this.screen || !Number.isFinite(base.x) || !Number.isFinite(base.y)) return this._defaultPosition(base);
    const onScreen = this.screen.getAllDisplays().some(({ workArea: area }) => (
      base.x + 40 > area.x && base.x < area.x + area.width - 40 && base.y >= area.y - 10 && base.y < area.y + area.height - 40
    ));
    return onScreen ? base : this._defaultPosition(base);
  }

  _defaultPosition(base) {
    if (!this.screen) return { width: base.width, height: base.height };
    const area = this.screen.getPrimaryDisplay().workArea;
    const offset = (this.list().length % 6) * 28;
    return { width: base.width, height: base.height, x: area.x + area.width - base.width - 32 - offset, y: area.y + 48 + offset };
  }

  // ---- 打开、固定、移除 ----

  async _open(entry, { inactive = false } = {}) {
    const key = keyOf(entry);
    const layer = layerOf(entry);
    const bounds = this._visibleBounds(entry.bounds, entry.size);
    await this.windowManager.createWidgetWindow(key, {
      ...(entry.cardId ? { cardId: entry.cardId } : {}),
      size: entry.size,
      bounds,
      alwaysOnTop: layer === 'top',
      layer,
      desktop: true,
      inactive,
    });
    const win = this.windowManager.widgetWindows?.get(key);
    if (!win || win.isDestroyed()) return;
    this._applyLayer(win, layer);
    const saveBounds = () => {
      clearTimeout(this.saveTimers.get(key));
      this.saveTimers.set(key, setTimeout(() => {
        if (!win.isDestroyed()) this._update(key, { bounds: win.getBounds() });
      }, SAVE_DELAY_MS));
    };
    win.on('moved', saveBounds);
    win.on('resized', saveBounds);
    win.on('always-on-top-changed', (_event, onTop) => this._update(key, { layer: onTop ? 'top' : 'desktop' }));
    // 贴在桌面：「显示桌面」（Windows 的 Win+D 等）把它收起时，马上放回原处且不抢焦点
    win.on('minimize', () => {
      if (layerOf(this.list().find((item) => item.key === key) || entry) !== 'desktop') return;
      setTimeout(() => {
        if (win.isDestroyed()) return;
        win.restore();
        win.showInactive();
      }, 0);
    });
    win.on('closed', () => {
      clearTimeout(this.saveTimers.get(key));
      // 用户手动关掉 = 从桌面移除；退出应用时关闭的窗口下次还要恢复
      if (!this.quitting && !win.flotaReloading) this._remove(key);
    });
    if (!entry.bounds) this._update(key, { bounds: win.getBounds() });
  }

  /** 按层级设置窗口：置顶浮在最上；贴在桌面是普通层级。两者都在每个 macOS 桌面空间显示 */
  _applyLayer(win, layer) {
    if (layer === 'top') win.setAlwaysOnTop(true, 'floating');
    else win.setAlwaysOnTop(false);
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: layer === 'top' });
      win.setHiddenInMissionControl?.(layer === 'desktop');
    }
  }

  _remove(key) {
    this._write(this.list().filter((entry) => entry.key !== key));
  }

  /**
   * 固定到桌面：已经在桌面上就把它找出来；否则打开并记住。
   * @param {string|{cardId: string}} target  组件实例 id，或 { cardId } 表示首页内置卡片
   */
  async pin(target, { size = 'compact' } = {}) {
    const entryBase = typeof target === 'object' && target?.cardId
      ? { cardId: String(target.cardId) }
      : { instanceId: String(target || '') };
    if (entryBase.cardId && !HOME_CARD_IDS.has(entryBase.cardId)) throw new Error('没有这张首页卡片');
    if (entryBase.instanceId && !this._info(entryBase.instanceId)) throw new Error('组件实例不存在');
    const key = keyOf(entryBase);
    const existing = this.windowManager.widgetWindows?.get(key);
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return { reused: true, key };
    }
    const list = this.list();
    let entry = list.find((item) => item.key === key);
    if (!entry) {
      entry = { ...entryBase, size: entryBase.cardId ? 'compact' : this._resolveSize(entryBase.instanceId, size), layer: 'desktop', bounds: null, pinnedAt: Date.now() };
      this._write([...list, entry]);
      entry = this.list().find((item) => item.key === key);
    }
    await this._open(entry);
    return { pinned: true, size: entry.size, key };
  }

  unpin(key) {
    this._remove(key);
    const win = this.windowManager.widgetWindows?.get(key);
    if (win && !win.isDestroyed()) win.close();
    return true;
  }

  /** 切换层级：贴在桌面 / 置顶 */
  setLayer(key, layer) {
    if (!LAYERS.includes(layer)) throw new Error(`layer 只能是 ${LAYERS.join(' / ')}`);
    const entry = this._update(key, { layer });
    const win = this.windowManager.widgetWindows?.get(key);
    if (win && !win.isDestroyed()) this._applyLayer(win, layer);
    return entry;
  }

  /** 在卡片和展开之间切换：换尺寸后按新尺寸的默认高度调整窗口，并重新载入 */
  async setSize(key, size) {
    const current0 = this.list().find((item) => item.key === key);
    if (!current0 || current0.cardId) return current0 || null; // 内置卡片只有一种尺寸
    const instanceId = current0.instanceId;
    const resolved = this._resolveSize(instanceId, size);
    const win = this.windowManager.widgetWindows?.get(key);
    const current = win && !win.isDestroyed() ? win.getBounds() : null;
    const bounds = current ? { ...current, height: DEFAULT_BOUNDS[resolved].height, width: Math.max(current.width, DEFAULT_BOUNDS[resolved].width - 40) } : null;
    const entry = this._update(key, { size: resolved, ...(bounds ? { bounds } : {}) });
    if (!entry) return null;
    if (win && !win.isDestroyed()) {
      // 关窗是异步的：等旧窗口真正关掉再按新尺寸打开，否则会被当成「已经打开」而直接复用
      win.flotaReloading = true;
      await new Promise((resolve) => { win.once('closed', resolve); win.close(); });
    }
    await this._open(entry);
    return entry;
  }

  /** 启动时恢复：设置允许时打开列表里的组件；实例已被删除的顺便清掉 */
  async restoreAll() {
    if (!this.getRestoreOnLaunch()) return 0;
    let restored = 0;
    for (const entry of this.list()) {
      if (!this._exists(entry)) {
        this._remove(entry.key);
        continue;
      }
      try {
        // 启动时恢复不抢焦点，免得打断正在做的事
        await this._open(entry, { inactive: true });
        restored += 1;
      } catch (error) {
        this.logger.warn?.('[DesktopWidgets] 恢复失败', entry.key, error?.message);
      }
    }
    return restored;
  }

  markQuitting() {
    this.quitting = true;
  }
}

DesktopWidgets.DEFAULT_BOUNDS = DEFAULT_BOUNDS;
DesktopWidgets.HOME_CARD_IDS = HOME_CARD_IDS;
module.exports = DesktopWidgets;
