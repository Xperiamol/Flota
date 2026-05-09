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
      // 关键：先把 UTC/带时区字符串归一化为"本地朴素时间"字符串。
      // 否则 parseISO(UTC) + addDays + format(本地) 会因为时区差跳过一天
      // （例如 2026-05-08T18:00:00Z 在 +8 时区其实是 5.9 02:00，
      //  错误推进会得到 2026-05-11T02:00:00，直接跳过 5.10）。
      const naive = typeof currentDate === 'string' ? this.toLocalNaive(currentDate) : currentDate;
      const date = typeof naive === 'string' ? parseISO(naive) : naive;
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
   * 把任意 ISO 字符串归一化为"本地朴素时间"字符串（无 Z / 无时区后缀）。
   * 例如：'2026-05-08T18:00:00.000Z' 在 UTC+8 → '2026-05-09T02:00:00'。
   * 这样后续的日期算术（按本地天数推进）和输出（按本地 wall clock 格式化）才会一致，
   * 不会因为时区差额外跳过 1 天。
   * @param {string} dateStr
   * @returns {string}
   */
  static toLocalNaive(dateStr) {
    if (!dateStr) return dateStr;
    // 已是朴素本地格式，直接返回
    if (!/Z$|[+-]\d{2}:\d{2}$/.test(dateStr)) return dateStr;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${day}T${hh}:${mm}:${ss}`;
  }

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
    // 先归一化为本地朴素时间，substring(0,10) 才能正确反映"用户视角的日期"
    const naive = this.toLocalNaive(dueDate);
    const todayStr = this.todayKey();
    const dueKey = naive.substring(0, 10);
    if (dueKey < todayStr) {
      const timePart = naive.length > 10 ? naive.substring(10) : '';
      return todayStr + timePart;
    }
    return naive;
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