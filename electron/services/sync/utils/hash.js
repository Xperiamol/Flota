/**
 * FlashNote v3.0 原子化同步系统 - Hash 工具
 *
 * 提供内容指纹计算功能，用于检测文件变更
 */

const crypto = require('crypto');

/**
 * 计算字符串的 MD5 hash
 * @param {string} content - 内容字符串
 * @returns {string} MD5 hash (32位小写十六进制)
 */
function calculateHash(content) {
  if (typeof content !== 'string') {
    content = JSON.stringify(content);
  }
  return crypto.createHash('md5').update(content, 'utf8').digest('hex');
}

/**
 * 计算 Markdown 文件的 hash
 *
 * 规则：排除 Frontmatter 中的 updated_at 字段，避免时间戳导致的误判
 *
 * @param {string} markdown - Markdown 内容
 * @returns {string} MD5 hash
 */
function calculateMarkdownHash(markdown) {
  if (!markdown || typeof markdown !== 'string') {
    return calculateHash('');
  }

  // 移除 Frontmatter 中的 updated_at
  // Frontmatter 格式: ---\nkey: value\n---
  const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
  const match = markdown.match(frontmatterRegex);

  if (match) {
    const frontmatter = match[1];
    const content = markdown.substring(match[0].length);

    // 移除 updated_at 行
    const cleanedFrontmatter = frontmatter
      .split('\n')
      .filter(line => !line.trim().startsWith('updated_at:'))
      .join('\n');

    const cleanedMarkdown = `---\n${cleanedFrontmatter}\n---${content}`;
    return calculateHash(cleanedMarkdown);
  }

  return calculateHash(markdown);
}

/**
 * 计算 JSON 对象的 hash
 *
 * 规则：按 key 排序后序列化，确保相同内容生成相同 hash
 *
 * @param {Object} obj - JSON 对象
 * @param {Array<string>} [excludeKeys=[]] - 需要排除的键（如 updated_at）
 * @returns {string} MD5 hash
 */
function calculateJsonHash(obj, excludeKeys = []) {
  if (!obj || typeof obj !== 'object') {
    return calculateHash('');
  }

  // 深度克隆并移除排除的键
  const cleaned = deepCloneWithoutKeys(obj, excludeKeys);

  // 按键排序后序列化
  const sorted = sortObjectKeys(cleaned);
  const jsonString = JSON.stringify(sorted);

  return calculateHash(jsonString);
}

/**
 * 计算待办列表的 hash
 *
 * 规则：按 id 排序，排除 updated_at 字段
 *
 * @param {Array<import('../types').TodoItem>} todos - 待办列表
 * @returns {string} MD5 hash
 */
function calculateTodosHash(todos) {
  if (!Array.isArray(todos) || todos.length === 0) {
    return calculateHash('[]');
  }

  // 排序并清理（移除非同步字段 db_id、updated_at）
  const cleaned = todos
    .map(todo => {
      const { updated_at, db_id, ...rest } = todo;
      return rest;
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return calculateJsonHash(cleaned);
}

/**
 * 计算设置的 hash
 *
 * 规则：按 key 排序
 *
 * @param {import('../types').SettingsData} settings - 设置对象
 * @returns {string} MD5 hash
 */
function calculateSettingsHash(settings) {
  return calculateJsonHash(settings);
}

/**
 * 深度克隆对象，同时移除指定的键
 * @param {any} obj - 原对象
 * @param {Array<string>} excludeKeys - 需要排除的键
 * @returns {any} 清理后的对象
 */
function deepCloneWithoutKeys(obj, excludeKeys = []) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => deepCloneWithoutKeys(item, excludeKeys));
  }

  const cloned = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key) && !excludeKeys.includes(key)) {
      cloned[key] = deepCloneWithoutKeys(obj[key], excludeKeys);
    }
  }
  return cloned;
}

/**
 * 递归排序对象的键
 * @param {any} obj - 原对象
 * @returns {any} 排序后的对象
 */
function sortObjectKeys(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }

  const sorted = {};
  const keys = Object.keys(obj).sort();

  for (const key of keys) {
    sorted[key] = sortObjectKeys(obj[key]);
  }

  return sorted;
}

/**
 * 验证两个 hash 是否相同
 * @param {string} hash1 - Hash 1
 * @param {string} hash2 - Hash 2
 * @returns {boolean} 是否相同
 */
function compareHashes(hash1, hash2) {
  return hash1 === hash2;
}

module.exports = {
  calculateHash,
  calculateMarkdownHash,
  calculateJsonHash,
  calculateTodosHash,
  calculateSettingsHash,
  compareHashes,
  deepCloneWithoutKeys,
  sortObjectKeys,
};
