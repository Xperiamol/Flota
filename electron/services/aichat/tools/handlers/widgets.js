/**
 * 组件相关工具的 handlers。
 * - create_widget / update_widget：确认后由渲染层执行（生成 → 沙箱预跑 → 自动修复 → 保存），
 *   进度与结果预览显示在确认卡片里；这里的 handler 只在无界面时兜底。
 * - create_widget_instance / add_widget_records：确认后直接在主进程执行。
 */

const MAX_CODE_CHARS = 60000;

const unavailable = () => JSON.stringify({ error: '组件服务不可用' });

const list_widgets = async (_args, _runtime, { widgetService }) => {
  if (!widgetService) return unavailable();
  const widgets = widgetService.listWidgets().map((widget) => ({
    id: widget.id,
    name: widget.name,
    description: widget.manifest.description,
    pinned: widget.pinned,
    instances: widgetService.dao.listInstances(widget.id).map((instance) => ({
      id: instance.id,
      name: instance.name,
      collections: widgetService.dao.listCollections(instance.id),
    })),
  }));
  return JSON.stringify({ count: widgets.length, widgets });
};

const get_widget = async (args, _runtime, { widgetService }) => {
  if (!widgetService) return unavailable();
  if (!args.id) return JSON.stringify({ error: '请提供组件 id' });
  try {
    const widget = widgetService.getWidget(args.id, { withCode: true });
    const sampleSize = Math.min(Number(args.sample_size) || 5, 20);
    const instances = widgetService.dao.listInstances(widget.id).map((instance) => ({
      id: instance.id,
      name: instance.name,
      collections: widgetService.dao.listCollections(instance.id).map((item) => ({
        ...item,
        samples: widgetService.dao.listRecords(instance.id, item.collection).slice(0, sampleSize),
      })),
    }));
    return JSON.stringify({
      id: widget.id,
      name: widget.name,
      manifest: widget.manifest,
      instances,
      code: args.include_code === false ? undefined : String(widget.code || '').slice(0, MAX_CODE_CHARS),
    });
  } catch (error) {
    return JSON.stringify({ error: error.message });
  }
};

const create_widget_instance = async (args, _runtime, { widgetService }) => {
  if (!widgetService) return unavailable();
  try {
    const instance = widgetService.createInstance(args.widget_id, args.name);
    return JSON.stringify({ success: true, instance_id: instance.id, name: instance.name });
  } catch (error) {
    return JSON.stringify({ success: false, error: error.message });
  }
};

const add_widget_records = async (args, _runtime, { widgetService }) => {
  if (!widgetService) return unavailable();
  try {
    const count = widgetService.addRecordsFromAI(args.instance_id, args.collection, args.records);
    return JSON.stringify({ success: true, inserted: count });
  } catch (error) {
    return JSON.stringify({ success: false, error: error.message });
  }
};

const runInApp = async () => JSON.stringify({ error: '组件需要在 Flota 界面中生成与预览，请在确认卡片上点击确认' });

module.exports = {
  list_widgets,
  get_widget,
  create_widget_instance,
  add_widget_records,
  create_widget: runInApp,
  update_widget: runInApp,
};
