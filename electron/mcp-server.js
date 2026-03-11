#!/usr/bin/env node

/**
 * Flota MCP Server 启动脚本
 * 这个脚本可以被其他 AI 应用（如 Claude Desktop）调用
 */

const path = require('path');
const fs = require('fs');

// 加载环境变量
// 开发环境: __dirname/../.env
// 打包环境: resources/mcp-server -> resources/.env
const envPath = fs.existsSync(path.join(__dirname, '..', '.env'))
  ? path.join(__dirname, '..', '.env')
  : path.join(__dirname, '..', '..', '.env');
require('dotenv').config({ path: envPath });

// Mock Electron IPC for standalone mode
const mockIpcMain = {
  handle: () => {},
  on: () => {},
  removeHandler: () => {}
};

// 如果没有 Electron 环境，注入 mock
if (!process.versions.electron) {
  try {
    // 尝试解析 electron 模块，如果不存在会抛出异常
    require.cache[require.resolve('electron')] = {
      exports: { ipcMain: mockIpcMain }
    };
  } catch (e) {
    // electron 模块不存在，创建一个虚拟模块
    const fakeElectronPath = require.resolve('./mcp-server.js').replace('mcp-server.js', 'electron-mock.js');
    require.cache[fakeElectronPath] = {
      id: fakeElectronPath,
      filename: fakeElectronPath,
      loaded: true,
      exports: { ipcMain: mockIpcMain }
    };
    // 让 require('electron') 指向这个虚拟模块
    const Module = require('module');
    const originalResolve = Module._resolveFilename;
    Module._resolveFilename = function(request, parent, isMain, options) {
      if (request === 'electron') {
        return fakeElectronPath;
      }
      return originalResolve.call(this, request, parent, isMain, options);
    };
  }
}

// 导入必要的服务
const DatabaseManager = require('./dao/DatabaseManager');
const NoteDAO = require('./dao/NoteDAO');
const TodoDAO = require('./dao/TodoDAO');
const TagDAO = require('./dao/TagDAO');
const SettingDAO = require('./dao/SettingDAO');
const NoteService = require('./services/NoteService');
const TodoService = require('./services/TodoService');
const TagService = require('./services/TagService');
const AIService = require('./services/AIService');
const MCPServer = require('./services/MCPServer');

// Mem0Service 是可选的（精简版可能没有 AI 依赖）
let Mem0Service = null;
let mem0Available = false;
try {
  // 先检查 @xenova/transformers 是否存在
  require.resolve('@xenova/transformers');
  Mem0Service = require('./services/Mem0Service');
  mem0Available = true;
  console.error('[MCP Startup] Mem0 功能可用（完整版）');
} catch (e) {
  console.error('[MCP Startup] Mem0 功能不可用（精简版，缺少 AI 依赖）');
}

// 获取用户数据目录
const getUserDataPath = () => {
  const platform = process.platform;
  const homeDir = process.env.HOME || process.env.USERPROFILE;

  let userDataPath;
  if (platform === 'win32') {
    userDataPath = path.join(process.env.APPDATA || homeDir, 'Flota');
  } else if (platform === 'darwin') {
    userDataPath = path.join(homeDir, 'Library', 'Application Support', 'Flota');
  } else {
    userDataPath = path.join(homeDir, '.config', 'Flota');
  }

  // 确保目录存在
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }

  return userDataPath;
};

async function startMCPServer() {
  try {
    console.error('[MCP Startup] 正在初始化 Flota MCP Server...');

    // 初始化数据库
    const userDataPath = getUserDataPath();
    const dbPath = path.join(userDataPath, 'database', 'flota.db');
    console.error(`[MCP Startup] 用户数据路径: ${userDataPath}`);
    console.error(`[MCP Startup] 数据库路径: ${dbPath}`);

    const dbManager = DatabaseManager.getInstance();
    await dbManager.initialize(dbPath);

    // 创建 DAO 实例
    const noteDAO = new NoteDAO();
    const todoDAO = new TodoDAO();
    const tagDAO = new TagDAO();
    const settingDAO = new SettingDAO();

    // 检查 MCP 是否已启用
    console.error('[MCP Startup] 检查 MCP 开关状态...');
    const mcpEnabledSetting = settingDAO.get('mcpEnabled');
    const mcpEnabled = mcpEnabledSetting ? mcpEnabledSetting.value === 'true' || mcpEnabledSetting.value === true : false;
    
    if (!mcpEnabled) {
      console.error('[MCP Startup] ⚠️  MCP 服务未在 Flota 中启用');
      console.error('[MCP Startup] 但独立 MCP Server 可以继续运行');
      console.error('[MCP Startup] 提示：在 Flota 设置中启用 MCP 可以获得更好的集成体验');
      // 不退出，允许独立运行
    } else {
      console.error('[MCP Startup] ✓ MCP 服务已启用');
    }
    
    console.error('[MCP Startup] ✓ MCP 服务已启用');

    // 初始化服务
    console.error('[MCP Startup] 初始化服务...');
    
    const noteService = new NoteService();
    const todoService = new TodoService();
    const tagService = new TagService();
    const aiService = new AIService(settingDAO);
    
    // Mem0 服务是可选的
    let mem0Service = null;
    if (mem0Available && Mem0Service) {
      try {
        mem0Service = new Mem0Service(dbPath, userDataPath);
        console.error('[MCP Startup] 初始化 Mem0 服务...');
      } catch (e) {
        console.error('[MCP Startup] Mem0 服务实例化失败:', e.message);
      }
    } else {
      console.error('[MCP Startup] 跳过 Mem0（精简版）');
    }

    // 初始化 AI 和 Mem0 服务
    await aiService.initialize();
    
    let mem0Result = null;
    if (mem0Service) {
      mem0Result = await mem0Service.initialize();
      if (!mem0Result.success) {
        console.error('[MCP Startup] ⚠️  Mem0 服务初始化失败，但继续启动');
        mem0Service = null; // 禁用失败的服务
      }
    }
    console.error('[MCP Startup] Mem0 初始化结果:', mem0Result);
    
    if (!mem0Result.success) {
      console.error('[MCP Startup] ⚠️  Mem0 服务初始化失败，但继续启动');
    }

    // 创建服务集合
    const services = {
      noteService,
      todoService,
      tagService,
      aiService,
      mem0Service,
    };

    // 启动 MCP Server
    console.error('[MCP Startup] 启动 MCP Server...');
    const mcpServer = new MCPServer(services);
    await mcpServer.start();

    console.error('[MCP Startup] Flota MCP Server 已就绪！');

    // 处理退出信号
    const cleanup = async () => {
      console.error('[MCP Startup] 正在关闭 MCP Server...');
      await mcpServer.stop();
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

  } catch (error) {
    console.error('[MCP Startup] 启动失败:', error);
    process.exit(1);
  }
}

// 启动服务器
startMCPServer();
