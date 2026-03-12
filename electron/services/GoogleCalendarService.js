const { calendar } = require('@googleapis/calendar');
const { OAuth2Client } = require('google-auth-library');
const { ipcMain, BrowserWindow, shell, app } = require('electron');
const http = require('http');
const url = require('url');
const TodoDAO = require('../dao/TodoDAO');
const SettingDAO = require('../dao/SettingDAO');

// 判断是否为开发环境
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

/**
 * Google Calendar OAuth 2.0 同步服务
 * 使用 OAuth 2.0 授权,不需要密码
 */
class GoogleCalendarService {
  constructor() {
    this.todoDAO = new TodoDAO();
    this.settingDAO = new SettingDAO();
    this.oauth2Client = null;
    this.calendar = null;
    this.syncInProgress = false;
    this.lastSyncTime = null;
    this.authServer = null; // 本地 HTTP 服务器
    this.authPort = null; // 动态选择的端口

    // Google OAuth 2.0 配置
    // 从环境变量读取，打包时需要通过 electron-builder 的 extraMetadata 或构建脚本注入
    this.CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    this.CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

    // 如果环境变量未设置，记录警告
    if (!this.CLIENT_ID || !this.CLIENT_SECRET) {
      console.warn('[GoogleCalendar] 警告: OAuth 凭据未配置');
      console.warn('[GoogleCalendar] 请在 .env 文件中设置 GOOGLE_CLIENT_ID 和 GOOGLE_CLIENT_SECRET');
      console.warn('[GoogleCalendar] 或在打包前设置环境变量');
    }

    // 注意：redirect_uri 需要在 Google Cloud Console 中配置多个端口
    this.REDIRECT_PORTS = [8888, 8889, 8890, 9999, 3000]; // 尝试多个端口

    console.log('[GoogleCalendar] 初始化 OAuth 配置');
    console.log('[GoogleCalendar] CLIENT_ID:', this.CLIENT_ID ? this.CLIENT_ID.substring(0, 30) + '...' : '未设置');
    console.log('[GoogleCalendar] CLIENT_SECRET 已设置:', this.CLIENT_SECRET ? '是 (长度: ' + this.CLIENT_SECRET.length + ')' : '否');
    console.log('[GoogleCalendar] 环境:', isDev ? '开发模式' : '生产模式');

    // 同步映射表
    this.syncMappings = new Map();
    this._loadSyncMappings(); // 加载持久化的映射表

    this.setupIpcHandlers();
  }

  /**
   * 初始化服务（用于应用启动时恢复自动同步）
   */
  async initialize() {
    try {
      await this._ensureAutoSyncFromConfig();
    } catch (error) {
      console.error('[GoogleCalendar] 初始化失败:', error);
    }
  }

  /**
   * 根据持久化配置确保自动同步状态正确
   * @private
   */
  async _ensureAutoSyncFromConfig() {
    const config = await this.getConfig();

    const intervalMinutes = parseInt(config.syncInterval, 10);
    const safeMinutes = Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : 30;

    const shouldAutoSync = Boolean(config.enabled && config.connected && config.calendarId);

    if (!shouldAutoSync) {
      this.stopAutoSync();
      return;
    }

    this.startAutoSync(safeMinutes * 60 * 1000);
  }

  /**
   * 加载同步映射表
   * @private
   */
  _loadSyncMappings() {
    try {
      const mappings = this.settingDAO.get('google_calendar_sync_mappings');
      if (mappings?.value) {
        const data = JSON.parse(mappings.value);
        this.syncMappings = new Map(Object.entries(data));
        console.log(`[GoogleCalendar] 加载同步映射表: ${this.syncMappings.size} 条记录`);
      }
    } catch (error) {
      console.error('[GoogleCalendar] 加载同步映射表失败:', error);
    }
  }

