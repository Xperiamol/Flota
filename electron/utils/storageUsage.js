const fs = require('fs')
const fsp = fs.promises
const path = require('path')

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath)
    return true
  } catch (_) {
    return false
  }
}

async function getPathSize(targetPath) {
  if (!targetPath || !(await pathExists(targetPath))) return 0

  let stats
  try {
    stats = await fsp.stat(targetPath)
  } catch (_) {
    return 0
  }

  if (!stats.isDirectory()) {
    return stats.size || 0
  }

  let totalSize = 0
  let entries = []
  try {
    entries = await fsp.readdir(targetPath, { withFileTypes: true })
  } catch (_) {
    return 0
  }

  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name)
    if (entry.isDirectory()) {
      totalSize += await getPathSize(entryPath)
      continue
    }
    if (entry.isFile()) {
      try {
        const entryStats = await fsp.stat(entryPath)
        totalSize += entryStats.size || 0
      } catch (_) {}
    }
  }

  return totalSize
}

async function getPathsSize(paths = []) {
  let totalSize = 0
  for (const currentPath of paths) {
    totalSize += await getPathSize(currentPath)
  }
  return totalSize
}

async function getLocalUsageStats(userDataPath) {
  if (!userDataPath) {
    throw new Error('userDataPath is required')
  }

  const databasePaths = [
    path.join(userDataPath, 'database'),
    path.join(userDataPath, 'flota.db'),
    path.join(userDataPath, 'flota.db-wal'),
    path.join(userDataPath, 'flota.db-shm'),
  ]
  const imagesPaths = [
    path.join(userDataPath, 'images'),
    path.join(userDataPath, 'wallpaper'),
  ]
  const audioPaths = [
    path.join(userDataPath, 'audio'),
  ]
  const pluginsPaths = [
    path.join(userDataPath, 'plugins'),
  ]
  const syncPaths = [
    path.join(userDataPath, 'v3-sync-config.json'),
    path.join(userDataPath, 'sync-manifest.json'),
    path.join(userDataPath, 'webdav-rate-limit.json'),
  ]
  const appFilesPaths = [
    path.join(userDataPath, 'flota.log'),
    path.join(userDataPath, 'flota.log.old'),
    path.join(userDataPath, 'startup-debug.log'),
    path.join(userDataPath, 'window-state.json'),
  ]

  const categories = [
    { id: 'database', label: '数据库', sizeBytes: await getPathsSize(databasePaths) },
    { id: 'images', label: '图片与壁纸', sizeBytes: await getPathsSize(imagesPaths) },
    { id: 'audio', label: '音频', sizeBytes: await getPathsSize(audioPaths) },
    { id: 'plugins', label: '插件', sizeBytes: await getPathsSize(pluginsPaths) },
    { id: 'sync', label: '同步缓存', sizeBytes: await getPathsSize(syncPaths) },
    { id: 'appFiles', label: '日志与状态', sizeBytes: await getPathsSize(appFilesPaths) },
  ]

  const totalBytes = await getPathSize(userDataPath)
  const knownBytes = categories.reduce((sum, item) => sum + item.sizeBytes, 0)
  const otherBytes = Math.max(0, totalBytes - knownBytes)
  let diskTotalBytes = null
  let diskAvailableBytes = null

  try {
    const fileSystemStats = await fsp.statfs(userDataPath)
    if (fileSystemStats) {
      const blockSize = Number(fileSystemStats.bsize || fileSystemStats.frsize || 0)
      const totalBlocks = Number(fileSystemStats.blocks || 0)
      const availableBlocks = Number(fileSystemStats.bavail || fileSystemStats.bfree || 0)
      if (blockSize > 0 && totalBlocks > 0) {
        diskTotalBytes = blockSize * totalBlocks
      }
      if (blockSize > 0 && availableBlocks >= 0) {
        diskAvailableBytes = blockSize * availableBlocks
      }
    }
  } catch (_) {}

  return {
    userDataPath,
    totalBytes,
    diskTotalBytes,
    diskAvailableBytes,
    usageRatio: Number.isFinite(diskTotalBytes) && diskTotalBytes > 0
      ? totalBytes / diskTotalBytes
      : null,
    categories: [
      ...categories,
      { id: 'other', label: '其他', sizeBytes: otherBytes },
    ],
    updatedAt: Date.now(),
  }
}

module.exports = {
  pathExists,
  getPathSize,
  getPathsSize,
  getLocalUsageStats,
}
