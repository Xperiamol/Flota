#!/usr/bin/env node

/**
 * Flota MCP Server Launcher
 * 
 * 最佳实践：MCP Server 完全独立打包到 resources/mcp-server/
 * - 不受 asar 限制
 * - 依赖清晰独立
 * - 不影响主应用体积
 * 
 * 打包后的结构：
 * resources/
 *   mcp-server/                <- MCP Server 独立目录
 *     mcp-server-launcher.js   <- 当前文件
 *     mcp-server.js
 *     dao/
 *     services/
 *     utils/
 *     node_modules/            <- MCP 专属依赖
 */

const path = require('path');

// 检测运行环境
const isPackaged = __dirname.includes('resources');

if (isPackaged) {
  console.log('[MCP Launcher] 打包环境（独立 MCP Server）');
  
  // resources/mcp-server/node_modules
  const nodeModulesPath = path.join(__dirname, 'node_modules');
  
  console.log(`[MCP Launcher] MCP Root: ${__dirname}`);
  console.log(`[MCP Launcher] Modules: ${nodeModulesPath}`);
  
  // 设置 NODE_PATH
  process.env.NODE_PATH = [
    nodeModulesPath,
    process.env.NODE_PATH || ''
  ].filter(Boolean).join(path.delimiter);
  
  // 重新初始化模块路径
  require('module').Module._initPaths();
  
  console.log('[MCP Launcher] NODE_PATH 已设置');
} else {
  console.log('[MCP Launcher] 开发环境');
}

// 加载实际的 MCP Server
try {
  require('./mcp-server.js');
} catch (error) {
  console.error('[MCP Launcher] 启动失败:', error.message);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
}
