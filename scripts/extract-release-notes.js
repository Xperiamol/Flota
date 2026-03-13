#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const changelogPath = path.resolve(process.cwd(), 'CHANGELOG.md');

function parseArgs(argv) {
  const args = { version: null, out: null };

  argv.forEach((arg) => {
    if (arg.startsWith('--version=')) {
      args.version = arg.slice('--version='.length).trim();
    } else if (arg.startsWith('--out=')) {
      args.out = arg.slice('--out='.length).trim();
    }
  });

  return args;
}

function findSection(content, version) {
  const lines = content.split(/\r?\n/);
  const headingIndexes = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) {
      headingIndexes.push(i);
    }
  }

  if (headingIndexes.length === 0) {
    throw new Error('未找到版本标题，请检查 CHANGELOG.md 格式。');
  }

  let startIndex = headingIndexes[0];
  if (version) {
    const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const targetReg = new RegExp(`^##\\s+(?:\\[)?${escaped}(?:\\])?(?:\\s*-|\\s*\\(|\\s*$)`);
    startIndex = headingIndexes.find((idx) => targetReg.test(lines[idx]));

    if (startIndex === undefined) {
      throw new Error(`未找到版本 ${version} 对应的条目。`);
    }
  }

  const startPos = headingIndexes.indexOf(startIndex);
  const nextIndex = headingIndexes[startPos + 1] ?? lines.length;

  const section = lines.slice(startIndex, nextIndex).join('\n').trim();
  if (!section) {
    throw new Error('找到版本标题，但条目内容为空。');
  }

  return section + '\n';
}

function main() {
  const { version, out } = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(changelogPath)) {
    throw new Error(`未找到文件: ${changelogPath}`);
  }

  const content = fs.readFileSync(changelogPath, 'utf8');
  const notes = findSection(content, version);

  if (out) {
    const outPath = path.resolve(process.cwd(), out);
    fs.writeFileSync(outPath, notes, 'utf8');
    process.stdout.write(`已写入: ${outPath}\n`);
    return;
  }

  process.stdout.write(notes);
}

try {
  main();
} catch (error) {
  process.stderr.write(`[extract-release-notes] ${error.message}\n`);
  process.exit(1);
}
