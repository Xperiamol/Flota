/*
 * Flota Widget SDK —— 运行在组件沙箱 iframe 内。
 * 通过 postMessage 与宿主通信；宿主固定了组件身份与权限，组件无法伪造。
 */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
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
      }, method === 'ai.complete' ? 180000 : 30000);
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

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof ResizeObserver === 'function') {
      var observer = new ResizeObserver(scheduleSize);
      observer.observe(document.documentElement);
      if (document.body) observer.observe(document.body);
    }
    scheduleSize();
    post({ type: 'ready' });
  });

  // 健康检查：加载后上报渲染情况，宿主据此判断白屏
  window.addEventListener('load', function () {
    setTimeout(function () {
      var body = document.body;
      post({
        type: 'health',
        text: body ? (body.innerText || '').trim().length : 0,
        elements: body ? body.getElementsByTagName('*').length : 0,
        height: document.documentElement.scrollHeight
      });
    }, 1200);
  });
})();
