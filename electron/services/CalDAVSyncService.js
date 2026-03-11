const { createDAVClient } = require('tsdav');
const ICAL = require('ical.js');
const TodoDAO = require('../dao/TodoDAO');
const SettingDAO = require('../dao/SettingDAO');
const { ipcMain } = require('electron');

/**
 * CalDAV 日历同步服务
 * 支持双向同步待办事项与外部日历
 */
class CalDAVSyncService {
  constructor() {
    this.todoDAO = new TodoDAO();
    this.settingDAO = new SettingDAO();
    this.davClient = null;
    this.syncInProgress = false;
    this.lastSyncTime = null;
    this.syncTimer = null;

    // 同步映射表 (本地 todo_id <-> 远程 calendar event UID)
    this.syncMappings = new Map();
    this._loadSyncMappings(); // 从持久化存储加载

    this.setupIpcHandlers();
  }

  /**
   * 初始化服务（应用启动时调用，恢复自动同步）
   */
  async initialize() {
    try {
      await this._ensureAutoSyncFromConfig();
    } catch (error) {
      console.error('[CalDAV] 初始化失败:', error);
    }
  }

  /**
   * 根据持久化配置恢复自动同步
   * @private
   */
  async _ensureAutoSyncFromConfig() {
    const config = await this.getConfig();
    if (config.enabled && config.serverUrl && config.calendarUrl) {
      const intervalMinutes = parseInt(config.syncInterval, 10);
      const safeMinutes = Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : 30;
      this.startAutoSync(safeMinutes * 60 * 1000);
    }
  }

  /**
   * 加载同步映射表
   * @private
   */
  _loadSyncMappings() {
    try {
      const mappings = this.settingDAO.get('caldav_sync_mappings');
      if (mappings?.value) {
        const data = JSON.parse(mappings.value);
        this.syncMappings = new Map(Object.entries(data));
        console.log(`[CalDAV] 加载同步映射表: ${this.syncMappings.size} 条记录`);
      }
    } catch (error) {
      console.error('[CalDAV] 加载同步映射表失败:', error);
    }
  }

  /**
   * 保存同步映射表
   * @private
   */
  _saveSyncMappings() {
    try {
      const data = Object.fromEntries(this.syncMappings.entries());
      this.settingDAO.set('caldav_sync_mappings', JSON.stringify(data));
      console.log(`[CalDAV] 保存同步映射表: ${this.syncMappings.size} 条记录`);
    } catch (error) {
      console.error('[CalDAV] 保存同步映射表失败:', error);
    }
  }

  /**
   * 创建统一的 IPC handler（带错误处理）
   */
  createHandler(methodName, errorMsg, wrapData = true) {
    return async (event, ...args) => {
      try {
        const result = await this[methodName](...args);
        return wrapData && result !== undefined ? { success: true, data: result } : { success: true };
      } catch (error) {
        console.error(`[CalDAV] ${errorMsg}:`, error);
        return { success: false, error: error.message };
      }
    };
  }

  /**
   * 设置 IPC 处理器
   */
  setupIpcHandlers() {
    const handlers = [
      ['caldav:test-connection', 'testConnection', '连接测试失败'],
      ['caldav:save-config', 'saveConfig', '保存配置失败', false],
      ['caldav:get-config', 'getConfig', '获取配置失败'],
      ['caldav:sync', 'syncNow', '同步失败'],
      ['caldav:get-status', 'getSyncStatus', '获取状态失败']
    ];

    handlers.forEach(([channel, method, errorMsg, wrapData = true]) => {
      ipcMain.handle(channel, this.createHandler(method, errorMsg, wrapData));
    });
  }

  /**
   * 测试 CalDAV 连接
   * @param {object} config - CalDAV 配置
   * @returns {Promise<object>}
   */
  async testConnection(config) {
    console.log('[CalDAV] 测试连接:', config.serverUrl);

    try {
      const client = await createDAVClient({
        serverUrl: config.serverUrl,
        credentials: {
          username: config.username,
          password: config.password,
        },
        authMethod: 'Basic',
        defaultAccountType: 'caldav',
      });

      // 获取日历列表
      const calendars = await client.fetchCalendars();

      console.log('[CalDAV] 连接成功,找到', calendars.length, '个日历');

      return {
        connected: true,
        calendars: calendars.map(cal => ({
          displayName: cal.displayName,
          url: cal.url,
          ctag: cal.ctag,
          description: cal.description,
          timezone: cal.timezone,
        })),
      };
    } catch (error) {
      console.error('[CalDAV] 连接失败:', error.message);

      // 提供更友好的错误信息
      let friendlyMessage = error.message;

      if (error.message.includes('ETIMEDOUT') || error.message.includes('ECONNREFUSED')) {
        friendlyMessage = '连接超时。可能原因：\n' +
          '1. 服务器地址不正确\n' +
          '2. 网络连接问题（Google服务可能需要代理）\n' +
          '3. 防火墙阻止了连接\n\n' +
          '建议：检查网络连接或尝试使用 iCloud';
      } else if (error.message.includes('401') || error.message.includes('Unauthorized')) {
        friendlyMessage = '认证失败：用户名或密码错误\n' +
          '提示：Google Calendar 需要使用"应用专用密码"而非账户密码';
      } else if (error.message.includes('404')) {
        friendlyMessage = '服务器地址不正确或日历不存在';
      }

      throw new Error(friendlyMessage);
    }
  }

