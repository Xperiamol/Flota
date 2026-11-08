/**
 * AI 定时任务：模型用 schedule_task 给自己安排的事（每天早上做简报、周五提醒复盘、三天后检查进度……）。
 *
 * 到点后在这条任务自己的对话里跑一轮普通的 AI 对话：要做什么由模型按任务说明决定；
 * 写入类操作照常生成确认卡，等用户回来确认，不会静默改数据。跑完发系统通知，点击打开这条对话。
 * 只保存在本机（不随同步），避免多台设备重复执行；应用关闭期间错过的，12 小时内补跑一次。
 */
const STORAGE_KEY = 'ai_automations';
const TICK_MS = 30 * 1000;
const CATCH_UP_MS = 12 * 60 * 60 * 1000;
const MAX_TASKS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const REPEATS = ['once', 'daily', 'weekdays', 'weekly', 'monthly'];

/**
 * 下一次运行时间（严格晚于 now）。
 * monthly 按原定的「几号」推进，短月落在月末（1 月 31 日 → 2 月 28 日 → 3 月 31 日）
 */
const nextOccurrence = (at, repeat, now, dayOfMonth = new Date(at).getDate()) => {
  let next = at;
  const step = () => {
    const date = new Date(next);
    if (repeat === 'monthly') {
      const target = new Date(date.getFullYear(), date.getMonth() + 1, 1, date.getHours(), date.getMinutes());
      const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      target.setDate(Math.min(dayOfMonth, lastDay));
      next = target.getTime();
      return;
    }
    if (repeat === 'weekly') date.setDate(date.getDate() + 7);
    else date.setDate(date.getDate() + 1);
    if (repeat === 'weekdays') while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
    next = date.getTime();
  };
  if (repeat === 'weekdays') {
    const date = new Date(next);
    while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
    next = date.getTime();
  }
  while (next <= now) step();
  return next;
};

class AutomationScheduler {
  /**
   * @param {object} deps
   * @param {{ get: Function, set: Function }} deps.settingDAO
   * @param {(task) => Promise<{ success, content?, error?, pendingCards? }>} deps.runTask  跑一轮对话
   * @param {(task, outcome) => void} [deps.notify]  跑完后的系统通知
   * @param {() => number} [deps.now]
   */
  constructor({ settingDAO, runTask, notify, logger, now = () => Date.now() }) {
    this.settingDAO = settingDAO;
    this.runTask = runTask;
    this.notify = notify || (() => {});
    this.logger = logger || console;
    this.now = now;
    this.timer = null;
    this.running = new Set();
  }

  _read() {
    try {
      const raw = this.settingDAO.get(STORAGE_KEY)?.value;
      const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(list) ? list : [];
    } catch (_) {
      return [];
    }
  }

  _write(list) {
    this.settingDAO.set(STORAGE_KEY, JSON.stringify(list), 'string', 'AI 定时任务（仅本机）');
  }

  list() {
    return this._read().sort((a, b) => a.nextRunAt - b.nextRunAt);
  }

  /** @returns 新任务；参数不合法时抛错，错误信息直接给模型看 */
  add({ title, prompt, at, repeat = 'once' } = {}) {
    const name = String(title || '').trim().slice(0, 40);
    const instruction = String(prompt || '').trim();
    if (!name) throw new Error('需要 title（简短的任务名）');
    if (!instruction) throw new Error('需要 prompt（到点后要做的事，写完整）');
    if (!REPEATS.includes(repeat)) throw new Error(`repeat 只能是 ${REPEATS.join(' / ')}`);
    const time = typeof at === 'number' ? at : Date.parse(String(at || ''));
    if (!Number.isFinite(time)) throw new Error('at 需要是时间，如 2026-11-09T08:00（本地时间）');
    const now = this.now();
    if (repeat === 'once' && time <= now) throw new Error('一次性任务的时间必须晚于现在');
    const list = this._read();
    if (list.length >= MAX_TASKS) throw new Error(`定时任务最多 ${MAX_TASKS} 个，请先取消不需要的`);
    const task = {
      id: `auto_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      title: name,
      prompt: instruction,
      repeat,
      nextRunAt: repeat === 'once' ? time : nextOccurrence(time, repeat, now - 1),
      dayOfMonth: new Date(time).getDate(),
      createdAt: now,
      lastRunAt: null,
      lastStatus: null,
    };
    this._write([...list, task]);
    return task;
  }

  remove(id) {
    const list = this._read();
    const next = list.filter((task) => task.id !== id);
    if (next.length === list.length) return false;
    this._write(next);
    return true;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { this.tick().catch((error) => this.logger.warn?.('Automation', 'tick failed', error?.message)); }, TICK_MS);
    this.tick().catch(() => {});
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    const now = this.now();
    const due = this._read().filter((task) => task.nextRunAt <= now && !this.running.has(task.id));
    for (const task of due) {
      // 先把下一次时间写好，再执行：执行很慢或失败也不会重复触发
      const missed = now - task.nextRunAt > CATCH_UP_MS;
      this._advance(task.id, now, missed ? 'skipped' : 'running');
      if (missed) continue;
      this.running.add(task.id);
      try {
        const outcome = await this.runTask(task);
        this._setStatus(task.id, outcome?.success ? 'done' : 'failed');
        this.notify(task, outcome || {});
      } catch (error) {
        this._setStatus(task.id, 'failed');
        this.notify(task, { success: false, error: error.message });
      } finally {
        this.running.delete(task.id);
      }
    }
  }

  _advance(id, now, status) {
    const list = this._read();
    const next = list.flatMap((task) => {
      if (task.id !== id) return [task];
      if (task.repeat === 'once') return status === 'skipped' ? [] : [{ ...task, nextRunAt: Number.MAX_SAFE_INTEGER, lastRunAt: now, lastStatus: status, finished: true }];
      return [{ ...task, nextRunAt: nextOccurrence(task.nextRunAt, task.repeat, now, task.dayOfMonth), lastRunAt: now, lastStatus: status }];
    });
    this._write(next);
  }

  _setStatus(id, status) {
    const list = this._read();
    // 一次性任务跑完就移除；重复任务记下结果
    this._write(list.flatMap((task) => (task.id !== id ? [task] : task.finished ? [] : [{ ...task, lastStatus: status }])));
  }
}

AutomationScheduler.nextOccurrence = nextOccurrence;
AutomationScheduler.REPEATS = REPEATS;
AutomationScheduler.DAY_MS = DAY_MS;
module.exports = AutomationScheduler;
