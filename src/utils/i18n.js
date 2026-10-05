import zhCN from '../locales/zh-CN';
import enUS from '../locales/en-US';

// 预声明 date-fns locale，使用显式映射避免包导出限制导致的 glob 报错
const DATE_FNS_LOCALE_MODULES = {
  'zh-CN': () => import('date-fns/locale/zh-CN'),
  'en-US': () => import('date-fns/locale/en-US')
};

// 支持的语言列表
export const SUPPORTED_LANGUAGES = [
  { code: 'zh-CN', name: '简体中文', nativeName: '简体中文' },
  { code: 'en-US', name: 'English', nativeName: 'English' }
];

// 语言资源映射
const LANGUAGE_RESOURCES = {
  'zh-CN': zhCN,
  'en-US': enUS
};

// 默认语言：跟随系统语言，中文系统用 zh-CN，其余回退到 en-US
function detectSystemLanguage() {
  const nav = typeof navigator !== 'undefined' ? (navigator.language || '') : '';
  return /^zh\b/i.test(nav) ? 'zh-CN' : 'en-US';
}
const DEFAULT_LANGUAGE = detectSystemLanguage();

// 当前语言
let currentLanguage = DEFAULT_LANGUAGE;
let currentMessages = LANGUAGE_RESOURCES[DEFAULT_LANGUAGE];

/**
 * 初始化i18n系统
 * @param {string} language - 语言代码
 */
export function initI18n(language = DEFAULT_LANGUAGE) {
  const lang = SUPPORTED_LANGUAGES.find(l => l.code === language) ? language : DEFAULT_LANGUAGE;
  currentLanguage = lang;
  currentMessages = LANGUAGE_RESOURCES[lang] || LANGUAGE_RESOURCES[DEFAULT_LANGUAGE];
  
  // 设置document语言属性
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
  }
  
  return currentMessages;
}

/**
 * 获取当前语言代码
 */
export function getCurrentLanguage() {
  return currentLanguage;
}

/**
 * 获取当前语言的所有消息
 */
export function getMessages() {
  return currentMessages;
}

/**
 * 获取翻译文本
 * @param {string} key - 翻译键，支持点号分隔的嵌套路径，如 'todo.dialog.editTitle'
 * @param {object} params - 可选的参数对象，用于替换占位符或配置选项
 * @returns {string|object|array} 翻译后的文本或对象
 */
export function t(key, params = {}) {
  if (!key) return '';
  
  // 支持点号分隔的嵌套路径
  const keys = key.split('.');
  let value = currentMessages;
  
  for (const k of keys) {
    if (value && typeof value === 'object') {
      value = value[k];
    } else {
      // 如果路径不存在，返回键本身作为后备
      console.warn(`Translation key not found: ${key}`);
      return key;
    }
  }
  
  // 如果指定了returnObjects且值是对象或数组，直接返回
  if (params.returnObjects && (Array.isArray(value) || typeof value === 'object')) {
    return value;
  }

  // 如果值未找到（undefined 或 null），记录键未找到并返回键本身
  if (value === undefined || value === null) {
    console.warn(`Translation key not found: ${key}`);
    return key;
  }
  
  // 如果最终值不是字符串，记录并返回键本身
  if (typeof value !== 'string') {
    console.warn(`Translation value is not a string: ${key}`);
    return key;
  }
  
  // 替换参数占位符 {paramName}
  let result = value;
  Object.keys(params).forEach(paramKey => {
    if (paramKey !== 'returnObjects') { // 跳过returnObjects参数
      const placeholder = `{${paramKey}}`;
      result = result.replace(new RegExp(placeholder, 'g'), params[paramKey]);
    }
  });
  
  return result;
}

/**
 * 切换语言
 * @param {string} language - 新的语言代码
 */
export function changeLanguage(language) {
  return initI18n(language);
}

/**
 * React Hook: 使用国际化
 * 这个hook会返回翻译函数和当前语言信息
 */
export function useTranslation() {
  return {
    t,
    language: currentLanguage,
    messages: currentMessages,
    changeLanguage
  };
}

// date-fns 语言包 key（与路径名一致）
export const DATE_FNS_LOCALES = {
  'zh-CN': 'zh-CN',
  'en-US': 'en-US'
};

/**
 * 获取date-fns的locale对象
 * @param {string} language - 语言代码
 */
export async function getDateFnsLocale(language = currentLanguage) {
  const localeKey = DATE_FNS_LOCALES[language] || DATE_FNS_LOCALES[DEFAULT_LANGUAGE];
  const loader = DATE_FNS_LOCALE_MODULES[localeKey];

  if (loader) {
    const mod = await loader();
    return mod.default || mod[localeKey] || Object.values(mod)[0];
  }

  // 回退到英文
  const fallback = DATE_FNS_LOCALE_MODULES['en-US'];
  if (fallback) {
    const mod = await fallback();
    return mod.default || mod['en-US'] || Object.values(mod)[0];
  }

  return null;
}

export default {
  t,
  initI18n,
  getCurrentLanguage,
  getMessages,
  changeLanguage,
  useTranslation,
  getDateFnsLocale,
  SUPPORTED_LANGUAGES,
  DATE_FNS_LOCALES
};
