/**
 * Schedule Model 前端显示工具
 *
 * 统一处理重复待办（recurring）和普通待办的完成状态判断，
 * 避免各组件各自实现造成不一致。
 */

/**
 * 获取今天日期字符串 (YYYY-MM-DD，本地时区)
 * @returns {string}
 */
export function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 判断一个 todo 是否为重复待办
 * @param {object} todo
 * @returns {boolean}
 */
export function isRecurringTodo(todo) {
  return !!(todo.repeat_type && todo.repeat_type !== 'none');
}

/**
 * 判断 todo 在当天是否已完成。
 *
 * - 重复待办（Schedule Model）：
 *   1. due_date > 今天 → 下一周期未到，当前状态为 ACTIVE（未完成）
 *      即使 completions 包含今天也是如此——因为完成今天后 due_date 已推进，
 *      代表的是"下一周期"而非"今天的周期"。
 *   2. 否则检查 completions 是否包含今天
 * - 普通待办：读取 completed / is_completed 字段
 *
 * 此逻辑与手机端 MainViewModel.toFlashItem() 保持一致。
 *
 * @param {object} todo
 * @returns {boolean}
 */
export function isTodoCompleted(todo) {
  if (isRecurringTodo(todo)) {
    // due_date > today → 下一周期尚未到来，始终视为未完成
    if (todo.due_date) {
      const dueDateStr = String(todo.due_date).substring(0, 10);
      if (dueDateStr > getTodayStr()) return false;
    }
    const todayStr = getTodayStr();
    const completions = parseCompletions(todo.completions);
    return completions.includes(todayStr);
  }
  return Boolean(todo.completed || todo.is_completed);
}

/**
 * 解析 completions 字段为数组
 * @param {string|Array} completions
 * @returns {string[]}
 */
export function parseCompletions(completions) {
  if (Array.isArray(completions)) return completions;
  if (!completions || completions === '[]') return [];
  try {
    const parsed = JSON.parse(completions);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 判断 todo 是否逾期（due_date 的日期部分 < 今天，且未完成）
 * @param {object} todo
 * @returns {boolean}
 */
export function isTodoOverdue(todo) {
  if (!todo.due_date) return false;
  if (isTodoCompleted(todo)) return false;
  const dueDateStr = String(todo.due_date).substring(0, 10);
  return dueDateStr < getTodayStr();
}

/**
 * 判断 todo 是否今天到期
 * @param {object} todo
 * @returns {boolean}
 */
export function isTodoDueToday(todo) {
  if (!todo.due_date) return false;
  const dueDateStr = String(todo.due_date).substring(0, 10);
  return dueDateStr === getTodayStr();
}

/**
 * 判断重复待办的 due_date 是否在今天之后（未来周期，不可提前完成）。
 * due_date > today 表示上一周期已完成并推进到下一个周期，该周期尚未到来。
 * @param {object} todo
 * @returns {boolean}
 */
export function isFutureRecurringTodo(todo) {
  if (!isRecurringTodo(todo)) return false;
  if (!todo.due_date) return false;
  const dueDateStr = String(todo.due_date).substring(0, 10);
  return dueDateStr > getTodayStr();
}
