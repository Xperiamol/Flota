/**
 * 桌面组件：把组件实例固定在桌面上（独立的无边框小窗口）。
 *
 * 记住每个桌面组件的位置、大小、显示尺寸（卡片 compact / 展开 medium）和是否置顶，
 * 下次启动时按设置自动恢复。只保存在本机（不随同步），各台电脑的桌面布局互不影响。
 * 用户点小窗上的 × 是「从桌面移除」；退出应用时窗口随之关闭，但仍保留在桌面列表里。
 */
const STORAGE_KEY = 'desktop_widgets';
const RESTORE_KEY = 'desktop_widgets_restore';
const SAVE_DELAY_MS = 400;
const SIZES = ['compact', 'medium'];
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
      return Array.isArray(list) ? list.filter((entry) => entry && typeof entry.instanceId === 'string') : [];
    } catch (_) {
      return [];
    }
  }

  _write(list) {
    this.settingDAO.set(STORAGE_KEY, JSON.stringify(list), 'string', '固定在桌面的组件（仅本机）');
  }

  _update(instanceId, changes) {
    const list = this.list();
    const index = list.findIndex((entry) => entry.instanceId === instanceId);
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

  async _open(entry) {
    const bounds = this._visibleBounds(entry.bounds, entry.size);
    await this.windowManager.createWidgetWindow(entry.instanceId, {
      size: entry.size,
      bounds,
      alwaysOnTop: entry.alwaysOnTop === true,
      desktop: true,
    });
    const win = this.windowManager.widgetWindows?.get(entry.instanceId);
    if (!win || win.isDestroyed()) return;
    const saveBounds = () => {
      clearTimeout(this.saveTimers.get(entry.instanceId));
      this.saveTimers.set(entry.instanceId, setTimeout(() => {
        if (!win.isDestroyed()) this._update(entry.instanceId, { bounds: win.getBounds() });
      }, SAVE_DELAY_MS));
    };
    win.on('moved', saveBounds);
    win.on('resized', saveBounds);
    win.on('always-on-top-changed', (_event, onTop) => this._update(entry.instanceId, { alwaysOnTop: Boolean(onTop) }));
    win.on('closed', () => {
      clearTimeout(this.saveTimers.get(entry.instanceId));
      // 用户手动关掉 = 从桌面移除；退出应用时关闭的窗口下次还要恢复
      if (!this.quitting && !win.flotaReloading) this._remove(entry.instanceId);
    });
    if (!entry.bounds) this._update(entry.instanceId, { bounds: win.getBounds() });
  }

  _remove(instanceId) {
    this._write(this.list().filter((entry) => entry.instanceId !== instanceId));
  }

  /** 固定到桌面：已经在桌面上就把它找出来；否则按请求的尺寸打开并记住 */
  async pin(instanceId, { size = 'compact' } = {}) {
    if (!this._info(instanceId)) throw new Error('组件实例不存在');
    const existing = this.windowManager.widgetWindows?.get(instanceId);
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return { reused: true };
    }
    const resolved = this._resolveSize(instanceId, size);
    const list = this.list();
    let entry = list.find((item) => item.instanceId === instanceId);
    if (!entry) {
      entry = { instanceId, size: resolved, alwaysOnTop: false, bounds: null, pinnedAt: Date.now() };
      this._write([...list, entry]);
    }
    await this._open(entry);
    return { pinned: true, size: entry.size };
  }

  unpin(instanceId) {
    this._remove(instanceId);
    const win = this.windowManager.widgetWindows?.get(instanceId);
    if (win && !win.isDestroyed()) win.close();
    return true;
  }

  /** 在卡片和展开之间切换：换尺寸后按新尺寸的默认高度调整窗口，并重新载入 */
  async setSize(instanceId, size) {
    const resolved = this._resolveSize(instanceId, size);
    const win = this.windowManager.widgetWindows?.get(instanceId);
    const current = win && !win.isDestroyed() ? win.getBounds() : null;
    const bounds = current ? { ...current, height: DEFAULT_BOUNDS[resolved].height, width: Math.max(current.width, DEFAULT_BOUNDS[resolved].width - 40) } : null;
    const entry = this._update(instanceId, { size: resolved, ...(bounds ? { bounds } : {}) });
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
      if (!this._info(entry.instanceId)) {
        this._remove(entry.instanceId);
        continue;
      }
      try {
        await this._open(entry);
        restored += 1;
      } catch (error) {
        this.logger.warn?.('[DesktopWidgets] 恢复失败', entry.instanceId, error?.message);
      }
    }
    return restored;
  }

  markQuitting() {
    this.quitting = true;
  }
}

DesktopWidgets.DEFAULT_BOUNDS = DEFAULT_BOUNDS;
module.exports = DesktopWidgets;
