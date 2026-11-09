const { ipcMain, dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ok = (data) => ({ success: true, data });
const fail = (error) => ({ success: false, error: error?.message || String(error), code: error?.code || 'ERROR' });

/**
 * 组件相关 IPC。组件（小应用）以 widgetId 定位；运行、数据、放置一律以实例 id（或草稿 id）定位。
 */
const registerWidgetHandlers = (getWidgetService, getPluginManager, getDesktopWidgets = () => null) => {
  const handle = (channel, fn, { withEvent = false } = {}) => {
    ipcMain.handle(channel, async (event, ...args) => {
      const service = getWidgetService();
      if (!service) return { success: false, error: '组件服务尚未就绪', code: 'NOT_READY' };
      try {
        return ok(await (withEvent ? fn(service, event, ...args) : fn(service, ...args)));
      } catch (error) {
        if (!error?.code) console.error(`[Widget] ${channel} 失败:`, error);
        return fail(error);
      }
    });
  };

  // ---- 组件 ----
  handle('widget:list', (service) => service.listWidgets());
  handle('widget:get', (service, id) => service.getWidget(id, { withCode: true }));
  handle('widget:set-pinned', (service, id, pinned) => service.setPinned(id, pinned));
  handle('widget:delete', (service, id) => service.deleteWidget(id));
  handle('widget:versions', (service, id) => service.listVersions(id));
  handle('widget:rollback', (service, id, version) => service.rollback(id, version));
  handle('widget:approve', (service, id) => service.approve(id));
  handle('widget:approve-network', (service, id) => service.approveNetwork(id));
  handle('widget:decline-network', (service, id) => service.declineNetwork(id));
  handle('widget:ai-usage', (service, id) => service.getAiUsage(id));

  // ---- 实例 ----
  handle('widget:instances', (service, widgetId, options) => service.listInstances(widgetId, options || {}));
  handle('widget:all-instances', (service) => service.listAllInstances());
  handle('widget:instance-get', (service, id) => service.getInstance(id));
  handle('widget:instance-create', (service, widgetId, name) => service.createInstance(widgetId, name));
  handle('widget:instance-rename', (service, id, name) => service.renameInstance(id, name));
  handle('widget:instance-delete', (service, id) => service.deleteInstance(id));
  handle('widget:instance-restore', (service, id) => service.restoreInstance(id));
  handle('widget:data-overview', (service, instanceId) => service.dao.listCollections(instanceId).map((item) => ({
    ...item,
    records: service.dao.listRecords(instanceId, item.collection).slice(0, 500),
  })));

  // ---- 组件运行时调用：宿主渲染进程转发，身份由宿主决定 ----
  handle('widget:rpc', (service, ref, method, params, context) => service.handleRpc(ref, method, params || {}, context || {}));

  // ---- AI 编写的组件：对话智能体提交代码时建草稿并预跑（见 AIChatService._proposeWidget），确认后保存 ----
  handle('widget:save-draft', (service, draftId, options) => service.saveDraft(draftId, options || {}));
  handle('widget:draft-discard', (service, id) => service.discardDraft(id));

  // ---- 固定在桌面的组件 ----
  const desktop = (channel, fn) => ipcMain.handle(channel, async (_event, ...args) => {
    const manager = getDesktopWidgets();
    if (!manager) return { success: false, error: '桌面组件尚未就绪', code: 'NOT_READY' };
    try {
      return ok(await fn(manager, ...args));
    } catch (error) {
      return fail(error);
    }
  });
  // target：组件实例 id，或 { cardId } 表示首页内置卡片；其余接口用桌面卡片的 key（实例 id 或 home:卡片 id）
  desktop('widget:desktop-pin', (manager, target, options) => manager.pin(target, options || {}));
  desktop('widget:desktop-unpin', (manager, key) => manager.unpin(key));
  desktop('widget:desktop-set-size', (manager, key, size) => manager.setSize(key, size));
  desktop('widget:desktop-set-layer', (manager, key, layer) => manager.setLayer(key, layer));
  desktop('widget:desktop-list', (manager) => manager.list());
  desktop('widget:desktop-restore-get', (manager) => manager.getRestoreOnLaunch());
  desktop('widget:desktop-restore-set', (manager, enabled) => manager.setRestoreOnLaunch(enabled));
  desktop('widget:desktop-appearance-get', (manager) => manager.getAppearance());
  desktop('widget:desktop-appearance-set', (manager, changes) => manager.setAppearance(changes || {}));
  // 点击穿透时，鼠标移到桌面卡片的标题条 / 按钮上由页面通知，窗口临时恢复接收鼠标
  ipcMain.on('widget:desktop-mouse-capture', (event, capture) => {
    getDesktopWidgets()?.setMouseCapture(BrowserWindow.fromWebContents(event.sender), Boolean(capture));
  });
  // 对话智能体写好的组件代码：确认时草稿还在就直接用，过期（超过 6 小时或应用重启）就用卡片里的代码重建
  handle('widget:draft-ensure', (service, payload = {}) => {
    const draft = payload.draftId ? service.getDraft(payload.draftId) : null;
    const sizes = require('../services/widgets/manifest').parseManifest(payload.code).manifest?.sizes || null;
    if (draft && draft.code === payload.code) return { draftId: payload.draftId, reused: true, sizes };
    const widgetId = payload.widgetId || null;
    const instances = widgetId ? service.dao.listInstances(widgetId) : [];
    const preview = instances.find((item) => item.id === payload.instanceId)?.id || instances[0]?.id;
    return { draftId: service.createDraft(payload.code, { widgetId, cloneDataFrom: preview }), reused: false, sizes };
  });

  // ---- 导入导出 ----
  handle('widget:import-file', async (service, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: '导入组件',
      properties: ['openFile'],
      filters: [{ name: 'Flota 组件', extensions: ['html', 'htm'] }],
    });
    if (result.canceled || !result.filePaths?.[0]) return null;
    const code = fs.readFileSync(result.filePaths[0], 'utf-8');
    // 外部导入的组件需要用户首次运行时确认权限
    return service.createWidget({ code, source: 'import', trusted: false, versionNote: `从 ${path.basename(result.filePaths[0])} 导入` });
  }, { withEvent: true });

  handle('widget:export-file', async (service, event, id) => {
    const widget = service.getWidget(id, { withCode: true });
    const win = BrowserWindow.fromWebContents(event.sender);
    const safeName = (widget.name || 'widget').replace(/[\\/:*?"<>|]/g, '_');
    const result = await dialog.showSaveDialog(win, {
      title: '导出组件',
      defaultPath: `${safeName}.flota-widget.html`,
      filters: [{ name: 'Flota 组件', extensions: ['html'] }],
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, widget.code, 'utf-8');
    return result.filePath;
  }, { withEvent: true });

  // ---- 商店：注册表中 type 为 widget 的条目 ----
  const storeEntries = async () => {
    const manager = getPluginManager?.();
    if (!manager) return [];
    return (await manager.readRegistryFile()).filter((item) => item?.type === 'widget');
  };
  const findStoreEntry = async (storeId) => {
    const entry = (await storeEntries()).find((item) => item.id === storeId);
    if (!entry) throw Object.assign(new Error('商店中没有这个组件'), { code: 'NOT_FOUND' });
    return entry;
  };
  const resolveStorePath = (entry) => getPluginManager().resolveRegistrySourcePath(entry);
  handle('widget:store-list', async (service) => service.listStoreWidgets(await storeEntries(), resolveStorePath));
  handle('widget:store-install', async (service, storeId) => service.installFromStore(await findStoreEntry(storeId), resolveStorePath));
  handle('widget:store-preview', async (service, storeId) => service.createStorePreview(await findStoreEntry(storeId), resolveStorePath));
};

module.exports = { registerWidgetHandlers };