  /**
   * 保存 CalDAV 配置
   * @param {object} config - CalDAV 配置
   */
  async saveConfig(config) {
    console.log('[CalDAV] 保存配置');

    await this.settingDAO.set('caldav_enabled', config.enabled ? '1' : '0');
    await this.settingDAO.set('caldav_server_url', config.serverUrl);
    await this.settingDAO.set('caldav_username', config.username);
    await this.settingDAO.set('caldav_password', config.password);
    await this.settingDAO.set('caldav_calendar_url', config.calendarUrl);
    await this.settingDAO.set('caldav_sync_interval', config.syncInterval || '30');
    await this.settingDAO.set('caldav_sync_direction', config.syncDirection || 'bidirectional');

    // 如果启用了自动同步,开始定时任务
    if (config.enabled) {
      this.startAutoSync(parseInt(config.syncInterval) * 60 * 1000);
    } else {
      this.stopAutoSync();
    }
  }

  /**
   * 获取 CalDAV 配置
   * @returns {Promise<object>}
   */
  async getConfig() {
    const getSettingValue = async (key, defaultValue = '') => {
      const setting = await this.settingDAO.get(key);
      return setting ? setting.value : defaultValue;
    };

    const config = {
      enabled: (await getSettingValue('caldav_enabled', '0')) === '1',
      serverUrl: await getSettingValue('caldav_server_url', ''),
      username: await getSettingValue('caldav_username', ''),
      password: await getSettingValue('caldav_password', ''),
      calendarUrl: await getSettingValue('caldav_calendar_url', ''),
      syncInterval: await getSettingValue('caldav_sync_interval', '30'),
      syncDirection: await getSettingValue('caldav_sync_direction', 'bidirectional'),
    };

    return config;
  }

