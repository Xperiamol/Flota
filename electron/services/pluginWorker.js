const { parentPort, workerData } = require('worker_threads')
const vm = require('vm')
const path = require('path')
const fs = require('fs')
const { createRequire, builtinModules } = require('module')

const {
  pluginId,
  pluginPath,
  manifest,
  permissions,
  storagePath,
  timeout: rpcTimeout = 15000
} = workerData

const activateCallbacks = []
const deactivateCallbacks = []
const commandHandlers = new Map()
const pendingRpcRequests = new Map()
let activated = false
let shuttingDown = false

const logger = {
  debug: (...args) => sendLog('debug', args),
  info: (...args) => sendLog('info', args),
  warn: (...args) => sendLog('warn', args),
  error: (...args) => sendLog('error', args)
}

function sendLog(level, args) {
  parentPort.postMessage({
    type: 'log',
    level,
    args: args.map((item) => {
      if (typeof item === 'string') return item
      try {
        return JSON.stringify(item)
      } catch (error) {
        return String(item)
      }
    })
  })
}

const nextRequestId = (() => {
  let counter = 0
  return () => {
    counter += 1
    return `${Date.now()}:${counter}`
  }
})()

function callHost(scope, action, payload) {
  if (shuttingDown) {
    return Promise.reject(new Error('插件正在关闭，无法继续调用宿主 API'))
  }

  const requestId = nextRequestId()

  return new Promise((resolve, reject) => {
    // 根据调用类型动态设置超时时间
    // AI 相关调用需要更长的超时时间
    let timeoutDuration = rpcTimeout // 默认使用配置的超时时间
    if (scope === 'ai' || action === 'chat') {
      timeoutDuration = 60000 // AI 调用 60 秒超时
    }

    const timer = setTimeout(() => {
      pendingRpcRequests.delete(requestId)
      reject(new Error(`调用宿主 API 超时: ${scope}.${action}`))
    }, timeoutDuration)

    pendingRpcRequests.set(requestId, {
      resolve: (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      reject: (error) => {
        clearTimeout(timer)
        reject(error)
      }
    })

    parentPort.postMessage({
      type: 'rpc',
      requestId,
      scope,
      action,
      payload
    })
  })
}

const runtime = {
	onActivate(callback) {
		if (typeof callback === 'function') {
			activateCallbacks.push(callback)
		}
	},
	onDeactivate(callback) {
		if (typeof callback === 'function') {
			deactivateCallbacks.push(callback)
		}
	},
	registerCommand(definition, handler) {
		if (!definition || typeof definition !== 'object') {
			throw new Error('registerCommand 需要提供命令描述对象')
		}
		if (!definition.id || typeof definition.id !== 'string') {
			throw new Error('命令必须包含字符串类型的 id')
		}
		if (typeof handler !== 'function') {
			throw new Error('命令处理函数必须是 function')
		}

		const surfaces = Array.isArray(definition.surfaces)
			? definition.surfaces
			: definition.surface
				? [definition.surface]
				: []

		const command = {
			id: definition.id,
			title: definition.title || definition.id,
			description: definition.description || '',
			group: definition.group || null,
			icon: definition.icon || null,
			surfaces: surfaces
				.map((surface) => (typeof surface === 'string' ? surface.trim() : ''))
				.filter(Boolean)
		}

		commandHandlers.set(command.id, handler)
		parentPort.postMessage({ type: 'register-command', command })
		return () => runtime.unregisterCommand(command.id)
	},
	unregisterCommand(commandId) {
		if (!commandHandlers.has(commandId)) return
		commandHandlers.delete(commandId)
		parentPort.postMessage({ type: 'unregister-command', commandId })
	},
	notes: {
		list: (options) => callHost('notes', 'list', options),
		getRandom: () => callHost('notes', 'getRandom'),
		findById: (id) => callHost('notes', 'findById', { id }),
		create: (data) => callHost('notes', 'create', data),
		update: (id, data) => callHost('notes', 'update', { id, data }),
		delete: (id) => callHost('notes', 'delete', { id })
	},
	todos: {
		list: (options) => callHost('todos', 'list', options),
		findById: (id) => callHost('todos', 'findById', { id }),
		create: (data) => callHost('todos', 'create', data),
		update: (id, data) => callHost('todos', 'update', { id, data }),
		delete: (id) => callHost('todos', 'delete', { id })
	},
	tags: {
		list: () => callHost('tags', 'list'),
		create: (name) => callHost('tags', 'create', { name }),
		update: (id, data) => callHost('tags', 'update', { id, data }),
		delete: (name) => callHost('tags', 'delete', { name })
	},
	network: {
		fetch: (url, options) => callHost('network', 'fetch', { url, options })
	},
	clipboard: {
		readText: () => callHost('clipboard', 'readText'),
		writeText: (text) => callHost('clipboard', 'writeText', { text }),
		readImage: () => callHost('clipboard', 'readImage'),
		writeImage: (dataUrl) => callHost('clipboard', 'writeImage', { dataUrl })
	},
	filesystem: {
		pickFile: (options) => callHost('filesystem', 'pickFile', options),
		readFile: (filePath, encoding) => callHost('filesystem', 'readFile', { filePath, encoding }),
		pickDirectory: () => callHost('filesystem', 'pickDirectory'),
		writeFile: (filePath, content) => callHost('filesystem', 'writeFile', { filePath, content })
	},
	search: {
		fullText: (query, options) => callHost('search', 'fullText', { query, options }),
		filter: (conditions) => callHost('search', 'filter', { conditions })
	},
	events: {
		subscribe: (eventType, listenerId) => callHost('events', 'subscribe', { eventType, listenerId }),
		unsubscribe: (listenerId) => callHost('events', 'unsubscribe', { listenerId })
	},
	analytics: {
		notesStats: (timeRange) => callHost('analytics', 'notesStats', { timeRange }),
		todosStats: (timeRange) => callHost('analytics', 'todosStats', { timeRange })
	},
	ai: {
		chat: (messages, options) => callHost('ai', 'chat', { messages, options }),
		isAvailable: () => callHost('ai', 'isAvailable')
	},
	ui: {
		openNote: (noteId) => callHost('ui', 'openNote', { noteId }),
		openWindow: (options) => callHost('ui', 'openWindow', options)
	},
	storage: {
		getItem: (key) => callHost('storage', 'getItem', { key }),
		setItem: (key, value) => callHost('storage', 'setItem', { key, value }),
		removeItem: (key) => callHost('storage', 'removeItem', { key }),
		clear: () => callHost('storage', 'clear')
	},
	notifications: {
		show: (payload) => callHost('notifications', 'show', payload)
	},
	mem0: {
		add: (userId, content, options) => callHost('mem0', 'add', { userId, content, options }),
		search: (userId, query, options) => callHost('mem0', 'search', { userId, query, options }),
		get: (userId, options) => callHost('mem0', 'get', { userId, options }),
		update: (memoryId, content, options) => callHost('mem0', 'update', { memoryId, content, options }),
		delete: (memoryId) => callHost('mem0', 'delete', { memoryId }),
		clear: (userId) => callHost('mem0', 'clear', { userId }),
		stats: (userId) => callHost('mem0', 'stats', { userId }),
		isAvailable: () => callHost('mem0', 'isAvailable')
	},
	theme: {
		registerGlobalStyle: (styleId, css, options) => callHost('theme', 'registerGlobalStyle', { styleId, css, options }),
		unregisterGlobalStyle: (styleId) => callHost('theme', 'unregisterGlobalStyle', { styleId }),
		updateGlobalStyle: (styleId, css, options) => callHost('theme', 'updateGlobalStyle', { styleId, css, options }),
		listStyles: () => callHost('theme', 'listStyles')
	},
	logger,
	permissions: {
		has: (permission) => Boolean(permissions?.[permission]),
		list: () => Object.entries(permissions || {})
			.filter((entry) => Boolean(entry[1]))
			.map((entry) => entry[0])
	}
}

const sdkFacade = Object.freeze({
	onActivate: runtime.onActivate,
	onDeactivate: runtime.onDeactivate,
	registerCommand: runtime.registerCommand,
	unregisterCommand: runtime.unregisterCommand,
	notes: runtime.notes,
	todos: runtime.todos,
	tags: runtime.tags,
	network: runtime.network,
	clipboard: runtime.clipboard,
	filesystem: runtime.filesystem,
	search: runtime.search,
	events: runtime.events,
	analytics: runtime.analytics,
	ai: runtime.ai,
	ui: runtime.ui,
	storage: runtime.storage,
	notifications: runtime.notifications,
	mem0: runtime.mem0,
	theme: runtime.theme,
	logger: runtime.logger,
	permissions: runtime.permissions
})

function createSandboxRequire(entryPath) {
  const nativeRequire = createRequire(entryPath)
  const pluginDir = path.dirname(entryPath)

  const sandboxRequire = (request) => {
    if (request === '@flota/sdk') {
      return sdkFacade
    }

    if (request.startsWith('node:') || builtinModules.includes(request)) {
      throw new Error(`禁止在 Flota 插件中直接 require Node 内置模块: ${request}`)
    }

    const resolvedPath = nativeRequire.resolve(request)
    if (!resolvedPath.startsWith(pluginDir)) {
      throw new Error(`模块路径越界: ${request}`)
    }

    return nativeRequire(resolvedPath)
  }

  sandboxRequire.resolve = (request) => nativeRequire.resolve(request)
  sandboxRequire.cache = nativeRequire.cache

  return sandboxRequire
}

function createConsole() {
  return {
    log: (...args) => logger.info(...args),
    info: (...args) => logger.info(...args),
    warn: (...args) => logger.warn(...args),
    error: (...args) => logger.error(...args),
    debug: (...args) => logger.debug(...args)
  }
}

async function activate() {
  if (activated) return
  activated = true

  for (const callback of activateCallbacks) {
    try {
      await Promise.resolve(callback({
        plugin: {
          id: manifest.id,
          name: manifest.name,
          version: manifest.version
        },
        permissions: runtime.permissions
      }))
    } catch (error) {
      logger.error('插件激活回调执行失败', error)
      throw error
    }
  }

  parentPort.postMessage({ type: 'ready' })
}

async function deactivate() {
  if (!activated) return
  activated = false

  for (const callback of deactivateCallbacks.reverse()) {
    try {
      await Promise.resolve(callback())
    } catch (error) {
      logger.error('插件停用回调执行失败', error)
    }
  }
}

function handleParentMessage(message) {
  if (!message || typeof message !== 'object') return

  switch (message.type) {
    case 'rpc-response': {
      const pending = pendingRpcRequests.get(message.requestId)
      if (!pending) return
      pendingRpcRequests.delete(message.requestId)
      if (message.success) {
        pending.resolve(message.result)
      } else {
        pending.reject(new Error(message.error || '宿主 RPC 调用失败'))
      }
      break
    }
    case 'invoke-command': {
      executeCommand(message)
      break
    }
    case 'shutdown': {
      shutdown()
      break
    }
    default:
      logger.warn('收到未知的宿主消息', message)
  }
}

async function executeCommand(message) {
  const { commandId, requestId, payload } = message
  const handler = commandHandlers.get(commandId)

  if (!handler) {
    parentPort.postMessage({
      type: 'invoke-command-result',
      requestId,
      success: false,
      error: `命令处理函数不存在: ${commandId}`
    })
    return
  }

  try {
    const result = await Promise.resolve(handler(payload))
    parentPort.postMessage({
      type: 'invoke-command-result',
      requestId,
      success: true,
      result
    })
  } catch (error) {
    logger.error('命令执行失败', error)
    parentPort.postMessage({
      type: 'invoke-command-result',
      requestId,
      success: false,
      error: error.message || '命令执行失败'
    })
  }
}

async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true

  try {
    await deactivate()
  } finally {
    process.exit(0)
  }
}

