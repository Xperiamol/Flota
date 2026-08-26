/**
 * better-sqlite3 智能编译管理脚本
 * 
 * 问题：better-sqlite3 需要针对不同运行时编译：
 * - Node.js 与 Electron 可能使用不同的 NODE_MODULE_VERSION
 * 
 * 解决方案：
 * - 自动检测当前编译版本
 * - 仅在需要时重新编译（避免重复编译）
 * - 提供清晰的状态输出
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 颜色输出
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * 检查当前 better-sqlite3 是否能在目标运行时中直接加载。
 * 不再根据错误文本猜 ABI（Electron 升级后 ABI 会变化），而是让目标运行时
 * 真正执行一次 require；成功即可跳过编译。
 */
function canLoadInTarget(target) {
  const modulePath = path.join(__dirname, '../node_modules/better-sqlite3/build/Release/better_sqlite3.node');
  if (!fs.existsSync(modulePath)) return false;

  if (target === 'node') {
    try {
      const Database = require('better-sqlite3');
      const db = new Database(':memory:');
      db.close();
      return true;
    } catch (_) {
      return false;
    }
  }

  try {
    const electronPath = require('electron');
    const probe = "const Database=require('better-sqlite3');const db=new Database(':memory:');db.close()";
    const result = spawnSync(electronPath, ['-e', probe], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'ignore',
      windowsHide: true
    });
    return result.status === 0;
  } catch (_) {
    return false;
  }
}

/**
 * 编译 better-sqlite3
 */
function rebuild(target) {
  log(`\n🔨 正在为 ${target} 编译 better-sqlite3...`, 'blue');
  
  try {
    if (target === 'electron') {
      execSync('npx electron-rebuild -f -w better-sqlite3', { stdio: 'inherit' });
    } else {
      execSync('npm rebuild better-sqlite3', { stdio: 'inherit' });
    }
    log(`✅ ${target} 编译完成`, 'green');
    return true;
  } catch (e) {
    log(`❌ ${target} 编译失败: ${e.message}`, 'red');
    return false;
  }
}

/**
 * 主函数
 */
function main() {
  const args = process.argv.slice(2);
  const target = args[0]; // 'electron' 或 'node'

  if (!target || !['electron', 'node'].includes(target)) {
    log('❌ 用法: node manage-sqlite.js <electron|node>', 'red');
    process.exit(1);
  }

  log(`\n📦 better-sqlite3 编译管理`, 'blue');
  log('━'.repeat(50), 'blue');

  const modulePath = path.join(__dirname, '../node_modules/better-sqlite3/build/Release/better_sqlite3.node');

  if (!fs.existsSync(modulePath)) {
    log('⚠️  better-sqlite3 未编译，需要初始化', 'yellow');
    if (!rebuild(target)) process.exitCode = 1;
  } else if (canLoadInTarget(target)) {
    log(`✅ better-sqlite3 与 ${target} 兼容，跳过编译`, 'green');
  } else {
    log(`🔄 better-sqlite3 与 ${target} 不兼容，需要切换`, 'yellow');
    if (!rebuild(target)) process.exitCode = 1;
  }

  log('\n━'.repeat(50), 'blue');
  log('✨ 完成\n', 'green');
}

if (require.main === module) main();

module.exports = { canLoadInTarget, rebuild };
