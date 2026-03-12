/**
 * electron-builder afterPack 钩子
 * 自动删除 onnxruntime-node 中非当前构建目标平台的二进制文件
 * 节省约 70MB（macOS dylib + Linux .so 对 Windows 包无用，反之亦然）
 */
const fs = require('fs');
const path = require('path');

module.exports = async ({ appOutDir, packager }) => {
  // 恢复开发环境的真实 sharp（由 beforePack 钩子备份）
  const projectRoot = packager.projectDir;
  const sharpDir = path.join(projectRoot, 'node_modules', 'sharp');
  const sharpBak = path.join(projectRoot, 'node_modules', '.sharp_dev_backup');
  if (fs.existsSync(sharpBak)) {
    if (fs.existsSync(sharpDir)) {
      fs.rmSync(sharpDir, { recursive: true, force: true });
    }
    fs.renameSync(sharpBak, sharpDir);
    console.log('[afterPack] Real sharp restored from backup');
  }

  // electron-builder 平台名 → onnxruntime-node 子目录名
  const platformDirMap = {
    windows: 'win32',
    mac: 'darwin',
    linux: 'linux'
  };

  const targetPlatform = platformDirMap[packager.platform.name];
  if (!targetPlatform) {
    console.log('[afterPack] Unknown platform, skipping onnxruntime cleanup');
    return;
  }

  const onnxBinDir = path.join(
    appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'onnxruntime-node',
    'bin',
    'napi-v3'
  );

  if (!fs.existsSync(onnxBinDir)) {
    console.log('[afterPack] onnxruntime-node bin dir not found, skipping');
    return;
  }

  let totalSavedMB = 0;

  for (const dir of fs.readdirSync(onnxBinDir)) {
    if (dir === targetPlatform) continue;
    const dirPath = path.join(onnxBinDir, dir);
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) continue;

    const sizeMB = getFolderSizeMB(dirPath);
    fs.rmSync(dirPath, { recursive: true, force: true });
    totalSavedMB += sizeMB;
    console.log(`[afterPack] Removed ${dir} binaries (saved ${sizeMB.toFixed(1)} MB)`);
  }

  if (totalSavedMB > 0) {
    console.log(`[afterPack] Total saved: ${totalSavedMB.toFixed(1)} MB`);
  }
};

function getFolderSizeMB(dir) {
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      bytes += getFolderSizeMB(fullPath) * 1024 * 1024;
    } else {
      bytes += fs.statSync(fullPath).size;
    }
  }
  return bytes / (1024 * 1024);
}