function bootstrap() {
  try {
    const entry = manifest.entry || 'index.js'
    const entryPath = path.join(pluginPath, entry)
    const code = fs.readFileSync(entryPath, 'utf8')

    const sandbox = {
      module: { exports: {} },
      exports: {},
      require: createSandboxRequire(entryPath),
      __filename: entryPath,
      __dirname: path.dirname(entryPath),
      console: createConsole(),
      runtime: sdkFacade,  // 将 runtime 暴露为全局变量
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
      Buffer,
      process: {
        env: {},
        argv: [],
        pid: process.pid,
        platform: process.platform,
        versions: process.versions,
        cwd: () => pluginPath
      },
      global: undefined,
      globalThis: undefined
    }

    sandbox.global = sandbox
    sandbox.globalThis = sandbox

    const script = new vm.Script(code, { filename: entryPath, displayErrors: true })
    const context = vm.createContext(sandbox, { name: `Flota-plugin-${pluginId}` })
    script.runInContext(context, { timeout: rpcTimeout })

    const exported = sandbox.module.exports || sandbox.exports
    if (typeof exported === 'function') {
      exported(runtime)
    }

    activate().catch((error) => {
      parentPort.postMessage({
        type: 'fatal',
        error: error && error.message ? error.message : String(error)
      })
    })
  } catch (error) {
    parentPort.postMessage({
      type: 'fatal',
      error: error && error.message ? error.message : String(error)
    })
  }
}

parentPort.on('message', handleParentMessage)
bootstrap()
