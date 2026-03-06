const { addDays, addWeeks, addMonths, addYears, format, parseISO, isValid } = require('date-fns');

/**
 * 重复事项工具类
 */
class RepeatUtils {
  /**
   * 计算下次重复日期
   * @param {string} currentDate - 当前日期 (ISO格式)
   * @param {string} repeatType - 重复类型: 'daily', 'weekly', 'monthly', 'yearly', 'custom'
   * @param {number} repeatInterval - 重复间隔
   * @param {string} repeatDays - 重复天数 (用于weekly类型，格式: '1,2,3' 表示周一、周二、周三)
   * @returns {string|null} 下次重复日期 (ISO格式) 或 null
   */
  static calculateNextDueDate(currentDate, repeatType, repeatInterval = 1, repeatDays = '') {
    if (!currentDate || repeatType === 'none') {
      return null;
    }

    try {
      const date = typeof currentDate === 'string' ? parseISO(currentDate) : currentDate;
      if (!isValid(date)) {
        return null;
      }

      switch (repeatType) {
        case 'daily':
          return format(addDays(date, repeatInterval), 'yyyy-MM-dd\'T\'HH:mm:ss');

        case 'weekly':
          if (repeatDays) {
            // 自定义周重复
            return this.calculateNextWeeklyDate(date, repeatDays, repeatInterval);
          } else {
            // 简单周重复
            return format(addWeeks(date, repeatInterval), 'yyyy-MM-dd\'T\'HH:mm:ss');
          }

        case 'monthly':
          return format(addMonths(date, repeatInterval), 'yyyy-MM-dd\'T\'HH:mm:ss');

        case 'yearly':
          return format(addYears(date, repeatInterval), 'yyyy-MM-dd\'T\'HH:mm:ss');

        case 'custom':
          // 自定义重复逻辑
          return this.calculateCustomRepeat(date, repeatDays, repeatInterval);

        default:
          return null;
      }
    } catch (error) {
      console.error('计算下次重复日期失败:', error);
      return null;
    }
  }

  /**
   * 计算下次周重复日期
   * @param {Date} currentDate - 当前日期
   * @param {string} repeatDays - 重复天数 '1,2,3' (1=周一, 2=周二, ..., 7=周日)
   * @param {number} repeatInterval - 重复间隔（周数）
   * @returns {string} 下次重复日期
   */
  static calculateNextWeeklyDate(currentDate, repeatDays, repeatInterval = 1) {
    const days = repeatDays.split(',').map(d => parseInt(d.trim())).filter(d => d >= 1 && d <= 7);
    if (days.length === 0) {
      return format(addWeeks(currentDate, repeatInterval), 'yyyy-MM-dd\'T\'HH:mm:ss');
    }

    // 将周日从7转换为0，其他天数保持不变 (JavaScript Date.getDay()格式: 0=周日, 1=周一, ..., 6=周六)
    const jsDays = days.map(d => d === 7 ? 0 : d);
    const currentDay = currentDate.getDay();
    
    // 查找本周内最近的下一个重复日
    const sortedDays = [...jsDays].sort((a, b) => a - b);
    const nextDayInWeek = sortedDays.find(day => day > currentDay);
    
    if (nextDayInWeek !== undefined) {
      // 本周内有下一个重复日
      const daysToAdd = nextDayInWeek - currentDay;
      return format(addDays(currentDate, daysToAdd), 'yyyy-MM-dd\'T\'HH:mm:ss');
    } else {
      // 本周内没有下一个重复日，找下个重复周期的第一个重复日
      const firstDayNextCycle = Math.min(...jsDays);
      // 计算到下一个重复周期第一天的天数
      let daysToAdd = 7 - currentDay + firstDayNextCycle;
      // 如果重复间隔大于1，需要额外跳过几周
      if (repeatInterval > 1) {
        daysToAdd += (repeatInterval - 1) * 7;
      }
      return format(addDays(currentDate, daysToAdd), 'yyyy-MM-dd\'T\'HH:mm:ss');
    }
  }

  /**
   * 计算自定义重复日期
   * @param {Date} currentDate - 当前日期
   * @param {string} repeatDays - 自定义重复规则
   * @param {number} repeatInterval - 重复间隔
   * @returns {string} 下次重复日期
   */
  static calculateCustomRepeat(currentDate, repeatDays, repeatInterval) {
    // 这里可以实现更复杂的自定义重复逻辑
    // 目前简单处理为按天重复
    return format(addDays(currentDate, repeatInterval), 'yyyy-MM-dd\'T\'HH:mm:ss');
  }

  // ── Schedule model helpers ──────────────────────────────

  /**
   * 今天的日期字符串 (YYYY-MM-DD，本地时区)
   * @returns {string}
   */
  static todayKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * 解析 completions JSON 字符串为数组
   * @param {string|Array} completions
   * @returns {string[]}
   */
  static parseCompletions(completions) {
    if (Array.isArray(completions)) return [...completions];
    if (!completions || completions === '[]') return [];
    try {
      const parsed = JSON.parse(completions);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * 判断重复待办在当天是否已完成。
   * 逻辑：直接检查 completions 数组中是否包含今天的日期 key。
   * 比之前基于 due_date 位置的方案更可靠，不会混淆"due_date 本身就在未来"
   * 和"因完成而推进到未来"两种情况。
   * @param {string|Array} completions - completions JSON 字符串或数组
   * @param {string} repeatType
   * @returns {boolean}
   */
  static isCompletedForToday(completions, repeatType) {
    if (!repeatType || repeatType === 'none') return false;
    const list = this.parseCompletions(completions);
    return list.includes(this.todayKey());
  }

  /**
   * 对逾期的 due_date 进行修正：如果 due_date 的日期部分早于今天，
   * 将其日期替换为今天（保留时间部分），使 calculateNextDueDate 从今天开始推进。
   * @param {string} dueDate
   * @returns {string}
   */
  static adjustOverdueDueDate(dueDate) {
    if (!dueDate) return dueDate;
    const todayStr = this.todayKey();
    const dueKey = dueDate.substring(0, 10);
    if (dueKey < todayStr) {
      const timePart = dueDate.length > 10 ? dueDate.substring(10) : '';
      return todayStr + timePart;
    }
    return dueDate;
  }

  /**
   * 清理超过 keepDays 天的旧 completion 记录
   * @param {string[]} completions - 日期字符串数组
   * @param {number} keepDays
   * @returns {string[]}
   */
  static gcCompletions(completions, keepDays = 90) {
    if (!completions || completions.length === 0) return [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - keepDays);
    const cutoffStr = format(cutoff, 'yyyy-MM-dd');
    return completions.filter(d => d >= cutoffStr);
  }

  /**
   * 合并两端的 completions 数组（取并集，去重排序）
   * @param {string[]} a
   * @param {string[]} b
   * @returns {string[]}
   */
  static mergeCompletions(a, b) {
    return [...new Set([...a, ...b])].sort();
  }
}

module.exports = RepeatUtils;