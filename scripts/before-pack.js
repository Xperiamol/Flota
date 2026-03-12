/**
 * electron-builder beforePack 钩子
 * 将 @xenova/transformers 所需的 sharp stub 注入 node_modules/sharp，
 * 替换真实的 86MB 二进制包，避免因 static import 崩溃。
 * 真实 sharp 会被备份，afterPack 钩子会恢复它。
 */
const fs = require('fs');
const path = require('path');

exports.default = async function beforePack(context) {
  const projectRoot = context.packager.projectDir;
  const sharpDir = path.join(projectRoot, 'node_modules', 'sharp');
  const sharpBak = path.join(projectRoot, 'node_modules', '.sharp_dev_backup');
  const stubDir = path.join(projectRoot, 'stubs', 'sharp');

  if (!fs.existsSync(stubDir)) {
    console.log('[beforePack] sharp stub not found at stubs/sharp, skipping');
    return;
  }

  // 处理上次构建意外中断遗留的备份
  if (fs.existsSync(sharpBak)) {
    if (fs.existsSync(sharpDir)) {
      fs.rmSync(sharpDir, { recursive: true, force: true });
    }
    fs.renameSync(sharpBak, sharpDir);
    console.log('[beforePack] Restored sharp from previous interrupted build backup');
  }

  // 备份真实 sharp
  if (fs.existsSync(sharpDir)) {
    fs.renameSync(sharpDir, sharpBak);
    console.log('[beforePack] Real sharp backed up to .sharp_dev_backup');
  }

  // 安装 stub
  copyDir(stubDir, sharpDir);
  console.log('[beforePack] Sharp stub installed (3KB instead of ~86MB)');
};

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
