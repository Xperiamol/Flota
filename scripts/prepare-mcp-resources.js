#!/usr/bin/env node

/**
 * 准备 MCP Server 资源
 * 在构建前创建独立的 MCP Server 目录，包含完整依赖
 */

const fs = require('fs-extra');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MCP_BUILD = path.join(ROOT, 'mcp-build');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('准备 MCP Server 独立构建');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// 清理旧构建
if (fs.existsSync(MCP_BUILD)) {
  console.log('清理旧构建目录...');
  fs.removeSync(MCP_BUILD);
}

// 创建目录
fs.ensureDirSync(MCP_BUILD);

// 复制 MCP Server 代码
console.log('复制 MCP Server 代码...');
fs.copySync(path.join(ROOT, 'electron/mcp-server.js'), path.join(MCP_BUILD, 'mcp-server.js'));
fs.copySync(path.join(ROOT, 'electron/mcp-server-launcher.js'), path.join(MCP_BUILD, 'mcp-server-launcher.js'));
fs.copySync(path.join(ROOT, 'electron/dao'), path.join(MCP_BUILD, 'dao'));
fs.copySync(path.join(ROOT, 'electron/services'), path.join(MCP_BUILD, 'services'));
fs.copySync(path.join(ROOT, 'electron/utils'), path.join(MCP_BUILD, 'utils'));

// 创建完整的 package.json（包含 AI 和 Mem0 功能）
console.log('创建 package.json（完整版，包含 AI 功能）...');
const parentPkg = require('../package.json');
const mcpPackage = {
  name: 'flota-mcp-server',
  version: '1.0.0',
  private: true,
  description: 'Flota MCP Server - 完整版（包含 AI 和 Mem0 功能）',
  dependencies: {
    '@modelcontextprotocol/sdk': parentPkg.dependencies['@modelcontextprotocol/sdk'],
    'better-sqlite3': parentPkg.dependencies['better-sqlite3'],
    'dotenv': parentPkg.dependencies['dotenv'],
    'date-fns': parentPkg.dependencies['date-fns'],
    '@xenova/transformers': parentPkg.dependencies['@xenova/transformers'],
    'compute-cosine-similarity': parentPkg.dependencies['compute-cosine-similarity']
  }
};

fs.writeJsonSync(path.join(MCP_BUILD, 'package.json'), mcpPackage, { spaces: 2 });

console.log('\n✅ MCP Server 代码准备完成（完整版，包含 AI 和 Mem0 功能）');
console.log(`   位置: ${MCP_BUILD}`);
console.log('   依赖: MCP SDK + SQLite + AI (@xenova/transformers) + Mem0');
console.log('\n下一步: 安装依赖');
console.log('   cd mcp-build && npm install --production --no-optional');