  /**
   * 初始化 DAV 客户端
   */
  async initClient() {
    if (this.davClient) {
      return this.davClient;
    }

    const config = await this.getConfig();

    if (!config.enabled || !config.serverUrl) {
      throw new Error('CalDAV 未配置或未启用');
    }

    this.davClient = await createDAVClient({
      serverUrl: config.serverUrl,
      credentials: {
        username: config.username,
        password: config.password,
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });

    return this.davClient;
  }

  /**
   * 立即执行同步
   * @returns {Promise<object>}
   */
  async syncNow() {
    if (this.syncInProgress) {
      throw new Error('同步正在进行中');
    }

    console.log('[CalDAV] 开始同步...');
    this.syncInProgress = true;

    try {
      const config = await this.getConfig();
      const client = await this.initClient();

      const result = {
        timestamp: new Date().toISOString(),
        localToRemote: 0,
        remoteToLocal: 0,
        conflicts: 0,
        errors: [],
      };

      // 双向同步
      if (config.syncDirection === 'bidirectional' || config.syncDirection === 'upload') {
        const uploaded = await this.syncLocalToRemote(client, config);
        result.localToRemote = uploaded;
      }

      if (config.syncDirection === 'bidirectional' || config.syncDirection === 'download') {
        const downloaded = await this.syncRemoteToLocal(client, config);
        result.remoteToLocal = downloaded;
      }

      this.lastSyncTime = new Date();
      await this.settingDAO.set('caldav_last_sync', this.lastSyncTime.toISOString());

      console.log('[CalDAV] 同步完成:', result);
      return result;

    } catch (error) {
      console.error('[CalDAV] 同步失败:', error);
      throw error;
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * 同步本地待办到远程日历
   * @param {object} client - DAV 客户端
   * @param {object} config - 配置
   * @returns {Promise<number>} 上传数量
   */
  async syncLocalToRemote(client, config) {
    console.log('[CalDAV] 上传本地待办到日历...');

    // 获取所有待办（包括已完成的，以同步完成状态）
    const todos = this.todoDAO.findAll({ includeCompleted: true });
    let uploadCount = 0;

    for (const todo of todos) {
      try {
        // 检查是否已有同步记录
        const existingUid = this.syncMappings.get(`todo_${todo.id}`);

        if (existingUid) {
          // 更新现有事件
          await this.updateCalendarEvent(client, config, todo, existingUid);
        } else {
          // 创建新事件
          const uid = await this.createCalendarEvent(client, config, todo);
          this.syncMappings.set(`todo_${todo.id}`, uid);
        }

        uploadCount++;
      } catch (error) {
        console.error(`[CalDAV] 上传待办 ${todo.id} 失败:`, error.message);
      }
    }

    // 同步完成后保存映射表
    this._saveSyncMappings();

    console.log(`[CalDAV] 上传完成: ${uploadCount}/${todos.length}`);
    return uploadCount;
  }

  /**
   * 同步远程日历到本地待办
   * @param {object} client - DAV 客户端
   * @param {object} config - 配置
   * @returns {Promise<number>} 下载数量
   */
  async syncRemoteToLocal(client, config) {
    console.log('[CalDAV] 下载日历事件到本地...');

    // 获取日历中的所有待办事项 (VTODO)
    const calendar = await client.fetchCalendarObjects({
      calendar: { url: config.calendarUrl },
      objectType: 'VTODO', // 或者 'VEVENT' 取决于你要同步事件还是待办
    });

    let downloadCount = 0;

    for (const calObj of calendar) {
      try {
        const jcalData = ICAL.parse(calObj.data);
        const comp = new ICAL.Component(jcalData);
        const vtodo = comp.getFirstSubcomponent('vtodo');

        if (!vtodo) continue;

        const uid = vtodo.getFirstPropertyValue('uid');
        const summary = vtodo.getFirstPropertyValue('summary');
        const description = vtodo.getFirstPropertyValue('description');
        const due = vtodo.getFirstPropertyValue('due');
        const status = vtodo.getFirstPropertyValue('status');
        const priority = vtodo.getFirstPropertyValue('priority');
        const categories = vtodo.getFirstPropertyValue('categories');

        // 从优先级字段解析重要性（priority为1-9，1最高）
        const is_important = priority && parseInt(priority) <= 5 ? 1 : 0;
        // 从categories字段读取紧急性标记
        const is_urgent = categories && categories.includes('URGENT') ? 1 : 0;

        // 检查是否已存在
        const localTodo = this.findTodoByUid(uid);

        if (localTodo) {
          // 更新本地待办（保留本地的is_important和is_urgent设置，以及原有的due_date完整时间戳）
          const updateData = {
            content: summary,
            description: description || '',
            completed: status === 'COMPLETED' ? 1 : 0,
          };

          // 只有当远程due日期与本地不同时才更新（保留时间部分）
          if (due) {
            const remoteDueDate = due.toJSDate().toISOString().split('T')[0];
            const localDueDate = localTodo.due_date ? localTodo.due_date.split('T')[0] : null;

            if (remoteDueDate !== localDueDate) {
              // 保留原有时间部分，只更新日期
              if (localTodo.due_date && localTodo.due_date.includes('T')) {
                const localTime = localTodo.due_date.split('T')[1];
                updateData.due_date = `${remoteDueDate}T${localTime}`;
              } else {
                // 如果本地没有时间信息，使用默认时间
                updateData.due_date = `${remoteDueDate}T00:00:00.000Z`;
              }
            }
          } else if (localTodo.due_date) {
            // 远程没有due日期，清空本地
            updateData.due_date = null;
          }

          this.todoDAO.update(localTodo.id, updateData);
        } else {
          // 创建新待办
          const newTodo = this.todoDAO.create({
            content: summary,
            description: description || '',
            due_date: due ? due.toJSDate().toISOString() : null, // 保留完整时间戳
            completed: status === 'COMPLETED' ? 1 : 0,
            is_important: is_important,
            is_urgent: is_urgent,
          });

          // 记录映射
          this.syncMappings.set(`todo_${newTodo.id}`, uid);
        }

        downloadCount++;
      } catch (error) {
        console.error('[CalDAV] 下载事件失败:', error.message);
      }
    }

    // 同步完成后保存映射表
    this._saveSyncMappings();

    console.log(`[CalDAV] 下载完成: ${downloadCount}/${calendar.length}`);
    return downloadCount;
  }

  /**
   * 创建日历事件
   * @param {object} client - DAV 客户端
   * @param {object} config - 配置
   * @param {object} todo - 待办数据
   * @returns {Promise<string>} UID
   */
  async createCalendarEvent(client, config, todo) {
    const uid = `Flota-todo-${todo.id}-${Date.now()}@Flota.app`;

    // 创建 iCalendar VTODO 组件
    const comp = new ICAL.Component(['vcalendar', [], []]);
    comp.updatePropertyWithValue('prodid', '-//Flota//CalDAV Sync//EN');
    comp.updatePropertyWithValue('version', '2.0');

    const vtodo = new ICAL.Component('vtodo');
    vtodo.updatePropertyWithValue('uid', uid);
    vtodo.updatePropertyWithValue('summary', todo.content);
    vtodo.updatePropertyWithValue('description', todo.description || '');

    if (todo.due_date) {
      // 将完整的UTC时间戳转换为ICAL日期时间
      const dueDateTime = new Date(todo.due_date);
      const dueDate = ICAL.Time.fromJSDate(dueDateTime, false); // false = 使用UTC时间
      vtodo.updatePropertyWithValue('due', dueDate);
    }

    vtodo.updatePropertyWithValue('status', todo.completed ? 'COMPLETED' : 'NEEDS-ACTION');

    // 保存重要性到priority字段（1-9，1最高）
    if (todo.is_important) {
      vtodo.updatePropertyWithValue('priority', '1');
    } else {
      vtodo.updatePropertyWithValue('priority', '9');
    }

    // 保存紧急性到categories字段
    if (todo.is_urgent) {
      vtodo.updatePropertyWithValue('categories', 'URGENT');
    }

    comp.addSubcomponent(vtodo);

    // 上传到 CalDAV 服务器
    await client.createCalendarObject({
      calendar: { url: config.calendarUrl },
      filename: `${uid}.ics`,
      iCalString: comp.toString(),
    });

    console.log('[CalDAV] 创建事件成功:', uid);
    return uid;
  }

  /**
   * 更新日历事件
   * @param {object} client - DAV 客户端
   * @param {object} config - 配置
   * @param {object} todo - 待办数据
   * @param {string} uid - 事件 UID
   */
  async updateCalendarEvent(client, config, todo, uid) {
    // 类似 createCalendarEvent,但使用 updateCalendarObject
    const comp = new ICAL.Component(['vcalendar', [], []]);
    comp.updatePropertyWithValue('prodid', '-//Flota//CalDAV Sync//EN');
    comp.updatePropertyWithValue('version', '2.0');

    const vtodo = new ICAL.Component('vtodo');
    vtodo.updatePropertyWithValue('uid', uid);
    vtodo.updatePropertyWithValue('summary', todo.content);
    vtodo.updatePropertyWithValue('description', todo.description || '');

    if (todo.due_date) {
      // 将完整的UTC时间戳转换为ICAL日期时间
      const dueDateTime = new Date(todo.due_date);
      const dueDate = ICAL.Time.fromJSDate(dueDateTime, false); // false = 使用UTC时间
      vtodo.updatePropertyWithValue('due', dueDate);
    }

    vtodo.updatePropertyWithValue('status', todo.completed ? 'COMPLETED' : 'NEEDS-ACTION');

    // 保存重要性到priority字段（1-9，1最高）
    if (todo.is_important) {
      vtodo.updatePropertyWithValue('priority', '1');
    } else {
      vtodo.updatePropertyWithValue('priority', '9');
    }

    // 保存紧急性到categories字段
    if (todo.is_urgent) {
      vtodo.updatePropertyWithValue('categories', 'URGENT');
    }

    comp.addSubcomponent(vtodo);

    await client.updateCalendarObject({
      calendarObject: {
        url: `${config.calendarUrl}/${uid}.ics`,
        data: comp.toString(),
        etag: '', // 可以实现冲突检测
      },
    });

    console.log('[CalDAV] 更新事件成功:', uid);
  }

  /**
   * 根据 UID 查找本地待办
   * @param {string} uid - 事件 UID
   * @returns {object|null}
   */
  findTodoByUid(uid) {
    // 从映射表反查
    for (const [key, value] of this.syncMappings.entries()) {
      if (value === uid) {
        const todoId = parseInt(key.replace('todo_', ''));
        return this.todoDAO.getById(todoId);
      }
    }
    return null;
  }

  /**
   * 开始自动同步
   * @param {number} interval - 同步间隔 (毫秒)
   */
  startAutoSync(interval) {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }

    console.log(`[CalDAV] 启动自动同步,间隔: ${interval / 60000} 分钟`);

    this.syncTimer = setInterval(async () => {
      try {
        await this.syncNow();
      } catch (error) {
        console.error('[CalDAV] 自动同步失败:', error);
      }
    }, interval);
  }

  /**
   * 停止自动同步
   */
  stopAutoSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      console.log('[CalDAV] 停止自动同步');
    }
  }

  /**
   * 获取同步状态
   * @returns {Promise<object>}
   */
  async getSyncStatus() {
    const config = await this.getConfig();

    return {
      enabled: config.enabled,
      syncing: this.syncInProgress,
      lastSync: this.lastSyncTime ? this.lastSyncTime.toISOString() : null,
      mappingCount: this.syncMappings.size,
      calendarUrl: config.calendarUrl,
    };
  }
}

module.exports = CalDAVSyncService;
