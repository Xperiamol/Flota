/**
 * 定时任务工具：schedule_task / cancel_scheduled_task 需要用户确认；list_scheduled_tasks 只读。
 */
const REPEAT_LABELS = { once: '一次', daily: '每天', weekdays: '每个工作日', weekly: '每周', monthly: '每月' };

const describe = (task) => ({
  id: task.id,
  title: task.title,
  prompt: task.prompt,
  repeat: REPEAT_LABELS[task.repeat] || task.repeat,
  next_run: task.finished ? null : new Date(task.nextRunAt).toLocaleString('zh-CN', { hour12: false }),
  last_run: task.lastRunAt ? new Date(task.lastRunAt).toLocaleString('zh-CN', { hour12: false }) : null,
  last_status: task.lastStatus || null,
});

const unavailable = () => JSON.stringify({ success: false, error: '定时任务服务不可用' });

const schedule_task = async (args, _runtime, { automationScheduler }) => {
  if (!automationScheduler) return unavailable();
  try {
    const task = automationScheduler.add(args);
    return JSON.stringify({ success: true, task: describe(task), message: `已安排「${task.title}」，下次 ${describe(task).next_run}` });
  } catch (error) {
    return JSON.stringify({ success: false, error: error.message });
  }
};

const list_scheduled_tasks = async (_args, _runtime, { automationScheduler }) => {
  if (!automationScheduler) return unavailable();
  return JSON.stringify({ tasks: automationScheduler.list().map(describe) });
};

const cancel_scheduled_task = async (args, _runtime, { automationScheduler }) => {
  if (!automationScheduler) return unavailable();
  return automationScheduler.remove(String(args.id || ''))
    ? JSON.stringify({ success: true, message: '已取消这个定时任务' })
    : JSON.stringify({ success: false, error: `没有找到定时任务 ${args.id}，先用 list_scheduled_tasks 查看` });
};

module.exports = { schedule_task, list_scheduled_tasks, cancel_scheduled_task, REPEAT_LABELS };
