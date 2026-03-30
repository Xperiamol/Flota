#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 此脚本会在 npm version 的 "version" 钩子中运行，因此 package.json 已经被更新
const pkg = require('../package.json');
const newVersion = pkg.version;

let lastTag = '';
try {
  lastTag = execSync('git describe --tags --abbrev=0').toString().trim();
} catch (e) {
  console.log('未找到历史 Tag，将提取所有记录。');
}

let commitLog = '';
try {
  const range = lastTag ? `${lastTag}..HEAD` : '';
  // 提取格式类似：- fix: 修复独立窗口报错
  const command = range 
    ? `git log ${range} --pretty=format:"- %s" --no-merges`
    : `git log --pretty=format:"- %s" --no-merges`;
  commitLog = execSync(command).toString().trim();
} catch (e) {
  console.warn('获取 Git 日志失败:', e.message);
}

if (!commitLog) {
  commitLog = '- 自动生成的版本更新（无新提交详情）';
}

// 按照规范过滤出用户友好的内容，或直接使用全部内容
// 此处我们按原样追加到 Changed 板块
const dateStr = new Date().toISOString().split('T')[0];
const changelogPath = path.resolve(__dirname, '../CHANGELOG.md');

let content = '';
if (fs.existsSync(changelogPath)) {
  content = fs.readFileSync(changelogPath, 'utf8');
} else {
  content = '# Flota 更新日志\n\n';
}

const newEntry = `## [${newVersion}] - ${dateStr}

### Changed / 更新内容
${commitLog}

`;

const lines = content.split('\n');
let insertIndex = lines.length;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith('## [')) {
    insertIndex = i;
    break;
  }
}

lines.splice(insertIndex, 0, newEntry.trimEnd() + '\n\n');

fs.writeFileSync(changelogPath, lines.join('\n'));
console.log(`[auto-changelog] 成功将 ${newVersion} 生成的更新日志插入 CHANGELOG.md !`);