  /**
   * 保存同步映射表
   * @private
   */
  _saveSyncMappings() {
    try {
      const data = Object.fromEntries(this.syncMappings.entries());
      this.settingDAO.set('google_calendar_sync_mappings', JSON.stringify(data));
      console.log(`[GoogleCalendar] 保存同步映射表: ${this.syncMappings.size} 条记录`);
    } catch (error) {
      console.error('[GoogleCalendar] 保存同步映射表失败:', error);
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
        console.error(`[GoogleCalendar] ${errorMsg}:`, error);
        return { success: false, error: error.message };
      }
    };
  }

  /**
   * 设置 IPC 处理器
   */
  setupIpcHandlers() {
    const handlers = [
      ['google-calendar:start-auth', 'startOAuthFlowWithLocalServer', '启动授权失败'],
      ['google-calendar:complete-auth', 'completeOAuthFlow', '完成授权失败'],
      ['google-calendar:save-config', 'saveConfig', '保存配置失败', false],
      ['google-calendar:get-config', 'getConfig', '获取配置失败'],
      ['google-calendar:sync', 'syncNow', '同步失败'],
      ['google-calendar:get-status', 'getSyncStatus', '获取状态失败'],
      ['google-calendar:disconnect', 'disconnect', '断开连接失败', false]
    ];

    handlers.forEach(([channel, method, errorMsg, wrapData = true]) => {
      ipcMain.handle(channel, this.createHandler(method, errorMsg, wrapData));
    });

    // 获取日历列表（特殊处理：需要包装成 { calendars } 格式）
    ipcMain.handle('google-calendar:list-calendars', async () => {
      try {
        const calendars = await this.listCalendars();
        return { success: true, data: { calendars } };
      } catch (error) {
        console.error('[GoogleCalendar] 获取日历列表失败:', error);
        return { success: false, error: error.message };
      }
    });
  }

  /**
   * 使用本地 HTTP 服务器的 OAuth 2.0 授权流程
   * Google 已弃用 OOB 流程,现在使用本地服务器接收回调
   * @returns {Promise<object>} 包含日历列表的结果
   */
  async startOAuthFlowWithLocalServer() {
    console.log('[GoogleCalendar] 启动本地 OAuth 服务器');

    return new Promise((resolve, reject) => {
      // 尝试启动服务器的内部函数
      const tryStartServer = (portIndex = 0) => {
        if (portIndex >= this.REDIRECT_PORTS.length) {
          reject(new Error('无法启动 OAuth 服务器：所有端口都已被占用。\n\n请关闭可能占用端口 8888-9999 的程序后重试。'));
          return;
        }

        const port = this.REDIRECT_PORTS[portIndex];
        const redirectUri = `http://localhost:${port}/oauth2callback`;

        console.log(`[GoogleCalendar] 尝试使用端口 ${port}...`);
        console.log(`[GoogleCalendar] Redirect URI 将设置为: ${redirectUri}`);

        // 创建 OAuth2 客户端
        this.oauth2Client = new OAuth2Client(
          this.CLIENT_ID,
          this.CLIENT_SECRET,
          redirectUri
        );

        console.log('[GoogleCalendar] OAuth2 客户端已创建');

        // 生成授权 URL
        const authUrl = this.oauth2Client.generateAuthUrl({
          access_type: 'offline',
          scope: [
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/calendar.events',
          ],
          prompt: 'consent',
        });

        // 标记是否已处理请求
        let isHandled = false;

        // 创建本地 HTTP 服务器监听回调
        this.authServer = http.createServer(async (req, res) => {
          try {
            // 忽略 favicon 等其他请求
            if (req.url.includes('favicon.ico')) {
              res.writeHead(204);
              res.end();
              return;
            }

            const queryObject = url.parse(req.url, true).query;

            // 检查是否有授权码或错误
            const hasAuthData = queryObject.code || queryObject.error;

            // 如果已经处理过或没有授权数据，返回简单响应
            if (isHandled || !hasAuthData) {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`
              <!DOCTYPE html>
              <html>
              <head><meta charset="utf-8"><title>Flota</title></head>
              <body><p>此窗口可以关闭</p></body>
              </html>
            `);
              return;
            }

            // 标记为已处理
            isHandled = true;

            // 返回成功页面
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <title>授权成功</title>
              <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                .success { color: #4CAF50; font-size: 24px; margin-bottom: 20px; }
                .info { color: #666; font-size: 16px; }
              </style>
            </head>
            <body>
              <div class="success">✓ 授权成功！</div>
              <div class="info">已获得 Google Calendar 访问权限</div>
              <div class="info" style="margin-top: 20px;">请返回 Flota 继续配置</div>
              <script>setTimeout(() => window.close(), 3000);</script>
            </body>
            </html>
          `);

            // 延迟关闭服务器，让响应发送完成
            setTimeout(() => {
              if (this.authServer) {
                this.authServer.close();
              }
            }, 100);

            // 检查是否有错误
            if (queryObject.error) {
              const errorDesc = queryObject.error_description || queryObject.error;
              console.error('[GoogleCalendar] 授权错误:', queryObject.error);
              console.error('[GoogleCalendar] 错误描述:', errorDesc);
              console.error('[GoogleCalendar] 完整URL:', req.url);
              reject(new Error(`授权失败: ${errorDesc}\n\n可能原因：\n1. Redirect URI 未在 Google Cloud Console 中配置\n2. 请确保添加 http://localhost:8888/oauth2callback 到授权重定向 URI 列表`));
              return;
            }

            // 获取授权码
            const authCode = queryObject.code;
            if (!authCode) {
              console.error('[GoogleCalendar] 未收到授权码');
              console.error('[GoogleCalendar] 查询参数:', queryObject);
              console.error('[GoogleCalendar] 完整URL:', req.url);
              reject(new Error('未收到授权码'));
              return;
            }

            console.log('[GoogleCalendar] 收到授权码,正在交换 tokens');
            console.log('[GoogleCalendar] 授权码长度:', authCode.length);
            console.log('[GoogleCalendar] 正在连接 oauth2.googleapis.com...');

            try {
              // 用授权码换取 tokens (添加超时保护)
              const tokenPromise = this.oauth2Client.getToken(authCode);
              const timeoutPromise = new Promise((_, timeoutReject) => {
                setTimeout(() => {
                  timeoutReject(new Error('TIMEOUT'));
                }, 60000); // 60秒超时
              });

              console.log('[GoogleCalendar] 等待 Google 响应...');
              const { tokens } = await Promise.race([tokenPromise, timeoutPromise]);

              console.log('[GoogleCalendar] 成功获取 tokens');
              this.oauth2Client.setCredentials(tokens);

              // 保存 tokens
              console.log('[GoogleCalendar] 正在保存 tokens 到数据库...');
              await this.settingDAO.set('google_calendar_access_token', tokens.access_token);
              if (tokens.refresh_token) {
                await this.settingDAO.set('google_calendar_refresh_token', tokens.refresh_token);
              }
              await this.settingDAO.set('google_calendar_expiry_date', tokens.expiry_date?.toString() || '');

              console.log('[GoogleCalendar] Tokens 已保存');

              // 初始化 Calendar API
              console.log('[GoogleCalendar] 初始化 Calendar API...');
              this.calendar = calendar({ version: 'v3', auth: this.oauth2Client });

              // 获取日历列表
              console.log('[GoogleCalendar] 正在获取日历列表...');
              const calendars = await this.listCalendars();
              console.log(`[GoogleCalendar] 成功获取 ${calendars.length} 个日历`);

              // 授权完成后，若此前已启用且配置完整，则恢复自动同步
              await this._ensureAutoSyncFromConfig();

              resolve({ calendars });
            } catch (tokenError) {
              console.error('[GoogleCalendar] Token 交换失败:', tokenError);
              console.error('[GoogleCalendar] 错误类型:', tokenError.constructor.name);
              console.error('[GoogleCalendar] 错误消息:', tokenError.message);
              console.error('[GoogleCalendar] 错误代码:', tokenError.code);
              if (tokenError.response) {
                console.error('[GoogleCalendar] 响应状态:', tokenError.response.status);
                console.error('[GoogleCalendar] 响应数据:', tokenError.response.data);
              }

              // 检查是否是超时错误
              if (tokenError.message === 'TIMEOUT') {
                reject(new Error('请求超时：连接 Google 服务超过 60 秒。\n\n' +
                  '可能原因：\n' +
                  '1. VPN 连接不稳定或速度过慢\n' +
                  '2. Google 服务响应缓慢\n\n' +
                  '解决方法：\n' +
                  '1. 检查 VPN 连接状态\n' +
                  '2. 尝试更换 VPN 节点\n' +
                  '3. 稍后重试\n' +
                  '4. 或使用 CalDAV 方式同步 iCloud 日历'));
              } else if (tokenError.code === 'ETIMEDOUT' || tokenError.message.includes('ETIMEDOUT')) {
                reject(new Error('网络连接超时：无法访问 Google 服务。\n\n' +
                  '可能原因：\n' +
                  '1. Google 服务在部分地区被限制访问\n' +
                  '2. 需要使用 VPN 或代理\n\n' +
                  '解决方法：\n' +
                  '1. 开启 VPN 后重试\n' +
                  '2. 或使用 CalDAV 方式同步 iCloud 日历'));
              } else {
                reject(tokenError);
              }
            }
          } catch (error) {
            console.error('[GoogleCalendar] OAuth 回调处理失败:', error);
            reject(error);
          }
        });

        // 启动服务器
        this.authServer.listen(port, 'localhost', () => {
          this.authPort = port;
          console.log(`[GoogleCalendar] OAuth 服务器已启动: http://localhost:${port}`);
          console.log(`[GoogleCalendar] Redirect URI: ${redirectUri}`);
          console.log(`[GoogleCalendar] 授权 URL: ${authUrl}`);

          // 在系统浏览器中打开授权 URL
          shell.openExternal(authUrl).catch(err => {
            console.error('[GoogleCalendar] 无法打开浏览器:', err);
            reject(new Error('无法打开浏览器，请手动访问授权链接'));
          });
        });

        // 服务器错误处理
        this.authServer.on('error', (error) => {
          console.error(`[GoogleCalendar] 端口 ${port} 启动失败:`, error.message);

          // 如果是端口占用错误，尝试下一个端口
          if (error.code === 'EADDRINUSE') {
            console.log(`[GoogleCalendar] 端口 ${port} 已被占用，尝试下一个端口...`);
            if (this.authServer) {
              this.authServer.close();
            }
            tryStartServer(portIndex + 1);
          } else {
            reject(error);
          }
        });
      };

      // 开始尝试启动服务器
      tryStartServer(0);
    });
  }

  /**
   * 【已弃用】开始 OAuth 2.0 授权流程 (OOB 模式)
   * Google 已于 2022 年弃用此方法
   * @returns {Promise<string>} 授权 URL
   */
  async startOAuthFlow() {
    console.log('[GoogleCalendar] 开始 OAuth 授权流程');

    // 使用第一个可用端口作为后备
    const redirectUri = `http://localhost:${this.REDIRECT_PORTS[0]}/oauth2callback`;

    // 创建 OAuth2 客户端
    this.oauth2Client = new OAuth2Client(
      this.CLIENT_ID,
      this.CLIENT_SECRET,
      redirectUri
    );

    // 生成授权 URL
    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline', // 获取 refresh token
      scope: [
        'https://www.googleapis.com/auth/calendar', // 日历完全访问权限
        'https://www.googleapis.com/auth/calendar.events', // 事件读写
      ],
      prompt: 'consent', // 强制显示同意屏幕以获取 refresh token
    });

    console.log('[GoogleCalendar] 授权 URL 已生成');
    return authUrl;
  }

  /**
   * 完成 OAuth 授权流程
   * @param {string} authCode - 授权码
   * @returns {Promise<object>}
   */
  async completeOAuthFlow(authCode) {
    console.log('[GoogleCalendar] 完成 OAuth 授权');

    if (!this.oauth2Client) {
      throw new Error('OAuth 客户端未初始化');
    }

    try {
      // 用授权码换取 tokens
      const { tokens } = await this.oauth2Client.getToken(authCode);
      this.oauth2Client.setCredentials(tokens);

      // 保存 tokens
      await this.settingDAO.set('google_calendar_access_token', tokens.access_token);
      if (tokens.refresh_token) {
        await this.settingDAO.set('google_calendar_refresh_token', tokens.refresh_token);
      }
      await this.settingDAO.set('google_calendar_expiry_date', tokens.expiry_date?.toString() || '');

      console.log('[GoogleCalendar] Tokens 已保存');

      // 初始化 Calendar API
      this.calendar = calendar({ version: 'v3', auth: this.oauth2Client });

      // 获取日历列表
      const calendars = await this.listCalendars();

      // 授权完成后，若此前已启用且配置完整，则恢复自动同步
      await this._ensureAutoSyncFromConfig();

      return {
        connected: true,
        calendars,
      };
    } catch (error) {
      console.error('[GoogleCalendar] 获取 tokens 失败:', error);
      throw new Error(`授权失败: ${error.message}`);
    }
  }

  /**
   * 初始化已保存的授权
   * @returns {Promise<boolean>}
   */
  async initializeAuth() {
    console.log('[GoogleCalendar] 初始化授权');

    try {
      const setting = await this.settingDAO.get('google_calendar_access_token');
      const accessToken = setting?.value;

      if (!accessToken) {
        console.log('[GoogleCalendar] 未找到已保存的 token');
        return false;
      }

      const refreshTokenSetting = await this.settingDAO.get('google_calendar_refresh_token');
      const refreshToken = refreshTokenSetting?.value;

      const expiryDateSetting = await this.settingDAO.get('google_calendar_expiry_date');
      const expiryDate = expiryDateSetting?.value ? parseInt(expiryDateSetting.value) : null;

      // 使用第一个可用端口作为后备
      const redirectUri = `http://localhost:${this.REDIRECT_PORTS[0]}/oauth2callback`;

      // 创建 OAuth 客户端并设置 credentials
      this.oauth2Client = new OAuth2Client(
        this.CLIENT_ID,
        this.CLIENT_SECRET,
        redirectUri
      );

      this.oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken,
        expiry_date: expiryDate,
      });

      // 初始化 Calendar API
      this.calendar = calendar({ version: 'v3', auth: this.oauth2Client });

      console.log('[GoogleCalendar] 授权初始化成功');
      return true;
    } catch (error) {
      console.error('[GoogleCalendar] 初始化授权失败:', error);
      return false;
    }
  }

  /**
   * 获取日历列表
   * @returns {Promise<Array>}
   */
  async listCalendars() {
    if (!this.calendar) {
      const initialized = await this.initializeAuth();
      if (!initialized) {
        throw new Error('未授权,请先完成 OAuth 授权');
      }
    }

    console.log('[GoogleCalendar] 获取日历列表');

    try {
      // 添加超时保护 (30秒)
      const response = await Promise.race([
        this.calendar.calendarList.list(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('网络请求超时，请检查网络连接或代理设置')), 30000)
        )
      ]);
      const calendars = response.data.items || [];

      console.log(`[GoogleCalendar] 找到 ${calendars.length} 个日历`);

      return calendars.map(cal => ({
        id: cal.id,
        displayName: cal.summary,
        description: cal.description || '',
        primary: cal.primary || false,
        accessRole: cal.accessRole,
        backgroundColor: cal.backgroundColor,
      }));
    } catch (error) {
      console.error('[GoogleCalendar] 获取日历列表失败:', error);

      // 如果是认证错误,清除保存的 token
      if (error.code === 401 || error.code === 403) {
        await this.disconnect();
        throw new Error('授权已过期,请重新授权');
      }

      throw error;
    }
  }

  /**
   * 保存配置
   * @param {object} config - 配置
   */
  async saveConfig(config) {
    console.log('[GoogleCalendar] 保存配置');

    await this.settingDAO.set('google_calendar_enabled', config.enabled ? '1' : '0');
    await this.settingDAO.set('google_calendar_calendar_id', config.calendarId || '');
    await this.settingDAO.set('google_calendar_sync_interval', config.syncInterval || '30');
    await this.settingDAO.set('google_calendar_sync_direction', config.syncDirection || 'bidirectional');

    await this._ensureAutoSyncFromConfig();
  }

  /**
   * 获取配置
   * @returns {Promise<object>}
   */
  async getConfig() {
    const enabledSetting = await this.settingDAO.get('google_calendar_enabled');
    const calendarIdSetting = await this.settingDAO.get('google_calendar_calendar_id');
    const syncIntervalSetting = await this.settingDAO.get('google_calendar_sync_interval');
    const syncDirectionSetting = await this.settingDAO.get('google_calendar_sync_direction');
    const accessTokenSetting = await this.settingDAO.get('google_calendar_access_token');

    const config = {
      enabled: enabledSetting?.value === '1',
      calendarId: calendarIdSetting?.value || '',
      syncInterval: syncIntervalSetting?.value || '30',
      syncDirection: syncDirectionSetting?.value || 'bidirectional',
      connected: !!accessTokenSetting?.value,
    };

    return config;
  }

  /**
   * 立即执行同步
   * @returns {Promise<object>}
   */
  async syncNow() {
    if (this.syncInProgress) {
      throw new Error('同步正在进行中');
    }

    console.log('[GoogleCalendar] 开始同步...');
    this.syncInProgress = true;

    try {
      if (!this.calendar) {
        const initialized = await this.initializeAuth();
        if (!initialized) {
          throw new Error('未授权,请先完成 OAuth 授权');
        }
      }

      const config = await this.getConfig();
      if (!config.calendarId) {
        throw new Error('未选择日历');
      }

      const result = {
        timestamp: new Date().toISOString(),
        localToRemote: 0,
        remoteToLocal: 0,
        deleted: 0,
        conflicts: 0,
        errors: [],
      };

      // 双向同步
      if (config.syncDirection === 'bidirectional' || config.syncDirection === 'upload') {
        const uploaded = await this.syncLocalToRemote(config);
        result.localToRemote = uploaded;

        // 同步删除操作 - 删除本地已删除待办对应的远程事件
        const deleted = await this.syncDeletedTodos(config);
        result.deleted = deleted;
      }

      if (config.syncDirection === 'bidirectional' || config.syncDirection === 'download') {
        const downloaded = await this.syncRemoteToLocal(config);
        result.remoteToLocal = downloaded;
      }

      this.lastSyncTime = new Date();
      await this.settingDAO.set('google_calendar_last_sync', this.lastSyncTime.toISOString());

      // 保存同步映射表
      this._saveSyncMappings();

      console.log('[GoogleCalendar] 同步完成:', result);
      return result;

    } catch (error) {
      console.error('[GoogleCalendar] 同步失败:', error);
      throw error;
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * 将扩展字段编码到 description（元数据格式）
   * @param {object} todo - 待办对象
   * @returns {string} 编码后的 description
   * @private
   */
  _encodeDescription(todo) {
    const metadata = [];
    
    // 编码四象限属性
    if (todo.is_important) metadata.push('[重要]');
    if (todo.is_urgent) metadata.push('[紧急]');
    
    // 编码标签
    if (todo.tags && todo.tags.trim()) {
      metadata.push(`[标签:${todo.tags}]`);
    }
    
    // 组合：元数据 + 原始描述
    const parts = [];
    if (metadata.length > 0) parts.push(metadata.join(''));
    if (todo.description && todo.description.trim()) parts.push(todo.description);
    
    return parts.join('\n');
  }

  /**
   * 从 description 解码扩展字段
   * @param {string} description - 云端描述
   * @returns {object} { description, isImportant, isUrgent, tags }
   * @private
   */
  _decodeDescription(description) {
    if (!description || !description.trim()) {
      return { description: '', isImportant: 0, isUrgent: 0, tags: '' };
    }

    let text = description;
    let isImportant = 0;
    let isUrgent = 0;
    let tags = '';

    // 解析元数据标记（必须在开头）
    const metadataPattern = /^((?:\[(重要|紧急|标签:[^\]]+)\])+)\n?/;
    const match = text.match(metadataPattern);
    
    if (match) {
      const metadataStr = match[1];
      text = text.slice(match[0].length); // 移除元数据部分
      
      // 解析各个标记
      if (metadataStr.includes('[重要]')) isImportant = 1;
      if (metadataStr.includes('[紧急]')) isUrgent = 1;
      
      const tagsMatch = metadataStr.match(/\[标签:([^\]]+)\]/);
      if (tagsMatch) tags = tagsMatch[1];
    }

    return {
      description: text.trim(),
      isImportant,
      isUrgent,
      tags
    };
  }

  /**
   * 将待办转换为 Google Calendar 事件格式
   * @param {object} todo - 待办对象
   * @returns {object} Google Calendar 事件对象
   * @private
   */
  _convertTodoToEvent(todo) {
    const event = {
      summary: todo.content,
      description: this._encodeDescription(todo),
      status: todo.is_completed ? 'cancelled' : 'confirmed',
    };

    // 设置事件时间 - 根据 item_type 和 has_time 决定
    const timeFields = this._getEventTimeFields(todo);
    Object.assign(event, timeFields);

    return event;
  }

  /**
   * 根据待办获取事件的时间字段（处理时区）
   * @param {object} todo - 待办对象
   * @returns {object} { start, end } 时间字段
   * @private
   */
  _getEventTimeFields(todo) {
    const ONE_HOUR = 3600000; // 1小时的毫秒数

    // 情况1: 没有日期 - 使用今天全天
    if (!todo.due_date) {
      const today = new Date().toISOString().split('T')[0];
      return { start: { date: today }, end: { date: today } };
    }

    // 情况2: 全天事件（无论是待办还是日程，只看 has_time）
    if (!todo.has_time) {
      // 如果due_date包含T，提取日期部分；否则直接使用
      const dateOnly = todo.due_date.includes('T') ? todo.due_date.split('T')[0] : todo.due_date;
      const endDateOnly = todo.end_date ? (todo.end_date.includes('T') ? todo.end_date.split('T')[0] : todo.end_date) : dateOnly;
      return {
        start: { date: dateOnly },
        end: { date: endDateOnly }
      };
    }

    // 情况3: 带时间的日程
    try {
      // 数据库中的 due_date 应该是 UTC ISO 格式: "2025-11-11T14:00:00.000Z"
      // 或旧格式的本地时间字符串: "2025-11-11 14:00:00"
      let startDate;

      if (todo.due_date.includes('T')) {
        // ISO 格式，直接解析（已经是 UTC）
        startDate = new Date(todo.due_date);
      } else {
        // 旧格式的本地时间字符串，需要特殊处理
        // "2025-11-11 14:00:00" -> 解析为本地时间
        const parts = todo.due_date.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
        if (parts) {
          startDate = new Date(
            parseInt(parts[1]),
            parseInt(parts[2]) - 1,
            parseInt(parts[3]),
            parseInt(parts[4]),
            parseInt(parts[5]),
            parseInt(parts[6])
          );
        } else {
          startDate = new Date(todo.due_date);
        }
      }

      if (isNaN(startDate.getTime())) {
        // 无效日期，降级为全天
        const today = new Date().toISOString().split('T')[0];
        return { start: { date: today }, end: { date: today } };
      }

      // 使用本地时区的 ISO 字符串
      // 格式: 2025-11-11T14:00:00+08:00
      const startDateTime = this._toLocalISOString(startDate);

      // 计算结束时间
      let endDateTime;
      if (todo.end_date) {
        let endDate;
        if (todo.end_date.includes('T')) {
          endDate = new Date(todo.end_date);
        } else {
          const parts = todo.end_date.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
          if (parts) {
            endDate = new Date(
              parseInt(parts[1]),
              parseInt(parts[2]) - 1,
              parseInt(parts[3]),
              parseInt(parts[4]),
              parseInt(parts[5]),
              parseInt(parts[6])
            );
          } else {
            endDate = new Date(todo.end_date);
          }
        }
        endDateTime = this._toLocalISOString(endDate);
      } else {
        // 默认结束时间为开始时间 +1 小时
        const endDate = new Date(startDate.getTime() + ONE_HOUR);
        endDateTime = this._toLocalISOString(endDate);
      }

      return {
        start: {
          dateTime: startDateTime,
          timeZone: 'Asia/Shanghai' // 明确指定时区
        },
        end: {
          dateTime: endDateTime,
          timeZone: 'Asia/Shanghai'
        }
      };
    } catch (error) {
      console.error('[GoogleCalendar] 解析时间失败:', error);
      // 降级为全天事件
      const dateOnly = todo.due_date.includes('T') ? todo.due_date.split('T')[0] : todo.due_date;
      return { start: { date: dateOnly }, end: { date: dateOnly } };
    }
  }

  /**
   * 将 Date 对象转换为本地时区的 ISO 字符串
   * @param {Date} date - 日期对象
   * @returns {string} 本地时区的 ISO 字符串，格式: 2025-11-11T14:00:00+08:00
   * @private
   */
  _toLocalISOString(date) {
    const offset = -date.getTimezoneOffset(); // 分钟数，东八区是 -480
    const offsetHours = Math.floor(Math.abs(offset) / 60);
    const offsetMinutes = Math.abs(offset) % 60;
    const offsetSign = offset >= 0 ? '+' : '-';

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMinutes).padStart(2, '0')}`;
  }

  /**
   * 解析 Google Calendar 事件的时间信息
   * @param {object} event - Google Calendar 事件对象
   * @returns {object} { dueDate, endDate, hasTime, itemType }
   * @private
   */
  _parseEventTime(event) {
    const start = event.start;
    const end = event.end;

    // 情况1: 全天事件（只有 date，没有 dateTime）
    if (start?.date) {
      return {
        dueDate: start.date, // YYYY-MM-DD 格式
        endDate: end?.date || start.date,
        hasTime: 0,
        itemType: 'todo' // 全天事件视为待办
      };
    }

    // 情况2: 带时间的事件（有 dateTime）
    if (start?.dateTime) {
      // Google Calendar 返回的是 UTC 时间或带时区的时间
      // 直接使用 ISO 格式字符串存储（保持 UTC 时间戳）
      const startDate = new Date(start.dateTime);
      const endDate = end?.dateTime ? new Date(end.dateTime) : new Date(startDate.getTime() + 3600000);

      // 使用 ISO 格式存储，保持与应用其他部分一致
      const dueDate = startDate.toISOString();
      const endDateStr = endDate.toISOString();

      return {
        dueDate: dueDate,
        endDate: endDateStr,
        hasTime: 1,
        itemType: 'event' // 带时间的是日程
      };
    }

    // 默认情况
    return {
      dueDate: new Date().toISOString().split('T')[0],
      endDate: null,
      hasTime: 0,
      itemType: 'todo'
    };
  }

  /**
   * 将 Date 对象转换为本地时间字符串
   * @param {Date} date - 日期对象
   * @returns {string} 格式: "2025-11-11 14:00:00"
   * @private
   */
  _toLocalDateTimeString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  /**
   * 判断是否应该用云端数据更新本地数据
   * @param {object} localTodo - 本地待办
   * @param {object} remoteEvent - 云端事件
   * @returns {boolean} true=更新本地, false=保持本地
   * @private
   */
  _shouldUpdateLocal(localTodo, remoteEvent) {
    try {
      // 解析本地更新时间
      // SQLite CURRENT_TIMESTAMP 格式: "YYYY-MM-DD HH:MM:SS" (UTC)
      // 需要添加 'Z' 后缀或转换为 ISO 格式以确保被解析为 UTC
      let localUpdatedStr = localTodo.updated_at;
      if (localUpdatedStr && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(localUpdatedStr)) {
        // 转换 "YYYY-MM-DD HH:MM:SS" 为 "YYYY-MM-DDTHH:MM:SSZ"
        localUpdatedStr = localUpdatedStr.replace(' ', 'T') + 'Z';
      }

      const localUpdatedAt = new Date(localUpdatedStr);
      const remoteUpdatedAt = new Date(remoteEvent.updated);

      // 如果时间无效，默认更新
      if (isNaN(localUpdatedAt.getTime()) || isNaN(remoteUpdatedAt.getTime())) {
        console.log('[GoogleCalendar] 时间无效，默认更新本地');
        console.log(`  原始值: 本地="${localTodo.updated_at}", 云端="${remoteEvent.updated}"`);
        return true;
      }

      // 比较更新时间（允许 5 秒误差，避免网络延迟导致的问题）
      const localTime = localUpdatedAt.getTime();
      const remoteTime = remoteUpdatedAt.getTime();
      const timeDiff = remoteTime - localTime;
      const threshold = 5000; // 5秒

      if (timeDiff > threshold) {
        // 云端更新时间较新
        console.log(`[GoogleCalendar] 云端更新较新:`);
        console.log(`  云端: ${remoteEvent.updated} (${remoteTime})`);
        console.log(`  本地: ${localTodo.updated_at} (${localTime})`);
        console.log(`  差值: ${timeDiff}ms (${(timeDiff / 1000).toFixed(1)}秒)`);
        return true;
      } else if (timeDiff < -threshold) {
        // 本地更新时间较新
        console.log(`[GoogleCalendar] 本地更新较新:`);
        console.log(`  云端: ${remoteEvent.updated} (${remoteTime})`);
        console.log(`  本地: ${localTodo.updated_at} (${localTime})`);
        console.log(`  差值: ${timeDiff}ms (${(timeDiff / 1000).toFixed(1)}秒)`);
        return false;
      } else {
        // 时间相近，认为已同步，不更新
        console.log(`[GoogleCalendar] 时间相近，跳过更新: 差值=${timeDiff}ms`);
        return false;
      }
    } catch (error) {
      console.error('[GoogleCalendar] 比较更新时间失败:', error);
      // 出错时保守策略：不更新本地
      return false;
    }
  }

  /**
   * 上传单个待办到 Google Calendar
   * @param {object} todo - 待办对象
   * @param {string} calendarId - 日历 ID
   * @returns {Promise<boolean>} 是否上传成功
   * @private
   */
  async _uploadTodo(todo, calendarId) {
    const existingEventId = this.syncMappings.get(`todo_${todo.id}`);
    const event = this._convertTodoToEvent(todo);

    try {
      if (existingEventId) {
        // 更新现有事件
        console.log(`[GoogleCalendar] 📤 更新云端事件 ${existingEventId} (本地待办 ${todo.id} "${todo.content}")`);
        console.log(`[GoogleCalendar]    更新内容:`, {
          summary: event.summary,
          start: event.start,
          end: event.end
        });

        // 添加超时保护 (15秒)
        await Promise.race([
          this.calendar.events.update({
            calendarId,
            eventId: existingEventId,
            requestBody: event,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('更新事件超时')), 15000)
          )
        ]);
        console.log(`[GoogleCalendar] ✅ 云端事件更新成功`);
      } else {
        // 创建新事件
        console.log(`[GoogleCalendar] 📤 创建新云端事件 (本地待办 ${todo.id} "${todo.content}")`);
        // 添加超时保护 (15秒)
        const response = await Promise.race([
          this.calendar.events.insert({
            calendarId,
            requestBody: event,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('创建事件超时')), 15000)
          )
        ]);
        this.syncMappings.set(`todo_${todo.id}`, response.data.id);
        console.log(`[GoogleCalendar] ✅ 云端事件创建成功: ${response.data.id}`);
      }
      return true;
    } catch (error) {
      this._logUploadError(todo, error);
      return false;
    }
  }

  /**
   * 记录上传错误
   * @param {object} todo - 待办对象
   * @param {Error} error - 错误对象
   * @private
   */
  _logUploadError(todo, error) {
    console.error(`[GoogleCalendar] 上传待办 ${todo.id} 失败:`, error.message);
    console.error(`[GoogleCalendar] 待办内容:`, {
      id: todo.id,
      content: todo.content,
      due_date: todo.due_date,
      is_completed: todo.is_completed
    });
    if (error.response?.data) {
      console.error(`[GoogleCalendar] API 错误详情:`, error.response.data);
    }
  }

  /**
   * 同步本地待办到 Google Calendar
   * @param {object} config - 配置
   * @returns {Promise<number>}
   */
  async syncLocalToRemote(config) {
    console.log('[GoogleCalendar] 上传本地待办到 Google Calendar...');

    const todos = this.todoDAO.findAll({ includeCompleted: false });
    console.log(`[GoogleCalendar] 准备上传 ${todos.length} 个未完成待办`);

    // 详细日志：列出所有待上传的待办
    todos.forEach((todo, index) => {
      console.log(`[GoogleCalendar]   待办 ${index + 1}: "${todo.content}" (${todo.item_type}) - ${todo.due_date} - 本地updated: ${todo.updated_at}`);
    });

    const uploadResults = await Promise.all(
      todos.map(todo => this._uploadTodo(todo, config.calendarId))
    );

    const uploadCount = uploadResults.filter(Boolean).length;
    console.log(`[GoogleCalendar] 上传完成: ${uploadCount}/${todos.length}`);
    return uploadCount;
  }

  /**
   * 同步删除操作 - 删除已删除待办对应的远程事件
   * @param {object} config - 配置
   * @returns {Promise<number>}
   */
  async syncDeletedTodos(config) {
    console.log('[GoogleCalendar] 检查并删除已删除待办对应的远程事件...');

    const allTodos = this.todoDAO.findAll({ includeCompleted: true });
    const todoIds = new Set(allTodos.map(todo => `todo_${todo.id}`));

    let deleteCount = 0;
    const keysToDelete = [];

    // 找出映射表中存在但本地不存在的待办
    for (const [key, eventId] of this.syncMappings.entries()) {
      if (key.startsWith('todo_') && !todoIds.has(key)) {
        try {
          console.log(`[GoogleCalendar] 删除远程事件: ${eventId} (本地待办已删除)`);

          // 添加超时保护 (15秒)
          await Promise.race([
            this.calendar.events.delete({
              calendarId: config.calendarId,
              eventId: eventId,
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('删除事件超时')), 15000)
            )
          ]);

          keysToDelete.push(key);
          deleteCount++;
        } catch (error) {
          // 404 错误表示事件已经不存在，也认为是成功的
          if (error.code === 404 || error.message?.includes('404')) {
            console.log(`[GoogleCalendar] 远程事件 ${eventId} 已不存在，清理映射`);
            keysToDelete.push(key);
            deleteCount++;
          } else {
            console.error(`[GoogleCalendar] 删除远程事件 ${eventId} 失败:`, error.message);
          }
        }
      }
    }

    // 清理映射表
    keysToDelete.forEach(key => this.syncMappings.delete(key));

    // 立即保存映射表
    if (keysToDelete.length > 0) {
      this._saveSyncMappings();
    }

    console.log(`[GoogleCalendar] 删除完成: ${deleteCount} 个远程事件`);
    return deleteCount;
  }

  /**
   * 同步 Google Calendar 到本地待办
   * @param {object} config - 配置
   * @returns {Promise<number>}
   */
  async syncRemoteToLocal(config) {
    console.log('[GoogleCalendar] 下载 Google Calendar 事件到本地...');

    try {
      // 获取过去 90 天到未来 365 天的事件（覆盖更广的范围）
      const now = new Date();
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      const oneYearLater = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

      console.log(`[GoogleCalendar] 同步范围: ${ninetyDaysAgo.toISOString()} 到 ${oneYearLater.toISOString()}`);

      // 添加超时保护 (30秒)
      const response = await Promise.race([
        this.calendar.events.list({
          calendarId: config.calendarId,
          timeMin: ninetyDaysAgo.toISOString(),
          timeMax: oneYearLater.toISOString(),
          maxResults: 500, // 增加获取数量以覆盖更大时间范围
          singleEvents: true,
          orderBy: 'startTime',
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('网络请求超时，请检查网络连接或代理设置')), 30000)
        )
      ]);

      const events = response.data.items || [];
      console.log(`[GoogleCalendar] 获取到 ${events.length} 个事件`);

      // 详细日志：列出所有下载的事件
      events.forEach((event, index) => {
        const { dueDate, itemType } = this._parseEventTime(event);
        console.log(`[GoogleCalendar]   事件 ${index + 1}: "${event.summary}" (${itemType}) - ${dueDate} - 云端更新时间: ${event.updated}`);
      });

      let downloadCount = 0;

      for (const event of events) {
        try {
          // 查找是否已有本地待办
          const localTodo = this.findTodoByEventId(event.id);

          // 解析事件时间和类型
          const { dueDate, endDate, hasTime, itemType } = this._parseEventTime(event);

          // 解码 description 中的元数据
          const decoded = this._decodeDescription(event.description);

          const todoData = {
            content: event.summary || '无标题事件',
            description: decoded.description,
            due_date: dueDate,
            end_date: endDate,
            has_time: hasTime,
            item_type: itemType,
            is_completed: event.status === 'cancelled' ? 1 : 0,
            is_important: decoded.isImportant,
            is_urgent: decoded.isUrgent,
            tags: decoded.tags
          };

          if (localTodo) {
            // 智能冲突处理：比较更新时间
            const shouldUpdate = this._shouldUpdateLocal(localTodo, event);

            if (shouldUpdate) {
              console.log(`[GoogleCalendar] ✅ 云端更新较新，更新本地待办 ${localTodo.id} "${localTodo.content}" → "${event.summary}"`);
              console.log(`[GoogleCalendar]    本地时间: ${localTodo.due_date}, 云端时间: ${dueDate}`);
              console.log(`[GoogleCalendar]    本地updated: ${localTodo.updated_at}, 云端updated: ${event.updated}`);
              // 只更新todoData中指定的字段，保留is_important、is_urgent和description(如果云端为空)
              this.todoDAO.update(localTodo.id, todoData);
              downloadCount++;
            } else {
              console.log(`[GoogleCalendar] ⏭️  本地更新较新，保持本地待办 ${localTodo.id} "${localTodo.content}"`);
              console.log(`[GoogleCalendar]    本地时间: ${localTodo.due_date}, 云端时间: ${dueDate}`);
              console.log(`[GoogleCalendar]    本地updated: ${localTodo.updated_at}, 云端updated: ${event.updated}`);
              // 不更新本地，下次同步时会上传本地版本
            }
          } else {
            // 创建新待办
            const newTodo = this.todoDAO.create(todoData);
            this.syncMappings.set(`todo_${newTodo.id}`, event.id);
            downloadCount++;
          }

        } catch (error) {
          console.error('[GoogleCalendar] 下载事件失败:', error.message);
        }
      }

      console.log(`[GoogleCalendar] 下载完成: ${downloadCount}/${events.length}`);
      return downloadCount;
    } catch (error) {
      console.error('[GoogleCalendar] 下载事件失败:', error);
      throw error;
    }
  }

  /**
   * 根据 Google Calendar 事件 ID 查找本地待办
   * @param {string} eventId 
   * @returns {object|null}
   */
  findTodoByEventId(eventId) {
    for (const [key, value] of this.syncMappings.entries()) {
      if (value === eventId) {
        const todoId = parseInt(key.replace('todo_', ''));
        return this.todoDAO.findById(todoId);
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

    console.log(`[GoogleCalendar] 启动自动同步,间隔: ${interval / 60000} 分钟`);

    const safeInterval = Number.isFinite(interval) && interval > 0 ? interval : 30 * 60 * 1000;

    // 启动后先尝试同步一次，避免等待一个完整周期
    setTimeout(async () => {
      try {
        const config = await this.getConfig();
        if (config.enabled && config.connected && config.calendarId) {
          await this.syncNow();
        }
      } catch (error) {
        console.error('[GoogleCalendar] 自动同步(首次)失败:', error);
      }
    }, 1000);

    this.syncTimer = setInterval(async () => {
      try {
        const config = await this.getConfig();
        if (!(config.enabled && config.connected && config.calendarId)) {
          this.stopAutoSync();
          return;
        }

        await this.syncNow();
      } catch (error) {
        console.error('[GoogleCalendar] 自动同步失败:', error);

        // 授权失效/未授权时停止自动同步，避免刷屏
        const msg = String(error?.message || error || '');
        if (msg.includes('未授权') || msg.includes('授权已过期') || msg.includes('401') || msg.includes('403')) {
          this.stopAutoSync();
        }
      }
    }, safeInterval);
  }

  /**
   * 停止自动同步
   */
  stopAutoSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      console.log('[GoogleCalendar] 停止自动同步');
    }
  }

  /**
   * 断开连接
   */
  async disconnect() {
    console.log('[GoogleCalendar] 断开连接');

    await this.settingDAO.set('google_calendar_enabled', '0');
    await this.settingDAO.set('google_calendar_access_token', '');
    await this.settingDAO.set('google_calendar_refresh_token', '');
    await this.settingDAO.set('google_calendar_expiry_date', '');

    this.oauth2Client = null;
    this.calendar = null;
    this.stopAutoSync();
  }

  /**
   * 获取同步状态
   * @returns {Promise<object>}
   */
  async getSyncStatus() {
    const config = await this.getConfig();
    const lastSyncSetting = await this.settingDAO.get('google_calendar_last_sync');

    return {
      enabled: config.enabled,
      connected: config.connected,
      syncing: this.syncInProgress,
      lastSync: lastSyncSetting?.value || null,
      mappingCount: this.syncMappings.size,
      calendarId: config.calendarId,
    };
  }
}

module.exports = GoogleCalendarService;
