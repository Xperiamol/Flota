/**
 * 标签工具类
 * 遵循DRY原则，提供统一的标签处理函数
 * 可在前端组件中复用
 */

/**
 * 解析标签字符串为数组
 * @param {string|Array} tags - 标签字符串或数组
 * @returns {Array} 标签数组
 */
export const parseTags = (tags) => {
  if (Array.isArray(tags)) {
    return tags.map(tag => tag.toString().trim()).filter(tag => tag);
  }
  
  if (typeof tags === 'string' && tags.trim()) {
    return tags.split(',').map(tag => tag.trim()).filter(tag => tag);
  }
  
  return [];
};

/**
 * 格式化标签数组为字符串
 * @param {Array} tags - 标签数组
 * @returns {string} 标签字符串
 */
export const formatTags = (tags) => {
  if (!Array.isArray(tags)) {
    return '';
  }
  
  return tags.map(tag => tag.toString().trim()).filter(tag => tag).join(',');
};

/**
 * 标准化标签数据格式（用于前端显示）
 * @param {string|Array} tags - 标签数据
 * @returns {Array} 标准化的标签数组
 */
export const normalizeTags = (tags) => {
  return parseTags(tags);
};

/**
 * 验证标签名称
 * @param {string} tagName - 标签名称
 * @returns {Object} 验证结果
 */
export const validateTagName = (tagName) => {
  if (!tagName || typeof tagName !== 'string') {
    return { valid: false, error: '标签名称不能为空' };
  }
  
  const trimmed = tagName.trim();
  if (!trimmed) {
    return { valid: false, error: '标签名称不能为空' };
  }
  
  if (trimmed.length > 50) {
    return { valid: false, error: '标签名称不能超过50个字符' };
  }
  
  if (trimmed.includes(',')) {
    return { valid: false, error: '标签名称不能包含逗号' };
  }
  
  return { valid: true, tagName: trimmed };
};

/**
 * 批量验证标签
 * @param {Array} tags - 标签数组
 * @returns {Object} 验证结果
 */
export const validateTags = (tags) => {
  const parsedTags = parseTags(tags);
  const validTags = [];
  const errors = [];
  
  for (const tag of parsedTags) {
    const validation = validateTagName(tag);
    if (validation.valid) {
      validTags.push(validation.tagName);
    } else {
      errors.push(`标签 "${tag}": ${validation.error}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    validTags,
    errors
  };
};

/**
 * 获取标签的显示颜色（基于标签名称生成一致的颜色）
 * @param {string} tagName - 标签名称
 * @returns {string} 颜色值
 */
export const getTagColor = (tagName) => {
  if (!tagName) return '#1976d2';
  
  // 基于标签名称生成一致的颜色
  let hash = 0;
  for (let i = 0; i < tagName.length; i++) {
    hash = tagName.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  // 生成HSL颜色，确保足够的饱和度和亮度
  const hue = Math.abs(hash) % 360;
  const saturation = 60 + (Math.abs(hash) % 20); // 60-80%
  const lightness = 45 + (Math.abs(hash) % 10);  // 45-55%
  
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

export default {
  parseTags,
  formatTags,
  normalizeTags,
  validateTagName,
  validateTags,
  getTagColor
};