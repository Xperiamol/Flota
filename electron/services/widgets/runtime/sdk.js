/*
 * Flota Widget SDK —— 运行在组件沙箱 iframe 内。
 * 通过 postMessage 与宿主通信；宿主固定了组件身份与权限，组件无法伪造。
 */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  // 需要等用户操作或较慢的调用单独放宽超时
  var CALL_TIMEOUTS = { 'ai.complete': 180000, 'files.pick': 600000, 'files.save': 600000, 'ui.confirm': 600000 };
  var seq = 0;
  var pending = new Map();
  var listeners = new Map();

  function post(message) {
    message.__flota = 1;
    window.parent.postMessage(message, '*');
  }

  function emit(event, payload) {
    var set = listeners.get(event);
    if (!set) return;
    set.forEach(function (fn) {
      try { fn(payload); } catch (error) { reportError(error); }
    });
  }

  function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return function () { listeners.get(event).delete(fn); };
  }

  function call(method, callParams) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      var timer = setTimeout(function () {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error('Flota 调用超时：' + method));
      }, CALL_TIMEOUTS[method] || 30000);
      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      post({ type: 'rpc', id: id, method: method, params: callParams || {} });
    });
  }

  function reportError(error, extra) {
    var message = error && error.message ? error.message : String(error);
    post({ type: 'error', message: message, stack: error && error.stack ? String(error.stack).slice(0, 4000) : '', extra: extra || '' });
  }

  // ---------- 环境 ----------
  var env = {
    instanceId: params.get('instance') || '',
    instanceName: '',
    size: params.get('size') || 'medium',
    surface: params.get('surface') || 'note',
    theme: params.get('theme') === 'dark' ? 'dark' : 'light',
    locale: params.get('locale') || 'zh-CN',
    draft: params.get('draft') === '1'
  };

  function applyEnv(next) {
    if (!next) return;
    Object.keys(next).forEach(function (key) {
      if (key !== 'vars') env[key] = next[key];
    });
    var root = document.documentElement;
    root.setAttribute('data-theme', env.theme);
    root.setAttribute('data-size', env.size);
    root.setAttribute('data-surface', env.surface);
    if (next.vars) {
      Object.keys(next.vars).forEach(function (name) { root.style.setProperty(name, next.vars[name]); });
    }
  }
  applyEnv({});

  var readyResolve;
  var ready = new Promise(function (resolve) { readyResolve = resolve; });

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var message = event.data;
    if (!message || message.__flota !== 1) return;
    if (message.type === 'rpc-result') {
      var entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) {
        var err = new Error(message.error.message || '调用失败');
        err.code = message.error.code;
        entry.reject(err);
      } else {
        entry.resolve(message.result);
      }
    } else if (message.type === 'init') {
      applyEnv(message.env);
      readyResolve(env);
      emit('env', env);
    } else if (message.type === 'event') {
      if (message.event === 'env') applyEnv(message.payload);
      emit(message.event, message.event === 'env' ? env : message.payload);
    }
  });

  // ---------- 数据 ----------
  function collection(name, instanceId) {
    var base = { collection: name };
    if (instanceId) base.instance = instanceId;
    function withBase(extra) {
      var result = {};
      Object.keys(base).forEach(function (k) { result[k] = base[k]; });
      Object.keys(extra || {}).forEach(function (k) { result[k] = extra[k]; });
      return result;
    }
    return {
      query: function (options) { return call('data.query', withBase(options)); },
      get: function (id) { return call('data.get', withBase({ id: id })); },
      insert: function (fields) {
        var many = Array.isArray(fields);
        return call('data.insert', withBase({ items: many ? fields : [fields] })).then(function (records) {
          return many ? records : records[0];
        });
      },
      update: function (id, patch) { return call('data.update', withBase({ id: id, patch: patch })); },
      replace: function (id, fields) { return call('data.update', withBase({ id: id, patch: fields, replace: true })); },
      remove: function (id) { return call('data.delete', withBase({ id: id })); },
      subscribe: function (fn) {
        var target = instanceId || env.instanceId;
        return on('data-changed', function (payload) {
          if (payload && payload.instanceId === target && (payload.collection === name || payload.collection === '*')) fn(payload);
        });
      }
    };
  }

  var flota = {
    version: 1,
    env: env,
    ready: ready,
    on: on,
    data: {
      collection: function (name) { return collection(name); },
      from: function (instanceId) { return { collection: function (name) { return collection(name, instanceId); } }; },
      collections: function () { return call('data.collections'); }
    },
    notes: {
      list: function (options) { return call('notes.list', options); },
      get: function (id) { return call('notes.get', { id: id }); },
      create: function (note) { return call('notes.create', note); },
      update: function (id, patch) {
        var payload = { id: id };
        Object.keys(patch || {}).forEach(function (k) { payload[k] = patch[k]; });
        return call('notes.update', payload);
      }
    },
    todos: {
      list: function (options) { return call('todos.list', options); },
      create: function (todo) { return call('todos.create', todo); },
      update: function (id, patch) {
        var payload = { id: id };
        Object.keys(patch || {}).forEach(function (k) { payload[k] = patch[k]; });
        return call('todos.update', payload);
      }
    },
    ai: {
      complete: function (prompt, options) {
        var payload = typeof prompt === 'string' ? { prompt: prompt } : { messages: prompt };
        Object.keys(options || {}).forEach(function (k) { payload[k] = options[k]; });
        return call('ai.complete', payload);
      }
    },
    ui: {
      openNote: function (id) { return call('ui.openNote', { id: id }); },
      openWidget: function (id) { return call('ui.openWidget', { id: id }); },
      toast: function (message, options) { return call('ui.toast', { message: String(message), type: options && options.type }); },
      confirm: function (message) { return call('ui.confirm', { message: String(message) }); }
    },
    state: {
      get: function (key) { return call('state.get', { key: String(key) }); },
      set: function (key, value) { return call('state.set', { key: String(key), value: value }); }
    },
    // 联网：需声明 net:fetch，并在清单 network 中列出域名；首次使用由用户授权
    net: {
      fetch: function (url, options) {
        var payload = { url: String(url) };
        Object.keys(options || {}).forEach(function (k) { payload[k] = options[k]; });
        return call('net.fetch', payload);
      }
    },
    // 系统通知与定时提醒：需声明 notify
    notify: function (title, body) { return call('notify', { title: String(title || ''), body: body == null ? '' : String(body) }); },
    schedule: {
      set: function (item) { return call('schedule.set', item || {}); },
      remove: function (id) { return call('schedule.remove', { id: String(id) }); },
      list: function () { return call('schedule.list'); }
    },
    // 文件对话框：需声明 files
    files: {
      pick: function (options) { return call('files.pick', options || {}); },
      save: function (options) { return call('files.save', options || {}); }
    },
    clipboard: {
      write: function (text) { return call('clipboard.write', { text: String(text == null ? '' : text) }); }
    },
    // 其他组件：在清单 imports 中声明 "组件id.集合名" 后可列出它的实例，再用 flota.data.from(实例id) 只读访问
    widgets: {
      instances: function (widgetId) { return call('widgets.instances', { widgetId: String(widgetId) }); }
    }
  };

  Object.defineProperty(window, 'flota', { value: Object.freeze(flota), writable: false, configurable: false });

  // ---------- 错误、日志、尺寸上报 ----------
  window.addEventListener('error', function (event) {
    if (event.error) reportError(event.error);
    else if (event.message) reportError(new Error(event.message), (event.filename || '') + ':' + (event.lineno || ''));
  });
  window.addEventListener('unhandledrejection', function (event) { reportError(event.reason || new Error('未处理的 Promise 拒绝')); });

  ['error', 'warn'].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      var args = Array.prototype.slice.call(arguments).map(function (arg) {
        if (arg instanceof Error) return arg.message;
        try { return typeof arg === 'string' ? arg : JSON.stringify(arg); } catch (e) { return String(arg); }
      });
      post({ type: 'console', level: level, text: args.join(' ').slice(0, 2000) });
      return original.apply(console, arguments);
    };
  });

  var lastHeight = 0;
  var scheduled = false;
  function reportSize() {
    scheduled = false;
    var root = document.documentElement;
    var body = document.body;
    // 非全屏时按 body 内容测高：html.scrollHeight 不会小于 iframe 自身高度，会导致只增不减
    var height = env.size === 'full' || !body
      ? root.scrollHeight
      : Math.ceil(body.getBoundingClientRect().height);
    if (env.size !== 'full') {
      root.style.overflowY = height > (env.maxHeight || 900) ? 'auto' : 'hidden';
    }
    if (height && Math.abs(height - lastHeight) > 1) {
      lastHeight = height;
      post({ type: 'resize', height: height });
    }
  }
  function scheduleSize() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(reportSize);
  }

  // 点击穿透的桌面卡片：宿主问「这个位置能不能点」（pointer-probe），回答那里是不是按钮、输入框、
  // 带手形光标的元素……宿主据此让窗口在按钮上接收点击、在空白处让点击穿过去
  var INTERACTIVE = 'button, a[href], input, textarea, select, label, summary, [role="button"], [role="checkbox"], [role="switch"], [role="slider"], [role="tab"], [role="menuitem"], [contenteditable=""], [contenteditable="true"], [onclick]';
  function isInteractive(target) {
    for (var el = target; el && el.nodeType === 1 && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      if (el.matches && el.matches(INTERACTIVE)) return true;
      if (getComputedStyle(el).cursor === 'pointer') return true;
    }
    return false;
  }
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var message = event.data;
    if (!message || message.__flota !== 1 || message.type !== 'pointer-probe') return;
    post({ type: 'pointer', interactive: isInteractive(document.elementFromPoint(Number(message.x) || 0, Number(message.y) || 0)) });
  });

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof ResizeObserver === 'function') {
      var observer = new ResizeObserver(scheduleSize);
      observer.observe(document.documentElement);
      if (document.body) observer.observe(document.body);
    }
    scheduleSize();
    post({ type: 'ready' });
  });

  // Inspect visible HTML text only; intentional ellipsis, gradients and disabled controls are excluded.
  function inspectLayout() {
    var issues = [];
    function add(message) { if (issues.indexOf(message) < 0 && issues.length < 4) issues.push(message); }
    function rgb(value) {
      var parts = String(value).match(/[\d.]+/g);
      if (!parts || parts.length < 3 || (parts.length > 3 && Number(parts[3]) < 1)) return null;
      return parts.slice(0, 3).map(Number);
    }
    function luminance(color) {
      return color.map(function (value) { var c = value / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); })
        .reduce(function (sum, value, index) { return sum + value * [0.2126, 0.7152, 0.0722][index]; }, 0);
    }
    Array.prototype.slice.call(document.body.querySelectorAll('*'), 0, 200).forEach(function (element) {
      if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || element.children.length || element.disabled || element.closest('[aria-hidden="true"]')) return;
      var text = (element.textContent || '').trim();
      if (!text || !element.getClientRects().length) return;
      var style = getComputedStyle(element);
      if (style.visibility === 'hidden' || Number(style.opacity) === 0) return;
      var label = text.slice(0, 24);
      if (parseFloat(style.fontSize) < 10) add('文字过小：' + label);
      if (style.textOverflow !== 'ellipsis' && style.webkitLineClamp === 'none' && ['hidden', 'clip'].indexOf(style.overflowX) >= 0 && element.scrollWidth > element.clientWidth + 4) add('文字被裁切：' + label);
      var foreground = rgb(style.color), background = null, parent = element;
      while (parent) {
        var parentStyle = getComputedStyle(parent);
        if (parentStyle.backgroundImage !== 'none') return;
        background = rgb(parentStyle.backgroundColor);
        if (background) break;
        parent = parent.parentElement;
      }
      if (!foreground || !background) return;
      var a = luminance(foreground), b = luminance(background);
      var ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (ratio < (parseFloat(style.fontSize) >= 24 ? 3 : 4.5)) add('文字对比度不足：' + label);
    });
    return issues;
  }

  // 健康检查：加载后上报渲染情况，宿主据此判断白屏
  window.addEventListener('load', function () {
    setTimeout(function () {
      var body = document.body;
      post({
        type: 'health',
        text: body ? (body.innerText || '').trim().length : 0,
        elements: body ? body.getElementsByTagName('*').length : 0,
        height: document.documentElement.scrollHeight,
        overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
        issues: body ? inspectLayout() : []
      });
    }, 1200);
  });
})();
