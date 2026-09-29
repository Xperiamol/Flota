const fs = require('fs').promises;

/**
 * 把任意时间值转成笔记表使用的 UTC SQLite 时间（YYYY-MM-DD HH:MM:SS）。
 * 无法解析或晚于现在（留 1 分钟时钟误差）时返回 null，由调用方退回"现在"。
 */
function toStoredTime(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time) || time <= 0 || time > Date.now() + 60 * 1000) return null;
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * 读取文件原来的创建 / 修改时间，导入时让笔记落在它真正写成的那天。
 * 复制过的文件创建时间会变成复制那一刻，而修改时间通常保留，所以创建时间取两者中较早的。
 * 取不到时返回空对象。
 */
async function getFileTimes(filePath) {
  try {
    const stats = await fs.stat(filePath);
    const modified = stats.mtimeMs > 0 ? stats.mtimeMs : null;
    const born = stats.birthtimeMs > 0 ? stats.birthtimeMs : null;
    const created = born && modified ? Math.min(born, modified) : (born || modified);
    if (!created) return {};
    return {
      created_at: new Date(created).toISOString(),
      updated_at: new Date(modified || created).toISOString()
    };
  } catch {
    return {};
  }
}

module.exports = { toStoredTime, getFileTimes };
