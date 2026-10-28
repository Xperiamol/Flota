const definitions = require('../../settingsCatalog.json');

const validateChanges = changes => {
  if (!Array.isArray(changes) || !changes.length || changes.length > 10) throw new Error('一次请修改 1–10 项设置');
  const seen = new Set();
  return changes.map(change => {
    const setting = definitions.find(item => item.key === change?.key);
    if (!setting || seen.has(change.key)) throw new Error(`不支持或重复的设置：${change?.key}`);
    seen.add(change.key);
    const value = change.value;
    const valid = setting.options ? typeof value === 'string' && Object.hasOwn(setting.options, value)
      : setting.type === 'boolean' ? typeof value === 'boolean'
        : Number.isInteger(value) && value >= setting.min && value <= setting.max;
    if (!valid) throw new Error(`${setting.label}的值不合法`);
    return { key: setting.key, value };
  });
};
const displayValue = (setting, value) => value == null ? '未读取' : setting.options?.[value] || (typeof value === 'boolean' ? value ? '开启' : '关闭' : String(value));
const summarizeChanges = changes => changes.map(({ key, value }) => {
  const setting = definitions.find(item => item.key === key);
  return `${setting.label} → ${displayValue(setting, value)}`;
}).join('；');

module.exports = {
  get_settings: async (_args, _runtime, services) => JSON.stringify({ settings: definitions.map(setting => ({
    ...setting,
    value: setting.store === 'database' ? services.settingDAO?.get(setting.key)?.value ?? setting.default : services.appSettings?.[setting.key] ?? null,
  })) }),
  update_settings: async args => {
    try {
      const changes = validateChanges(args.changes);
      // 确认后由发起操作的窗口调用正常设置接口，应用外观与本机偏好。
      return JSON.stringify({ success: true, settingsChanges: changes, message: summarizeChanges(changes) });
    } catch (error) { return JSON.stringify({ success: false, error: error.message }); }
  },
};
// 校验同时用于生成确认卡，非法参数不会生成待执行操作。
Object.defineProperties(module.exports, { validateChanges: { value: validateChanges }, summarizeChanges: { value: summarizeChanges } });
