/**
 * 组件同步（独立于主 manifest）
 *
 * 远端布局（widgets/v2/）：
 *   manifest.json            { version, widgets: { [id]: 组件条目 }, instances: { [id]: 实例条目 } }
 *   code/<widgetId>.html     组件代码（单文件 HTML）
 *   data/<instanceId>.json   实例数据 { version, records: [...] }（含删除墓碑）
 *
 * 之所以不放进主 manifest：Android 端会把主 manifest 里不认识的条目当成笔记下载，
 * 且写回时会丢弃未知顶层字段。独立目录让旧版本客户端完全感知不到组件。
 *
 * 组件代码与实例元数据：与笔记一致的三方比较（远端 / 本地 / 上次同步缓存），双端都改时时间戳较新者胜。
 * 实例数据：按记录 updated_at 逐条合并（可交换、幂等），合并后与远端不一致才上传。
 */

const fs = require('fs');
const path = require('path');
const hashUtils = require('./utils/hash');
const WidgetDAO = require('../../dao/WidgetDAO');

const MANIFEST_VERSION = 2;

const notifyRenderer = (channel, payload) => {
  try {
    const { BrowserWindow } = require('electron');
    if (!BrowserWindow) return;
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    });
  } catch {
    // 独立运行（测试）时没有窗口
  }
};

// 三方比较：返回 'download' | 'upload' | 'none'
const decide = (remote, local, cached) => {
  if (remote && !local) return 'download';
  if (local && !remote) return 'upload';
  if (!remote && !local) return 'none';
  if (remote.h === local.h) return 'none';
  const remoteChanged = !cached || cached.h !== remote.h;
  const localChanged = !cached || cached.h !== local.h;
  if (remoteChanged && !localChanged) return 'download';
  if (localChanged && !remoteChanged) return 'upload';
  return (remote.t || 0) >= (local.t || 0) ? 'download' : 'upload';
};

class WidgetSync {
  /**
   * @param {object} options
   * @param {import('./webdavClient')} options.client
   * @param {string} options.rootPath 以 / 结尾
   * @param {string} options.cachePath 本地缓存 manifest 路径
   * @param {(...args: any[]) => void} [options.log]
   */
  constructor({ client, rootPath, cachePath, log }) {
    this.client = client;
    this.dir = `${rootPath}widgets/v2/`;
    this.cachePath = cachePath;
    this.log = log || (() => {});
    this.dao = new WidgetDAO();
  }

  hash(value) {
    return hashUtils.calculateHash(JSON.stringify(value));
  }

  widgetEntry(widget) {
    return {
      h: this.hash([widget.name, widget.code, widget.pinned, widget.isDeleted, widget.source, widget.storeId]),
      t: widget.updatedAt,
      c: widget.createdAt,
      name: widget.name,
      pinned: widget.pinned,
      source: widget.source,
      storeId: widget.storeId,
      d: widget.isDeleted ? 1 : 0,
      deletedAt: widget.deletedAt,
    };
  }

  instanceEntry(instance) {
    return {
      h: this.hash([instance.widgetId, instance.name, instance.isDeleted]),
      t: instance.updatedAt,
      c: instance.createdAt,
      widgetId: instance.widgetId,
      name: instance.name,
      d: instance.isDeleted ? 1 : 0,
      deletedAt: instance.deletedAt,
    };
  }

  loadCache() {
    try {
      if (!fs.existsSync(this.cachePath)) return { widgets: {}, instances: {} };
      const parsed = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
      return { widgets: parsed.widgets || {}, instances: parsed.instances || {} };
    } catch (error) {
      this.log('[WidgetSync] 读取本地缓存失败，按首次同步处理', error.message);
      return { widgets: {}, instances: {} };
    }
  }

  saveCache(manifest) {
    const tmp = `${this.cachePath}.tmp`;
    fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
    fs.renameSync(tmp, this.cachePath);
  }

  async loadRemoteManifest() {
    try {
      if (!(await this.client.exists(`${this.dir}manifest.json`))) return { widgets: {}, instances: {} };
      const remote = await this.client.downloadJson(`${this.dir}manifest.json`);
      return { widgets: remote?.widgets || {}, instances: remote?.instances || {} };
    } catch (error) {
      if (/404/.test(error.message)) return { widgets: {}, instances: {} };
      throw error;
    }
  }

  async ensureDirectories() {
    for (const dir of [`${this.dir.replace(/v2\/$/, '')}`, this.dir, `${this.dir}code/`, `${this.dir}data/`]) {
      try {
        await this.client.createDirectory(dir);
      } catch (error) {
        if (!/405|409|301/.test(error.message || '')) throw error;
      }
    }
  }

  async syncWidget(id, remote, local, cached, stats) {
    const action = decide(remote, local, cached);
    if (action === 'none') return local || remote;
    if (action === 'download') {
      const code = remote.d ? (this.dao.getWidget(id, { includeDeleted: true })?.code || '') : await this.client.downloadText(`${this.dir}code/${id}.html`);
      this.dao.upsertWidgetFromSync({
        id, name: remote.name, code, source: remote.source, storeId: remote.storeId, pinned: remote.pinned,
        createdAt: remote.c, updatedAt: remote.t, isDeleted: Boolean(remote.d), deletedAt: remote.deletedAt,
      });
      if (!remote.d) this.dao.addVersion(id, code, '从其他设备同步');
      stats.downloaded++;
      stats.changed = true;
      return remote;
    }
    const widget = this.dao.getWidget(id, { includeDeleted: true });
    if (!widget.isDeleted) await this.client.uploadText(`${this.dir}code/${id}.html`, widget.code || '', 'text/html; charset=utf-8');
    stats.uploaded++;
    return local;
  }

  syncInstanceMeta(id, remote, local, cached, stats) {
    const action = decide(remote, local, cached);
    if (action === 'download') {
      this.dao.upsertInstanceFromSync({
        id, widgetId: remote.widgetId, name: remote.name, createdAt: remote.c, updatedAt: remote.t,
        isDeleted: Boolean(remote.d), deletedAt: remote.deletedAt,
      });
      stats.downloaded++;
      stats.changed = true;
      return remote;
    }
    if (action === 'upload') stats.uploaded++;
    return action === 'upload' ? local : (local || remote);
  }

  async syncData(id, remoteEntry, stats) {
    let local = this.dao.exportForSync(id);
    let localHash = this.hash(local);
    const remoteHash = remoteEntry?.dh || null;
    if (remoteHash === localHash) return localHash;
    if (remoteHash) {
      const remote = await this.client.downloadJson(`${this.dir}data/${id}.json`);
      const applied = this.dao.mergeFromSync(id, Array.isArray(remote?.records) ? remote.records : []);
      if (applied > 0) {
        notifyRenderer('widget:data-changed', { instanceId: id, collection: '*', at: Date.now() });
        local = this.dao.exportForSync(id);
        localHash = this.hash(local);
      }
    }
    if (localHash !== remoteHash && local.length > 0) {
      await this.client.uploadJson(`${this.dir}data/${id}.json`, { version: MANIFEST_VERSION, records: local });
      stats.uploaded++;
      return localHash;
    }
    return remoteHash || localHash;
  }

  /**
   * @returns {Promise<{ uploaded: number, downloaded: number, errors: number, errorDetails: string[] }>}
   */
  async run() {
    const stats = { uploaded: 0, downloaded: 0, errors: 0, errorDetails: [], changed: false };
    await this.ensureDirectories();

    const remote = await this.loadRemoteManifest();
    const cache = this.loadCache();
    const localWidgets = Object.fromEntries(this.dao.listWidgets({ includeDeleted: true }).map((w) => [w.id, this.widgetEntry(w)]));
    const localInstances = Object.fromEntries(this.dao.listAllInstances({ includeDeleted: true }).map((i) => [i.id, this.instanceEntry(i)]));
    const result = { widgets: {}, instances: {} };

    for (const id of new Set([...Object.keys(remote.widgets), ...Object.keys(localWidgets)])) {
      try {
        // 从未同步过就已删除的组件，不需要在远端留下记录
        if (!remote.widgets[id] && localWidgets[id]?.d) continue;
        result.widgets[id] = await this.syncWidget(id, remote.widgets[id], localWidgets[id], cache.widgets[id], stats);
      } catch (error) {
        stats.errors++;
        stats.errorDetails.push(`组件 ${id}: ${error.message}`);
        if (remote.widgets[id]) result.widgets[id] = remote.widgets[id];
      }
    }

    for (const id of new Set([...Object.keys(remote.instances), ...Object.keys(localInstances)])) {
      try {
        if (!remote.instances[id] && localInstances[id]?.d) continue;
        const entry = this.syncInstanceMeta(id, remote.instances[id], localInstances[id], cache.instances[id], stats);
        // 已删除的实例不再同步数据，但保留远端数据文件，恢复后可以继续使用
        const dh = entry.d ? (remote.instances[id]?.dh || null) : await this.syncData(id, remote.instances[id], stats);
        result.instances[id] = { ...entry, dh };
      } catch (error) {
        stats.errors++;
        stats.errorDetails.push(`实例 ${id}: ${error.message}`);
        if (remote.instances[id]) result.instances[id] = remote.instances[id];
      }
    }

    // 写回前重新拉取远端，保留这段时间内其他设备新增的条目
    const latest = await this.loadRemoteManifest();
    const merged = {
      version: MANIFEST_VERSION,
      updated_at: Date.now(),
      widgets: { ...latest.widgets, ...result.widgets },
      instances: { ...latest.instances, ...result.instances },
    };
    await this.client.uploadJson(`${this.dir}manifest.json`, merged);
    this.saveCache(merged);

    if (stats.changed) notifyRenderer('widget:list-changed', { at: Date.now(), reason: 'sync' });
    this.log(`[WidgetSync] 完成：上传 ${stats.uploaded}，下载 ${stats.downloaded}，错误 ${stats.errors}`);
    return stats;
  }
}

module.exports = WidgetSync;
