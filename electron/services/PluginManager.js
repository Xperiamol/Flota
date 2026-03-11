const path = require('path')
const fs = require('fs')
const fsp = require('fs/promises')
const { EventEmitter } = require('events')
const { Worker } = require('worker_threads')
const crypto = require('crypto')

// 获取用户数据路径（兼容 standalone 模式）
const getUserDataPath = () => {
  let app = null;
  try {
    app = require('electron').app;
  } catch (e) {
    // Standalone mode
  }
  
  if (app) return app.getPath('userData');
  
  const platform = process.platform;
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || homeDir, 'Flota');
  } else if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'Flota');
  } else {
    return path.join(homeDir, '.config', 'Flota');
  }
}

const ALLOWED_PERMISSIONS = new Set([
	// 笔记和待办
	'notes:read',
	'notes:read:full',
	'notes:write',
	'todos:read',
	'todos:read:full',
	'todos:write',
	// 标签
	'tags:read',
	'tags:write',
	// UI 和通知
	'ui:open-note',
	'ui:open-window',
	'ui:theme',
	'notifications:show',
	// 存储和设置
	'settings:read',
	'storage:read',
	'storage:write',
	// Mem0 记忆管理
	'mem0:read',
	'mem0:write',
	// 网络和文件系统
	'network:request',
	'filesystem:read',
	'filesystem:write',
	// 剪贴板
	'clipboard:read',
	'clipboard:write',
	// 搜索和附件
	'search:advanced',
	'attachments:read',
	'attachments:write',
	// 事件和调度
	'events:subscribe',
	'scheduler:create',
	// 分析和扩展
	'analytics:read',
	'markdown:extend',
	'ai:inference',
	'stt:transcribe'
])

const STATE_VERSION = 1
const DEFAULT_REGISTRY_RELATIVE_PATH = ['..', '..', 'plugins', 'registry.json']
const STORE_EVENT_CHANNEL = 'plugin-store:event'

const compareVersions = (a, b) => {
	const normalize = (v) =>
		String(v || '0')
			.split('.')
			.map((chunk) => Number(chunk) || 0)

	const left = normalize(a)
	const right = normalize(b)
	const length = Math.max(left.length, right.length)

	for (let i = 0; i < length; i += 1) {
		const diff = (left[i] || 0) - (right[i] || 0)
		if (diff !== 0) return diff > 0 ? 1 : -1
	}
	return 0
}

class PluginManager extends EventEmitter {
	constructor(options = {}) {
		super()

		this.app = options.app
		this.services = options.services || {}
		this.shortcutService = options.shortcutService || this.services.shortcutService || null
		this.dbManager = this.services.dbManager || null // 数据库管理器，用于插件存储
		this.windowAccessor = options.windowAccessor || (() => [])
		this.mainWindowAccessor = options.mainWindowAccessor || (() => null)
		this.logger = options.logger || console
		this.isPackaged = options.isPackaged ?? (this.app ? this.app.isPackaged : false)

		this.pluginsDir = options.pluginsDir || this.resolvePluginsDir()
		this.storageDir = path.join(this.pluginsDir, 'storage')
		this.stateFile = path.join(this.pluginsDir, 'plugins-state.json')
		this.registryPath = options.registryPath || this.resolveRegistryPath()

		this.installedPlugins = new Map() // pluginId -> { manifest, path }
		this.pluginStates = new Map() // pluginId -> state
		this.pluginWorkers = new Map() // pluginId -> Worker
		this.commandRegistry = new Map() // commandId -> { pluginId, definition }
		this.pendingCommandRequests = new Map() // `${pluginId}:${requestId}` -> { resolve, reject }
		
		// 插件崩溃恢复相关
		this.pluginRestartAttempts = new Map() // pluginId -> { count, lastAttempt, backoffDelay }
		this.MAX_RESTART_ATTEMPTS = 3
		this.INITIAL_BACKOFF_DELAY = 1000 // 1秒
		this.MAX_BACKOFF_DELAY = 30000 // 30秒
		this.RESTART_RESET_INTERVAL = 300000 // 5分钟后重置重试计数
		
		// 状态持久化优化
		this.saveStateTimer = null
		this.SAVE_STATE_DEBOUNCE_DELAY = 5000 // 5秒防抖延迟
		this.isDirty = false // 状态脏标记
	}

	resolvePluginsDir() {
		if (this.app && typeof this.app.getPath === 'function') {
			return path.join(this.app.getPath('userData'), 'plugins')
		}
		return path.join(getUserDataPath(), 'plugins')
	}

	resolveRegistryPath() {
		const devCandidate = path.resolve(__dirname, ...DEFAULT_REGISTRY_RELATIVE_PATH)
		if (fs.existsSync(devCandidate)) {
			return devCandidate
		}

		if (this.app && this.app.isPackaged) {
			const packaged = path.join(process.resourcesPath, 'plugins', 'registry.json')
			if (fs.existsSync(packaged)) {
				return packaged
			}
		}

		return devCandidate
	}

	async initialize() {
		await this.ensureDir(this.pluginsDir)
		await this.ensureDir(this.storageDir)
		if (this.shortcutService && typeof this.shortcutService.loadPluginShortcutSettings === 'function') {
			try {
				await this.shortcutService.loadPluginShortcutSettings()
			} catch (error) {
				this.logger.error('[PluginManager] 初始化插件快捷键配置失败:', error)
			}
		}
		await this.loadState()
		
		// 预装 examples 文件夹中的插件
		await this.preinstallExamplePlugins()
		
		await this.loadInstalledPlugins()
	}

	async ensureDir(target) {
		await fsp.mkdir(target, { recursive: true })
	}

	/**
	 * 预装 examples 文件夹中的插件
	 * 仅在插件未安装时自动安装
	 */
	async preinstallExamplePlugins() {
		try {
			// 开发环境：从项目根目录的 plugins/examples
			// 生产环境：从打包后的 resources/plugins/examples
			const { app } = require('electron')
			const isDev = process.env.NODE_ENV === 'development'
			
			let examplesDir
			if (isDev) {
				// 开发环境
				examplesDir = path.join(__dirname, '../../plugins/examples')
			} else {
				// 生产环境（打包后）
				examplesDir = path.join(process.resourcesPath, 'plugins/examples')
			}
			
			const exists = await this.pathExists(examplesDir)
			
			if (!exists) {
				this.logger.warn(`[PluginManager] Examples 目录不存在: ${examplesDir}`)
				return
			}

			this.logger.info(`[PluginManager] 从以下路径预装插件: ${examplesDir}`)

			const entries = await fsp.readdir(examplesDir, { withFileTypes: true })
			const examplePlugins = entries.filter(entry => entry.isDirectory())

			let installedCount = 0
			let skippedCount = 0

			for (const entry of examplePlugins) {
				const examplePath = path.join(examplesDir, entry.name)
				const manifest = await this.readManifestFromPath(examplePath)
				
				if (!manifest) {
					this.logger.warn(`[PluginManager] 跳过无效示例插件: ${entry.name}`)
					skippedCount++
					continue
				}

				// 检查插件是否已安装
				const targetPath = path.join(this.pluginsDir, manifest.id)
				const alreadyInstalled = await this.pathExists(targetPath)

				if (alreadyInstalled) {
					this.logger.debug(`[PluginManager] 示例插件已安装: ${manifest.id}`)
					skippedCount++
					continue
				}

				// 复制插件到 plugins 目录
				this.logger.info(`[PluginManager] 预装示例插件: ${manifest.id} (${manifest.name})`)
				await this.copyDirectory(examplePath, targetPath)
				installedCount++
			}
			
			this.logger.info(`[PluginManager] 预装完成: 新安装 ${installedCount} 个，跳过 ${skippedCount} 个`)
		} catch (error) {
			this.logger.error('[PluginManager] 预装示例插件失败:', error)
		}
	}

	/**
	 * 递归复制目录
	 */
	async copyDirectory(src, dest) {
		await this.ensureDir(dest)
		const entries = await fsp.readdir(src, { withFileTypes: true })

		for (const entry of entries) {
			const srcPath = path.join(src, entry.name)
			const destPath = path.join(dest, entry.name)

			if (entry.isDirectory()) {
				await this.copyDirectory(srcPath, destPath)
			} else {
				await fsp.copyFile(srcPath, destPath)
			}
		}
	}

	async pathExists(targetPath) {
		try {
			await fsp.access(targetPath)
			return true
		} catch (error) {
			return false
		}
	}

	/**
	 * 读取插件图标并转换为 data URI
	 * @param {string} pluginDir 插件目录路径
	 * @param {string} iconPath 图标相对路径
	 * @returns {Promise<string|null>} data URI 或 null
	 */
	async loadPluginIcon(pluginDir, iconPath) {
		if (!iconPath) return null
		
		try {
			const fullPath = path.join(pluginDir, iconPath)
			const exists = await this.pathExists(fullPath)
			if (!exists) return null
			
			const content = await fsp.readFile(fullPath)
			const ext = path.extname(iconPath).toLowerCase()
			
			let mimeType = 'image/svg+xml'
			if (ext === '.png') mimeType = 'image/png'
			else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg'
			else if (ext === '.gif') mimeType = 'image/gif'
			else if (ext === '.webp') mimeType = 'image/webp'
			
			const base64 = content.toString('base64')
			return `data:${mimeType};base64,${base64}`
		} catch (error) {
			this.logger.warn(`[PluginManager] 读取插件图标失败: ${pluginDir}/${iconPath}`, error.message)
			return null
		}
	}

	async loadState() {
		try {
			const raw = await fsp.readFile(this.stateFile, 'utf8')
			const parsed = JSON.parse(raw)
			if (parsed?.version === STATE_VERSION && parsed?.plugins) {
				Object.entries(parsed.plugins).forEach(([pluginId, state]) => {
					this.pluginStates.set(pluginId, {
						enabled: Boolean(state.enabled),
						installedVersion: state.installedVersion || null,
						installedAt: state.installedAt || null,
						permissions: this.normalizePermissions(state.permissions),
						lastError: state.lastError || null,
						runtimeStatus: 'stopped'
					})
				})
			}
		} catch (error) {
			if (error.code !== 'ENOENT') {
				this.logger.error('[PluginManager] 加载插件状态失败:', error)
			}
			await this.saveStateImmediate()
		}
	}

	async saveState() {
		const payload = {
			version: STATE_VERSION,
			plugins: {}
		}

		for (const [pluginId, state] of this.pluginStates.entries()) {
			payload.plugins[pluginId] = {
				enabled: Boolean(state.enabled),
				installedVersion: state.installedVersion || null,
				installedAt: state.installedAt || null,
				permissions: state.permissions || this.normalizePermissions(),
				lastError: state.lastError || null
			}
		}

		await fsp.writeFile(this.stateFile, JSON.stringify(payload, null, 2), 'utf8')
		this.isDirty = false
	}

	/**
	 * 标记状态为脏，触发防抖保存
	 */
	markStateDirty() {
		this.isDirty = true
		this.scheduleSaveState()
	}

	/**
	 * 调度状态保存（防抖）
	 */
	scheduleSaveState() {
		// 清除之前的定时器
		if (this.saveStateTimer) {
			clearTimeout(this.saveStateTimer)
		}

		// 设置新的防抖定时器
		this.saveStateTimer = setTimeout(async () => {
			if (this.isDirty) {
				try {
					await this.saveState()
					this.logger.debug('[PluginManager] 状态已保存')
				} catch (error) {
					this.logger.error('[PluginManager] 保存状态失败:', error)
				}
			}
			this.saveStateTimer = null
		}, this.SAVE_STATE_DEBOUNCE_DELAY)
	}

	/**
	 * 立即保存状态（绕过防抖）
	 */
	async saveStateImmediate() {
		if (this.saveStateTimer) {
			clearTimeout(this.saveStateTimer)
			this.saveStateTimer = null
		}
		await this.saveState()
	}

	normalizePermissions(permissions = {}) {
		const normalized = {}

		if (Array.isArray(permissions)) {
			permissions.forEach((permission) => {
				if (ALLOWED_PERMISSIONS.has(permission)) {
					normalized[permission] = true
				}
			})
		} else if (permissions && typeof permissions === 'object') {
			Object.entries(permissions).forEach(([key, value]) => {
				if (ALLOWED_PERMISSIONS.has(key)) {
					normalized[key] = Boolean(value)
				}
			})
		}

		ALLOWED_PERMISSIONS.forEach((permission) => {
			if (!(permission in normalized)) {
				normalized[permission] = false
			}
		})

		return normalized
	}

	validateManifest(manifest) {
		if (!manifest || typeof manifest !== 'object') {
			throw new Error('插件 manifest 无效')
		}

		const requiredFields = ['id', 'name', 'version', 'entry']
		requiredFields.forEach((field) => {
			if (!manifest[field]) {
				throw new Error(`插件 manifest 缺少必填字段: ${field}`)
			}
		})

		if (manifest.permissions) {
			const normalized = this.normalizePermissions(manifest.permissions)
			const invalid = Object.keys(normalized).filter((perm) => !ALLOWED_PERMISSIONS.has(perm))
			if (invalid.length > 0) {
				throw new Error(`插件 manifest 请求了不被支持的权限: ${invalid.join(', ')}`)
			}
			manifest.permissions = normalized
		} else {
			manifest.permissions = this.normalizePermissions()
		}

		if (!manifest.runtime) {
			manifest.runtime = { type: 'worker', timeout: 15000 }
		}

		return manifest
	}

	async loadInstalledPlugins() {
		const entries = await fsp.readdir(this.pluginsDir, { withFileTypes: true })
		
		// 并行加载所有插件的manifest
		const loadTasks = entries
			.filter((entry) => entry.isDirectory() && entry.name !== 'storage')
			.map(async (entry) => {
				const pluginPath = path.join(this.pluginsDir, entry.name)
				
				// 检查manifest.json是否存在
				const manifestPath = path.join(pluginPath, 'manifest.json')
				const manifestExists = await this.pathExists(manifestPath)
				
				if (!manifestExists) {
					this.logger.warn(`[PluginManager] 跳过无效插件目录（缺少manifest.json）: ${entry.name}`)
					return { manifest: null, pluginPath }
				}
				
				const manifest = await this.readManifestFromPath(pluginPath)
				return { manifest, pluginPath }
			})

		const results = await Promise.all(loadTasks)

		// 处理加载结果
		for (const { manifest, pluginPath } of results) {
			if (!manifest) continue

			try {
				this.validateManifest(manifest)

				this.installedPlugins.set(manifest.id, {
					manifest,
					path: pluginPath
				})

				if (!this.pluginStates.has(manifest.id)) {
					this.pluginStates.set(manifest.id, {
						enabled: true,
						installedVersion: manifest.version,
						installedAt: new Date().toISOString(),
						permissions: this.normalizePermissions(manifest.permissions),
						lastError: null,
						runtimeStatus: 'stopped'
					})
				} else {
					// 合并 manifest 中声明的权限到已有状态
					const state = this.pluginStates.get(manifest.id)
					const manifestPermissions = this.normalizePermissions(manifest.permissions)
					// 保留状态文件中的权限，但添加 manifest 中新声明的权限
					Object.entries(manifestPermissions).forEach(([perm, declared]) => {
						if (declared && !(perm in state.permissions)) {
							state.permissions[perm] = true
						}
					})
					// 确保所有新的允许权限都存在（默认false）
					ALLOWED_PERMISSIONS.forEach((permission) => {
						if (!(permission in state.permissions)) {
							state.permissions[permission] = false
						}
					})
				}

				const state = this.pluginStates.get(manifest.id)
				state.installedVersion = manifest.version
			} catch (error) {
				this.logger.error(`[PluginManager] 加载插件 ${manifest?.id || pluginPath} 失败:`, error)
			}
		}

		// 清理不存在的插件状态
		for (const [pluginId, state] of Array.from(this.pluginStates.entries())) {
			if (!this.installedPlugins.has(pluginId)) {
				this.logger.warn(`[PluginManager] 清理不存在的插件状态: ${pluginId}`)
				this.pluginStates.delete(pluginId)
			}
		}

		// 并行启动所有已启用且已安装的插件
		const startTasks = []
		for (const [pluginId, state] of this.pluginStates.entries()) {
			if (state.enabled && this.installedPlugins.has(pluginId)) {
				startTasks.push(
					this.startPlugin(pluginId).catch((error) => {
						this.logger.error(`[PluginManager] 启动插件 ${pluginId} 失败:`, error)
						state.runtimeStatus = 'error'
						state.lastError = error.message
					})
				)
			} else if (state.enabled && !this.installedPlugins.has(pluginId)) {
				this.logger.warn(`[PluginManager] 插件 ${pluginId} 已启用但未安装，跳过启动`)
				state.enabled = false
				state.runtimeStatus = 'stopped'
			}
		}

		await Promise.all(startTasks)

		await this.saveStateImmediate()
	}

	async listInstalledPlugins() {
		const list = []
		for (const [pluginId] of this.installedPlugins.entries()) {
			const snapshot = await this.getPluginStateSnapshotWithIcon(pluginId)
			if (snapshot) list.push(snapshot)
		}
		return list.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name, 'zh-CN'))
	}

	async listAvailablePlugins() {
		const registry = await this.readRegistryFile()

		const plugins = await Promise.all(registry.map(async (item) => {
			const installed = this.installedPlugins.get(item.id)
			const state = installed ? this.pluginStates.get(item.id) : null
			const versionDiff = installed ? compareVersions(item.version, state?.installedVersion) : 0

			// 尝试加载图标
			let iconDataUri = null
			if (item.icon && item.source?.path) {
				const pluginDir = this.resolveRegistrySourcePath(item)
				iconDataUri = await this.loadPluginIcon(pluginDir, item.icon)
			}

			return {
				...item,
				icon: iconDataUri || item.icon, // 优先使用 data URI，否则保留原值
				installed: Boolean(installed),
				enabled: Boolean(state?.enabled),
				installedVersion: state?.installedVersion || null,
				hasUpdate: versionDiff > 0,
				commands: this.getCommandsForPlugin(item.id)
			}
		}))

		return plugins
	}

	async scanLocalPlugins() {
		const localPlugins = []
		
		// 定义扫描目录
		const scanDirs = []
		
		// 开发环境：项目目录下的插件
		if (!this.isPackaged) {
			scanDirs.push({
				path: path.join(process.cwd(), 'plugins', 'examples'),
				type: 'development',
				label: 'examples'
			})
			scanDirs.push({
				path: path.join(process.cwd(), 'plugins', 'local'),
				type: 'development', 
				label: 'local'
			})
		} else {
			// 生产环境：打包后的 examples 插件
			scanDirs.push({
				path: path.join(process.resourcesPath, 'plugins', 'examples'),
				type: 'bundled',
				label: 'examples'
			})
		}
		
		// 用户数据目录的插件（手动安装的本地插件）
		if (this.pluginsDir) {
			scanDirs.push({
				path: this.pluginsDir,
				type: 'userdata',
				label: 'installed'
			})
		}

		for (const dirInfo of scanDirs) {
			const baseDir = dirInfo.path
			try {
				// 检查目录是否存在
				const exists = await fsp.access(baseDir).then(() => true).catch(() => false)
				if (!exists) {
					this.logger.debug(`[PluginManager] 插件目录不存在 [${dirInfo.type}:${dirInfo.label}]: ${baseDir}`)
					continue
				}

				// 读取目录内容
				const entries = await fsp.readdir(baseDir, { withFileTypes: true })
				
				// 排除非插件目录（storage=插件存储，cache/temp=临时文件，examples/local=开发环境专用）
				const excludeDirs = ['storage', 'cache', 'temp', '.git', 'node_modules', 'examples', 'local']
				
				for (const entry of entries) {
					if (!entry.isDirectory()) continue
					
					// 跳过排除的目录
					if (excludeDirs.includes(entry.name)) {
						this.logger.debug(`[PluginManager] 跳过非插件目录 [${dirInfo.type}:${dirInfo.label}]: ${entry.name}`)
						continue
					}
					
					const pluginDir = path.join(baseDir, entry.name)
					const manifestPath = path.join(pluginDir, 'manifest.json')
					
					try {
						// 检查是否有 manifest.json
						await fsp.access(manifestPath)
						
						// 读取并解析 manifest.json
						const manifestContent = await fsp.readFile(manifestPath, 'utf-8')
						const manifest = JSON.parse(manifestContent)
						
						// 验证基本字段
						if (!manifest.id || !manifest.name || !manifest.version || !manifest.entry) {
							this.logger.warn(`[PluginManager] 插件 manifest.json 缺少必需字段 [${dirInfo.type}:${dirInfo.label}]: ${pluginDir}`)
							continue
						}
						
						// 检查入口文件是否存在
						const entryPath = path.join(pluginDir, manifest.entry)
						const entryExists = await fsp.access(entryPath).then(() => true).catch(() => false)
						if (!entryExists) {
							this.logger.warn(`[PluginManager] 插件入口文件不存在 [${dirInfo.type}:${dirInfo.label}]: ${entryPath}`)
							continue
						}
						
						// 检查是否已安装
						const installed = this.installedPlugins.get(manifest.id)
						const state = installed ? this.pluginStates.get(manifest.id) : null
						
						// 尝试加载图标
						const iconDataUri = await this.loadPluginIcon(pluginDir, manifest.icon)
						
						// 构建插件信息
						const pluginInfo = {
							id: manifest.id,
							name: manifest.name,
							version: manifest.version,
							description: manifest.description || '',
							shortDescription: manifest.shortDescription || manifest.description || '',
							author: manifest.author || { name: '未知作者' },
							license: manifest.license || 'Unknown',
							homepage: manifest.homepage || null,
							repository: manifest.repository || null,
							categories: Array.isArray(manifest.categories) ? manifest.categories : (manifest.categories ? [manifest.categories] : ['开发工具']),
							tags: Array.isArray(manifest.tags) ? manifest.tags : [],
							permissions: this.formatPermissions(manifest.permissions),
							minAppVersion: manifest.minAppVersion || '2.0.0',
							icon: iconDataUri || null,
							manifest,
							// 运行时状态
							installed: Boolean(installed),
							enabled: Boolean(state?.enabled),
							installedVersion: state?.installedVersion || null,
							hasUpdate: false, // 本地插件不需要更新检查
							commands: this.getCommandsForPlugin(manifest.id),
							// 本地插件特有字段
							isLocal: true,
							localPath: pluginDir,
							sourceType: dirInfo.type, // 'development' 或 'userdata'
							sourceLabel: dirInfo.label, // 'examples', 'local', 'installed'
							source: {
								type: 'directory',
								path: pluginDir,
								environment: dirInfo.type
							}
						}
						
						localPlugins.push(pluginInfo)
						
					} catch (error) {
						this.logger.warn(`[PluginManager] 解析插件失败 [${dirInfo.type}:${dirInfo.label}] ${pluginDir}:`, error.message)
						continue
					}
				}
				
			} catch (error) {
				this.logger.error(`[PluginManager] 扫描插件目录失败 [${dirInfo.type}:${dirInfo.label}] ${baseDir}:`, error)
			}
		}

		// 按名称排序
		localPlugins.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
		
		// 统计各来源的插件数量
		const stats = localPlugins.reduce((acc, plugin) => {
			acc[plugin.sourceType] = (acc[plugin.sourceType] || 0) + 1
			return acc
		}, {})
		
		this.logger.info(`[PluginManager] 扫描完成，共找到 ${localPlugins.length} 个插件`, stats)
		return localPlugins
	}

	formatPermissions(permissions) {
		if (!permissions) return []
		if (Array.isArray(permissions)) return permissions
		
		// 处理对象形式的权限配置
		if (typeof permissions === 'object') {
			return Object.entries(permissions)
				.filter(([, value]) => Boolean(value))
				.map(([key]) => key)
		}
		
		return []
	}

	getCommandsForPlugin(pluginId) {
		const commands = []
		for (const entry of this.commandRegistry.values()) {
			if (entry.pluginId === pluginId) {
				commands.push(entry.definition)
			}
		}
		return commands
	}

	getPluginStateSnapshot(pluginId) {
		const record = this.installedPlugins.get(pluginId)
		const state = this.pluginStates.get(pluginId)
		if (!record || !state) return null

		return {
			id: pluginId,
			manifest: record.manifest,
			enabled: Boolean(state.enabled),
			installedVersion: state.installedVersion,
			installedAt: state.installedAt,
			lastError: state.lastError,
			runtimeStatus: state.runtimeStatus || 'stopped',
			commands: this.getCommandsForPlugin(pluginId),
			permissions: state.permissions
		}
	}

	/**
	 * 获取插件状态快照（包含图标）
	 */
	async getPluginStateSnapshotWithIcon(pluginId) {
		const record = this.installedPlugins.get(pluginId)
		const state = this.pluginStates.get(pluginId)
		if (!record || !state) return null

		// 尝试加载图标
		let iconDataUri = null
		if (record.manifest?.icon && record.path) {
			iconDataUri = await this.loadPluginIcon(record.path, record.manifest.icon)
		}

		return {
			id: pluginId,
			manifest: record.manifest,
			icon: iconDataUri,
			enabled: Boolean(state.enabled),
			installedVersion: state.installedVersion,
			installedAt: state.installedAt,
			lastError: state.lastError,
			runtimeStatus: state.runtimeStatus || 'stopped',
			commands: this.getCommandsForPlugin(pluginId),
			permissions: state.permissions
		}
	}

	async getPluginDetails(pluginId) {
		return this.getPluginStateSnapshotWithIcon(pluginId)
	}

	getPluginPath(pluginId) {
		const record = this.installedPlugins.get(pluginId)
		if (!record) {
			return null
		}
		return path.join(this.pluginsDir, pluginId)
	}

	async readRegistryFile() {
		try {
			const raw = await fsp.readFile(this.registryPath, 'utf8')
			const data = JSON.parse(raw)
			return Array.isArray(data) ? data : []
		} catch (error) {
			this.logger.error('[PluginManager] 无法读取插件仓库配置:', error)
			return []
		}
	}

	async findRegistryEntry(pluginId) {
		const registry = await this.readRegistryFile()
		return registry.find((item) => item.id === pluginId) || null
	}

	resolveRegistrySourcePath(entry) {
		if (!entry?.source) {
			throw new Error('插件仓库条目缺少 source 字段')
		}

		if (entry.source.type === 'directory') {
			const relativePath = entry.source.path
			if (!relativePath) {
				throw new Error('插件仓库条目缺少 source.path')
			}

			if (path.isAbsolute(relativePath)) {
				return relativePath
			}

			const baseDir = this.isPackaged
				? process.resourcesPath
				: path.resolve(__dirname, '..', '..')

			return path.join(baseDir, relativePath)
		}

		throw new Error(`不支持的插件 source 类型: ${entry.source.type}`)
	}

	async readManifestFromPath(basePath) {
		try {
			const manifestPath = path.join(basePath, 'manifest.json')
			const raw = await fsp.readFile(manifestPath, 'utf8')
			const manifest = JSON.parse(raw)
			return manifest
		} catch (error) {
			this.logger.error('[PluginManager] 读取 manifest 失败:', error)
			return null
		}
	}

	createDefaultState(manifest, overrides = {}) {
		return {
			enabled: false,
			installedVersion: manifest.version,
			installedAt: new Date().toISOString(),
			permissions: this.normalizePermissions(manifest.permissions),
			lastError: null,
			runtimeStatus: 'stopped',
			...overrides
		}
	}

	async installPlugin(pluginId) {
		const registryEntry = await this.findRegistryEntry(pluginId)
		
		let sourcePath
		let sourceManifest
		
		if (registryEntry) {
			// 从注册表安装
			sourcePath = this.resolveRegistrySourcePath(registryEntry)
			sourceManifest = await this.readManifestFromPath(sourcePath)
		} else {
			// 尝试从本地示例或开发目录安装
			const isDev = process.env.NODE_ENV === 'development'
			const localPaths = isDev ? [
				path.join(__dirname, '../../plugins/examples', pluginId),
				path.join(__dirname, '../../plugins/local', pluginId)
			] : [
				path.join(process.resourcesPath, 'plugins/examples', pluginId)
			]
			
			for (const localPath of localPaths) {
				if (await this.pathExists(localPath)) {
					sourcePath = localPath
					sourceManifest = await this.readManifestFromPath(sourcePath)
					if (sourceManifest) {
						console.log(`[PluginManager] 从本地路径安装: ${sourcePath}`)
						break
					}
				}
			}
			
			if (!sourceManifest) {
				throw new Error(`插件 ${pluginId} 不在插件仓库中，也未在本地找到`)
			}
		}

		if (!sourceManifest) {
			throw new Error('插件源缺少 manifest.json')
		}

		if (sourceManifest.id !== pluginId) {
			throw new Error(`插件源 manifest (${sourceManifest.id}) 与请求 ID (${pluginId}) 不一致`)
		}

		this.validateManifest(sourceManifest)

		const destinationPath = path.join(this.pluginsDir, pluginId)
		if (await this.pathExists(destinationPath)) {
			await fsp.rm(destinationPath, { recursive: true, force: true })
		}

		await this.ensureDir(this.pluginsDir)
		await fsp.cp(sourcePath, destinationPath, { recursive: true })

		const manifest = await this.readManifestFromPath(destinationPath)
		this.validateManifest(manifest)

		this.installedPlugins.set(pluginId, {
			manifest,
			path: destinationPath
		})

		const state = this.createDefaultState(manifest, {
			enabled: registryEntry?.autoEnable ?? true,
			installedAt: new Date().toISOString()
		})

		this.pluginStates.set(pluginId, state)
		
		// 安装后立即保存状态
		await this.saveStateImmediate()

		// 使用带图标的快照用于事件通知
		const snapshot = await this.getPluginStateSnapshotWithIcon(pluginId)
		this.emitStoreEvent({ type: 'installed', pluginId, plugin: snapshot, manifest })

		if (state.enabled) {
			try {
				await this.startPlugin(pluginId)
			} catch (error) {
				state.enabled = false
				state.runtimeStatus = 'error'
				state.lastError = error.message
				await this.saveStateImmediate()
				const errorSnapshot = await this.getPluginStateSnapshotWithIcon(pluginId)
				this.emitStoreEvent({
					type: 'error',
					pluginId,
					error: error.message,
					plugin: errorSnapshot
				})
				throw error
			}
		}

		return snapshot
	}

	async uninstallPlugin(pluginId) {
		await this.disablePlugin(pluginId)

		const pluginRecord = this.installedPlugins.get(pluginId)
		if (!pluginRecord) {
			throw new Error(`插件 ${pluginId} 未安装`)
		}

		await fsp.rm(pluginRecord.path, { recursive: true, force: true })

		this.installedPlugins.delete(pluginId)
		this.pluginStates.delete(pluginId)

		const storagePath = path.join(this.storageDir, `${pluginId}.json`)
		if (await this.pathExists(storagePath)) {
			await fsp.rm(storagePath, { force: true })
		}

		for (const [commandId, record] of this.commandRegistry.entries()) {
			if (record.pluginId === pluginId) {
				this.commandRegistry.delete(commandId)
			}
		}

		if (this.shortcutService && typeof this.shortcutService.removePluginCommands === 'function') {
			try {
				await this.shortcutService.removePluginCommands(pluginId)
			} catch (error) {
				this.logger.error(`[PluginManager] 卸载插件时移除快捷键失败 (${pluginId}):`, error)
			}
		}

		// 卸载后立即保存状态，确保状态持久化
		await this.saveStateImmediate()

		this.emitStoreEvent({ type: 'uninstalled', pluginId })

		return true
	}

	async enablePlugin(pluginId) {
		const state = this.pluginStates.get(pluginId)
		if (!state) {
			throw new Error(`插件 ${pluginId} 未安装`) 
		}

		if (state.enabled) {
			return this.getPluginStateSnapshot(pluginId)
		}

		state.enabled = true
		state.lastError = null
		
		// 启用后立即保存状态
		await this.saveStateImmediate()

		await this.startPlugin(pluginId)
		const snapshot = this.getPluginStateSnapshot(pluginId)
		this.emitStoreEvent({ type: 'enabled', pluginId, plugin: snapshot })
		return snapshot
	}

	async disablePlugin(pluginId) {
		const state = this.pluginStates.get(pluginId)
		if (!state) {
			return true
		}

		if (!state.enabled && !this.pluginWorkers.has(pluginId)) {
			return true
		}

		state.enabled = false
		await this.stopPlugin(pluginId)
		
		// 禁用后立即保存状态
		await this.saveStateImmediate()

		const snapshot = this.getPluginStateSnapshot(pluginId)
		this.emitStoreEvent({ type: 'disabled', pluginId, plugin: snapshot })
		return snapshot
	}

	async startPlugin(pluginId) {
		const record = this.installedPlugins.get(pluginId)
		const state = this.pluginStates.get(pluginId)

		if (!record || !state) {
			throw new Error(`插件 ${pluginId} 未安装或状态缺失`)
		}

		if (this.pluginWorkers.has(pluginId)) {
			return
		}

		const worker = new Worker(path.join(__dirname, 'pluginWorker.js'), {
			workerData: {
				pluginId,
				pluginPath: record.path,
				manifest: record.manifest,
				permissions: state.permissions,
				storagePath: path.join(this.storageDir, `${pluginId}.json`),
				timeout: record.manifest.runtime?.timeout || 15000
			}
		})

		state.runtimeStatus = 'starting'
		this.pluginWorkers.set(pluginId, worker)

		worker.on('message', (message) => this.handleWorkerMessage(pluginId, message))
		worker.on('error', (error) => this.handleWorkerError(pluginId, error))
		worker.on('exit', (code) => this.handleWorkerExit(pluginId, code))
	}

	async stopPlugin(pluginId) {
		const worker = this.pluginWorkers.get(pluginId)
		if (!worker) {
			const state = this.pluginStates.get(pluginId)
			if (state) {
				state.runtimeStatus = 'stopped'
			}
			return
		}

		await new Promise((resolve) => {
			const timeout = setTimeout(() => {
				worker.terminate().finally(resolve)
			}, 3000)

			worker.once('exit', () => {
				clearTimeout(timeout)
				resolve()
			})

			worker.postMessage({ type: 'shutdown' })
		})

		this.pluginWorkers.delete(pluginId)

		const commandsToRemove = []
		for (const [commandId, record] of this.commandRegistry.entries()) {
			if (record.pluginId === pluginId) {
				commandsToRemove.push(commandId)
			}
		}

		for (const commandId of commandsToRemove) {
			await this.unregisterCommand(pluginId, commandId)
		}

		if (this.shortcutService && typeof this.shortcutService.disablePluginCommands === 'function') {
			try {
				await this.shortcutService.disablePluginCommands(pluginId)
			} catch (error) {
				this.logger.error(`[PluginManager] 停止插件时清理快捷键失败 (${pluginId}):`, error)
			}
		}

		const state = this.pluginStates.get(pluginId)
		if (state) {
			state.runtimeStatus = 'stopped'
		}
	}

	handleWorkerMessage(pluginId, message) {
		if (!message || typeof message !== 'object') return

		switch (message.type) {
			case 'ready': {
				const state = this.pluginStates.get(pluginId)
				if (state) {
					state.runtimeStatus = 'ready'
					state.lastError = null
				}
				this.emitStoreEvent({ type: 'ready', pluginId, plugin: this.getPluginStateSnapshot(pluginId) })
				break
			}
			case 'log': {
				this.loggerLog(pluginId, message)
				break
			}
			case 'register-command': {
				this.registerCommand(pluginId, message.command).catch((error) => {
					this.logger.error(`[PluginManager] 注册命令失败 (${pluginId}:${message.command?.id}):`, error)
				})
				break
			}
			case 'unregister-command': {
				this.unregisterCommand(pluginId, message.commandId).catch((error) => {
					this.logger.error(`[PluginManager] 注销命令失败 (${pluginId}:${message.commandId}):`, error)
				})
				break
			}
			case 'invoke-command-result': {
				this.resolveCommandRequest(pluginId, message)
				break
			}
			case 'rpc': {
				this.handleRpc(pluginId, message)
				break
			}
			case 'fatal': {
				const error = new Error(message.error || '插件运行时发生未知错误')
				this.handleWorkerError(pluginId, error)
				break
			}
			default:
				this.logger.warn(`[PluginManager] 未处理的插件消息 (${pluginId}):`, message)
		}
	}

	loggerLog(pluginId, message) {
		const level = message.level || 'info'
		const payload = Array.isArray(message.args) ? message.args : [message.message]
		const prefix = `[Plugin:${pluginId}]`

		if (typeof this.logger[level] === 'function') {
			this.logger[level](prefix, ...payload)
		} else {
			this.logger.log(prefix, ...payload)
		}
	}

	resolveCommandRequest(pluginId, message) {
		const key = `${pluginId}:${message.requestId}`
		const pending = this.pendingCommandRequests.get(key)
		if (!pending) {
			return
		}

		this.pendingCommandRequests.delete(key)
		if (message.success) {
			pending.resolve(message.result)
		} else {
			pending.reject(new Error(message.error || '插件命令执行失败'))
		}
	}

	async handleRpc(pluginId, message) {
		const worker = this.pluginWorkers.get(pluginId)
		if (!worker) return

		const { requestId, scope, action, payload } = message

		const respond = (response) => {
			worker.postMessage({
				type: 'rpc-response',
				requestId,
				...response
			})
		}

		try {
			let result
			switch (scope) {
				case 'notes': {
					if (action === 'list') {
						this.assertPermission(pluginId, 'notes:read')
						const response = await this.services.noteService.getNotes(payload || {})
						const data = this.unwrapServiceResponse(response, '获取笔记列表失败')
						const notes = Array.isArray(data?.notes) ? data.notes.map((note) => this.sanitizeNote(note, pluginId)) : []
						result = {
							notes,
							pagination: data?.pagination || null
						}
					} else if (action === 'getRandom') {
						this.assertPermission(pluginId, 'notes:read')
						const response = await this.services.noteService.getRandomNote({ includeDeleted: false })
						const data = this.unwrapServiceResponse(response, '获取随机笔记失败')
						result = data ? this.sanitizeNote(data, pluginId) : null
					} else if (action === 'findById') {
						this.assertPermission(pluginId, 'notes:read')
						const noteDAO = this.services.noteDAO
						if (!noteDAO) {
							throw new Error('NoteDAO 服务不可用')
						}
						const note = noteDAO.findById(payload?.id)
						result = note ? this.sanitizeNote(note, pluginId) : null
					} else if (action === 'create') {
						this.assertPermission(pluginId, 'notes:write')
						const noteDAO = this.services.noteDAO
						if (!noteDAO) {
							throw new Error('NoteDAO 服务不可用')
						}
						
						this.logger.info('[PluginManager] 收到创建笔记请求', { payload })
						
						const noteData = {
							title: payload.title || '新笔记',
							content: payload.content || '',
							category: payload.category || '',
							tags: payload.tags || '',
							note_type: payload.note_type || 'markdown'
						}
						
						const noteId = noteDAO.create(noteData)
						const note = noteDAO.findById(noteId)
						
						result = {
							success: true,
							data: note ? this.sanitizeNote(note, pluginId) : { id: noteId }
						}
					} else if (action === 'update') {
						this.assertPermission(pluginId, 'notes:write')
						const noteService = this.services.noteService
						if (!noteService) {
							throw new Error('NoteService 服务不可用')
						}
						
						this.logger.info('[PluginManager] 收到更新笔记请求', { id: payload?.id, data: payload?.data })
						
						// 使用 NoteService 但设置为静默模式，避免触发前端事件导致循环保存
						// 插件更新笔记后会通过返回值通知调用者，不需要额外的事件广播
						const updateResult = await noteService.updateNote(payload?.id, payload?.data, true)
						
						if (!updateResult.success) {
							throw new Error(updateResult.error || '更新笔记失败')
						}
						
						result = {
							success: true,
							data: updateResult.data ? this.sanitizeNote(updateResult.data, pluginId) : null
						}
					} else if (action === 'delete') {
						this.assertPermission(pluginId, 'notes:write')
						const noteDAO = this.services.noteDAO
						if (!noteDAO) {
							throw new Error('NoteDAO 服务不可用')
						}
						
						this.logger.info('[PluginManager] 收到删除笔记请求', { id: payload?.id })
						
						noteDAO.delete(payload?.id)
						
						result = { success: true }
					} else {
						throw new Error(`未知的笔记 RPC 动作: ${action}`)
					}
					break
				}
				case 'todos': {
					if (action === 'list') {
						this.assertPermission(pluginId, 'todos:read')
						const todoDAO = this.services.todoDAO
						if (!todoDAO) {
							throw new Error('TodoDAO 服务不可用')
						}
						const todos = todoDAO.findAll(payload || {})
						result = Array.isArray(todos) ? todos.map((todo) => this.sanitizeTodo(todo, pluginId)) : []
					} else if (action === 'findById') {
						this.assertPermission(pluginId, 'todos:read')
						const todoDAO = this.services.todoDAO
						if (!todoDAO) {
							throw new Error('TodoDAO 服务不可用')
						}
						const todo = todoDAO.findById(payload?.id)
						result = todo ? this.sanitizeTodo(todo, pluginId) : null
					} else if (action === 'create') {
						this.assertPermission(pluginId, 'todos:write')
						const todoDAO = this.services.todoDAO
						if (!todoDAO) {
							throw new Error('TodoDAO 服务不可用')
						}
						
						this.logger.info('[PluginManager] 收到创建待办请求', { payload })
						
						// 直接使用数据库字段名，无需映射
						const todoData = {}
						
						// 必填字段
						if (payload.content !== undefined) {
							todoData.content = payload.content
						}
						
						// 可选字段
						if (payload.description !== undefined) {
							todoData.description = payload.description
						}
						if (payload.tags !== undefined) {
							todoData.tags = payload.tags
						}
						if (payload.is_completed !== undefined) {
							todoData.is_completed = payload.is_completed ? 1 : 0
						}
						if (payload.is_important !== undefined) {
							todoData.is_important = payload.is_important ? 1 : 0
						}
						if (payload.is_urgent !== undefined) {
							todoData.is_urgent = payload.is_urgent ? 1 : 0
						}
						if (payload.due_date !== undefined) {
							todoData.due_date = payload.due_date
						}
						if (payload.focus_time_seconds !== undefined) {
							todoData.focus_time_seconds = payload.focus_time_seconds
						}
						if (payload.repeat_type !== undefined) {
							todoData.repeat_type = payload.repeat_type
						}
						if (payload.repeat_interval !== undefined) {
							todoData.repeat_interval = payload.repeat_interval
						}
						if (payload.repeat_days !== undefined) {
							todoData.repeat_days = payload.repeat_days
						}
						
						this.logger.info('[PluginManager] 映射后的todoData', { todoData })
						
						const newTodo = todoDAO.create(todoData)
						
						this.logger.info('[PluginManager] 创建后返回的todo', { newTodo })
						
						result = newTodo ? this.sanitizeTodo(newTodo, pluginId) : null
					} else if (action === 'update') {
						this.assertPermission(pluginId, 'todos:write')
						const todoDAO = this.services.todoDAO
						if (!todoDAO) {
							throw new Error('TodoDAO 服务不可用')
						}
						const updated = todoDAO.update(payload?.id, payload?.data || {})
						result = updated ? this.sanitizeTodo(updated, pluginId) : null
					} else if (action === 'delete') {
						this.assertPermission(pluginId, 'todos:write')
						const todoDAO = this.services.todoDAO
						if (!todoDAO) {
							throw new Error('TodoDAO 服务不可用')
						}
						const deleted = todoDAO.delete(payload?.id)
						result = { success: deleted }
					} else {
						throw new Error(`未知的待办 RPC 动作: ${action}`)
					}
					break
				}
				case 'network': {
					if (action === 'fetch') {
						this.assertPermission(pluginId, 'network:request')
						const { url, options = {} } = payload || {}
						if (!url) {
							throw new Error('缺少 URL 参数')
						}
						// 使用 Node.js 内置 fetch (Node 18+) 或 node-fetch
						const fetch = global.fetch || require('node-fetch')
						const response = await fetch(url, options)
						const data = await response.text()
						result = {
							ok: response.ok,
							status: response.status,
							statusText: response.statusText,
							headers: Object.fromEntries(response.headers.entries()),
							data
						}
					} else {
						throw new Error(`未知的网络 RPC 动作: ${action}`)
					}
					break
				}
				case 'ui': {
					if (action === 'openNote') {
						this.assertPermission(pluginId, 'ui:open-note')
						if (!payload?.noteId) {
							throw new Error('缺少 noteId')
						}
						this.broadcast('plugin:ui-open-note', { pluginId, noteId: payload.noteId })
						result = { acknowledged: true }
					} else if (action === 'openWindow') {
						this.assertPermission(pluginId, 'ui:open-window')
						if (!payload?.url) {
							throw new Error('缺少 url 参数')
						}
						
						// 验证插件文件存在
						const pluginPath = this.getPluginPath(pluginId)
						if (!pluginPath) {
							throw new Error(`插件未安装: ${pluginId}`)
						}
						
						const htmlPath = path.join(pluginPath, payload.url.replace(/^\//, ''))
						if (!fs.existsSync(htmlPath)) {
							throw new Error(`插件文件不存在: ${payload.url}`)
						}
						
						// 广播打开窗口请求到前端
						this.broadcast('plugin:ui-open-window', {
							pluginId,
							url: payload.url,
							title: payload.title || '插件窗口',
							width: payload.width || 800,
							height: payload.height || 600,
							resizable: payload.resizable !== false,
							closable: payload.closable !== false
						})
						
						result = { acknowledged: true }
					} else {
						throw new Error(`未知的 UI RPC 动作: ${action}`)
					}
					break
				}
				case 'clipboard': {
					const { clipboard } = require('electron')
					if (action === 'readText') {
						this.assertPermission(pluginId, 'clipboard:read')
						result = { text: clipboard.readText() }
					} else if (action === 'writeText') {
						this.assertPermission(pluginId, 'clipboard:write')
						clipboard.writeText(payload?.text || '')
						result = { success: true }
					} else if (action === 'readImage') {
						this.assertPermission(pluginId, 'clipboard:read')
						const image = clipboard.readImage()
						result = { 
							dataUrl: image.isEmpty() ? null : image.toDataURL(),
							size: image.getSize()
						}
					} else if (action === 'writeImage') {
						this.assertPermission(pluginId, 'clipboard:write')
						const { nativeImage } = require('electron')
						const image = nativeImage.createFromDataURL(payload?.dataUrl)
						clipboard.writeImage(image)
						result = { success: true }
					} else {
						throw new Error(`未知的剪贴板 RPC 动作: ${action}`)
					}
					break
				}
				case 'tags': {
					const tagService = this.services.tagService
					if (!tagService) {
						throw new Error('TagService 服务不可用')
					}
					if (action === 'list') {
						this.assertPermission(pluginId, 'tags:read')
						const response = await tagService.getAllTags()
						result = this.unwrapServiceResponse(response, '获取标签列表失败')
					} else if (action === 'create') {
						this.assertPermission(pluginId, 'tags:write')
						// TagService 通过 updateTagsUsage 自动创建标签
						const tagName = payload?.name
						if (!tagName) {
							throw new Error('标签名称不能为空')
						}
						await tagService.updateTagsUsage([tagName])
						// 返回成功（标签现在已存在）
						result = { id: tagName, name: tagName }
					} else if (action === 'update') {
						this.assertPermission(pluginId, 'tags:write')
						// TagService 没有 updateTag 方法，标签只能通过 updateTagsUsage 修改
						throw new Error('标签更新功能暂不支持')
					} else if (action === 'delete') {
						this.assertPermission(pluginId, 'tags:write')
						const tagName = payload?.name
						if (!tagName) {
							throw new Error('标签名称不能为空')
						}
						await tagService.deleteTag(tagName)
						result = { success: true }
					} else {
						throw new Error(`未知的标签 RPC 动作: ${action}`)
					}
					break
				}
				case 'filesystem': {
					const { dialog } = require('electron')
					const fs = require('fs').promises
					if (action === 'pickFile') {
						this.assertPermission(pluginId, 'filesystem:read')
						const windows = this.windowAccessor()
						const result_dialog = await dialog.showOpenDialog(windows[0], {
							properties: ['openFile'],
							filters: payload?.filters || [],
							defaultPath: payload?.defaultPath
						})
						if (result_dialog.canceled) {
							result = null
						} else {
							const filePath = result_dialog.filePaths[0]
							const stats = await fs.stat(filePath)
							result = {
								filePath,
								fileName: require('path').basename(filePath),
								size: stats.size
							}
						}
					} else if (action === 'readFile') {
						this.assertPermission(pluginId, 'filesystem:read')
						const content = await fs.readFile(payload?.filePath, payload?.encoding || 'utf8')
						const stats = await fs.stat(payload?.filePath)
						result = { content, size: stats.size }
					} else if (action === 'pickDirectory') {
						this.assertPermission(pluginId, 'filesystem:read')
						const windows = this.windowAccessor()
						const result_dialog = await dialog.showOpenDialog(windows[0], {
							properties: ['openDirectory']
						})
						result = result_dialog.canceled ? null : { dirPath: result_dialog.filePaths[0] }
					} else if (action === 'writeFile') {
						this.assertPermission(pluginId, 'filesystem:write')
						const windows = this.windowAccessor()
						const result_dialog = await dialog.showSaveDialog(windows[0], {
							defaultPath: payload?.filePath
						})
						if (!result_dialog.canceled) {
							await fs.writeFile(result_dialog.filePath, payload?.content || '')
							result = { success: true, filePath: result_dialog.filePath }
						} else {
							result = { success: false }
						}
					} else {
						throw new Error(`未知的文件系统 RPC 动作: ${action}`)
					}
					break
				}
				case 'storage': {
					if (action === 'getItem') {
						this.assertPermission(pluginId, 'storage:read')
					} else if (['setItem', 'removeItem', 'clear'].includes(action)) {
						this.assertPermission(pluginId, 'storage:write')
					}
					result = await this.handleStorageRpc(pluginId, action, payload)
					break
				}
				case 'notifications': {
					if (action === 'show') {
						this.assertPermission(pluginId, 'notifications:show')
						this.broadcast('plugin:notification', { pluginId, payload })
						result = { acknowledged: true }
					} else {
						throw new Error(`未知的通知 RPC 动作: ${action}`)
					}
					break
				}
				case 'search': {
					this.assertPermission(pluginId, 'search:advanced')
					const noteService = this.services.noteService
					if (!noteService) {
						throw new Error('NoteService 服务不可用')
					}
					if (action === 'fullText') {
						const searchResult = await noteService.searchNotes(payload?.query, payload?.options)
						if (!searchResult.success) {
							throw new Error(searchResult.error || '搜索失败')
						}
						result = {
							results: (searchResult.data?.notes || []).map(note => ({
								noteId: note.id,
								title: note.title,
								// 简化匹配信息
								matches: [{ content: note.title }]
							})),
							total: searchResult.data?.total || 0
						}
					} else if (action === 'filter') {
						// 高级过滤逻辑
						const options = { ...payload?.conditions }
						const notesResult = await noteService.getNotes(options)
						if (!notesResult.success) {
							throw new Error(notesResult.error || '过滤失败')
						}
						result = { noteIds: notesResult.data?.notes?.map(n => n.id) || [] }
					} else {
						throw new Error(`未知的搜索 RPC 动作: ${action}`)
					}
					break
				}
				case 'events': {
					this.assertPermission(pluginId, 'events:subscribe')
					if (action === 'subscribe') {
						const { eventType, listenerId } = payload || {}
						if (!eventType || !listenerId) {
							throw new Error('缺少 eventType 或 listenerId')
						}
						// 存储订阅关系
						if (!this.pluginEventListeners) {
							this.pluginEventListeners = new Map()
						}
						if (!this.pluginEventListeners.has(pluginId)) {
							this.pluginEventListeners.set(pluginId, new Map())
						}
						this.pluginEventListeners.get(pluginId).set(listenerId, eventType)
						result = { success: true, listenerId }
					} else if (action === 'unsubscribe') {
						const { listenerId } = payload || {}
						if (this.pluginEventListeners?.has(pluginId)) {
							this.pluginEventListeners.get(pluginId).delete(listenerId)
						}
						result = { success: true }
					} else {
						throw new Error(`未知的事件 RPC 动作: ${action}`)
					}
					break
				}
				case 'analytics': {
					this.assertPermission(pluginId, 'analytics:read')
					if (action === 'notesStats') {
						const noteService = this.services.noteService
						const notesResult = await noteService.getNotes({ limit: 10000 })
						if (!notesResult.success) {
							throw new Error(notesResult.error || '获取笔记统计失败')
						}
						const notes = notesResult.data?.notes || []
						result = {
							total: notes.length,
							byCategory: notes.reduce((acc, note) => {
								acc[note.category || '未分类'] = (acc[note.category || '未分类'] || 0) + 1
								return acc
							}, {})
						}
					} else if (action === 'todosStats') {
						const todoDAO = this.services.todoDAO
						if (!todoDAO) {
							throw new Error('TodoDAO 服务不可用')
						}
						const todos = todoDAO.findAll({ includeCompleted: true })
						const completed = todos.filter(t => t.is_completed).length
						result = {
							total: todos.length,
							completed,
							pending: todos.length - completed,
							completionRate: todos.length > 0 ? completed / todos.length : 0
						}
					} else {
						throw new Error(`未知的分析 RPC 动作: ${action}`)
					}
					break
				}
				case 'ai': {
					this.assertPermission(pluginId, 'ai:inference')
					const aiService = this.services.aiService
					if (!aiService) {
						throw new Error('AI 服务不可用或未配置')
					}
					if (action === 'chat') {
						const response = await aiService.chat(payload?.messages, payload?.options)
						result = response
					} else if (action === 'isAvailable') {
						const configResult = await aiService.getConfig()
						if (!configResult.success) {
							throw new Error(configResult.error || '获取 AI 配置失败')
						}
						const config = configResult.data
						result = { 
							available: Boolean(config.enabled && config.apiKey),
							provider: config.provider || 'unknown',
							model: config.model || 'unknown'
						}
					} else {
						throw new Error(`未知的 AI RPC 动作: ${action}`)
					}
					break
				}
				case 'mem0': {
					const mem0Service = this.services.mem0Service
					if (!mem0Service) {
						throw new Error('Mem0 服务不可用')
					}
					
					if (action === 'add') {
						this.assertPermission(pluginId, 'mem0:write')
						const { userId, content, options } = payload || {}
						if (!userId || !content) {
							throw new Error('userId 和 content 是必需的')
						}
						result = await mem0Service.addMemory(userId, content, options)
					} else if (action === 'search') {
						this.assertPermission(pluginId, 'mem0:read')
						const { userId, query, options } = payload || {}
						if (!userId || !query) {
							throw new Error('userId 和 query 是必需的')
						}
						const memories = await mem0Service.searchMemories(userId, query, options)
						result = { memories }
					} else if (action === 'get') {
						this.assertPermission(pluginId, 'mem0:read')
						const { userId, options } = payload || {}
						if (!userId) {
							throw new Error('userId 是必需的')
						}
						const memories = await mem0Service.getMemories(userId, options)
						result = { memories }
					} else if (action === 'delete') {
						this.assertPermission(pluginId, 'mem0:write')
						const { memoryId } = payload || {}
						if (!memoryId) {
							throw new Error('memoryId 是必需的')
						}
						const deleted = await mem0Service.deleteMemory(memoryId)
						result = { deleted }
					} else if (action === 'clear') {
						this.assertPermission(pluginId, 'mem0:write')
						const { userId } = payload || {}
						if (!userId) {
							throw new Error('userId 是必需的')
						}
						const count = await mem0Service.clearUserMemories(userId)
						result = { count }
					} else if (action === 'stats') {
						this.assertPermission(pluginId, 'mem0:read')
						const { userId } = payload || {}
						if (!userId) {
							throw new Error('userId 是必需的')
						}
						result = await mem0Service.getStats(userId)
					} else if (action === 'update') {
						this.assertPermission(pluginId, 'mem0:write')
						const { memoryId, content, options } = payload || {}
						if (!memoryId || !content) {
							throw new Error('memoryId 和 content 是必需的')
						}
						result = await mem0Service.updateMemory(memoryId, content, options)
					} else if (action === 'isAvailable') {
						result = { available: mem0Service.isAvailable() }
					} else {
						throw new Error(`未知的 Mem0 RPC 动作: ${action}`)
					}
					break
				}
				case 'theme': {
					this.assertPermission(pluginId, 'ui:theme')
					
					if (action === 'registerGlobalStyle') {
						const { styleId, css, options } = payload || {}
						if (!styleId || !css) {
							throw new Error('styleId 和 css 是必需的')
						}
						
						const priority = options?.priority || 0
						
						this.logger.info(`[Theme] 注册样式: ${pluginId}/${styleId}`, { cssLength: css.length, priority })
						
						// 通过 store event 广播样式注册请求到前端
						this.emitStoreEvent({
							type: 'plugin:theme-register-style',
							pluginId,
							styleId,
							css,
							priority
						})
						
						result = { success: true, styleId }
					} else if (action === 'unregisterGlobalStyle') {
						const { styleId } = payload || {}
						if (!styleId) {
							throw new Error('styleId 是必需的')
						}
						
						// 通过 store event 广播样式移除请求到前端
						this.emitStoreEvent({
							type: 'plugin:theme-unregister-style',
							pluginId,
							styleId
						})
						
						result = { success: true }
					} else if (action === 'updateGlobalStyle') {
						const { styleId, css, options } = payload || {}
						if (!styleId || !css) {
							throw new Error('styleId 和 css 是必需的')
						}
						
						const priority = options?.priority
						
						// 通过 store event 广播样式更新请求到前端
						this.emitStoreEvent({
							type: 'plugin:theme-update-style',
							pluginId,
							styleId,
							css,
							priority: priority !== undefined ? priority : null
						})
						
						result = { success: true, styleId }
					} else {
						throw new Error(`未知的主题 RPC 动作: ${action}`)
					}
					break
				}
				case 'stt': {
					this.assertPermission(pluginId, 'stt:transcribe')
					const sttService = this.services.sttService
					if (!sttService) {
						throw new Error('STT 服务不可用或未配置')
					}
					if (action === 'transcribe') {
						const { audioFile, options } = payload || {}
						if (!audioFile) {
							throw new Error('audioFile 是必需的')
						}
						const response = await sttService.transcribe(audioFile, options)
						result = response
					} else if (action === 'isAvailable') {
						const configResult = await sttService.getConfig()
						if (!configResult.success) {
							throw new Error(configResult.error || '获取 STT 配置失败')
						}
						const config = configResult.data
						result = { 
							available: Boolean(config.enabled && config.apiKey),
							provider: config.provider || 'unknown',
							model: config.model || 'unknown'
						}
					} else {
						throw new Error(`未知的 STT RPC 动作: ${action}`)
					}
					break
				}
				default:
					throw new Error(`未知的 RPC scope: ${scope}`)
			}

			respond({ success: true, result })
		} catch (error) {
			this.logger.error(`[PluginManager] 处理 RPC 失败 (${pluginId}):`, error)
			respond({ success: false, error: error.message })
		}
	}

	sanitizeNote(note, pluginId) {
		if (!note || typeof note !== 'object') return null
		
		const state = this.pluginStates.get(pluginId)
		const hasFullAccess = state?.permissions?.['notes:read:full']
		
		// 基础字段始终返回
		const sanitized = {
			id: note.id,
			title: note.title,
			tags: note.tags,
			updated_at: note.updated_at,
			created_at: note.created_at,
			category: note.category
		}
		
		// 如果有完整读取权限，则包含内容和其他字段
		if (hasFullAccess) {
			sanitized.content = note.content
			sanitized.favorited = note.favorited
			sanitized.deleted = note.deleted
		}
		
		return sanitized
	}

	sanitizeTodo(todo, pluginId) {
		if (!todo || typeof todo !== 'object') return null
		
		const state = this.pluginStates.get(pluginId)
		const hasFullAccess = state?.permissions?.['todos:read:full']
		
		// 基础字段始终返回 (直接使用数据库字段名)
		const sanitized = {
			id: todo.id,
			content: todo.content || '',
			is_completed: Boolean(todo.is_completed),
			updated_at: todo.updated_at,
			created_at: todo.created_at,
			category: todo.category,
			focus_time_seconds: todo.focus_time_seconds || 0
		}
		
		// 如果有完整读取权限，则包含详细内容
		if (hasFullAccess) {
			sanitized.description = todo.description || ''
			sanitized.due_date = todo.due_date
			sanitized.tags = todo.tags
			sanitized.is_important = Boolean(todo.is_important)
			sanitized.is_urgent = Boolean(todo.is_urgent)
			sanitized.reminder_time = todo.reminder_time
			sanitized.deleted = todo.deleted
			sanitized.completed_at = todo.completed_at
		}
		
		return sanitized
	}

	assertPermission(pluginId, permission) {
		const state = this.pluginStates.get(pluginId)
		if (!state || !state.permissions?.[permission]) {
			throw new Error(`插件 ${pluginId} 没有权限: ${permission}`)
		}
	}

	/**
	 * 解包服务响应格式 {success, data?, error?}
	 */
	unwrapServiceResponse(response, errorMessage = '操作失败') {
		if (!response) {
			throw new Error(errorMessage)
		}
		if (response.success === false) {
			throw new Error(response.error || errorMessage)
		}
		// 如果有 data 字段，返回 data；否则返回整个响应
		return response.data !== undefined ? response.data : response
	}

	async handleStorageRpc(pluginId, action, payload = {}) {
		const storage = await this.loadPluginStorage(pluginId)

		switch (action) {
			case 'getItem':
				return storage[payload.key] ?? null
			case 'setItem':
				storage[payload.key] = payload.value
				await this.savePluginStorage(pluginId, storage)
				return true
			case 'removeItem':
				delete storage[payload.key]
				await this.savePluginStorage(pluginId, storage)
				return true
			case 'clear':
				await this.savePluginStorage(pluginId, {})
				return true
			default:
				throw new Error(`未知的存储动作: ${action}`)
		}
	}

	async loadPluginStorage(pluginId) {
		// 优先使用数据库存储
		try {
			const db = this.dbManager?.getDatabase()
			if (db) {
				const rows = db.prepare(
					'SELECT key, value FROM plugin_storage WHERE plugin_id = ?'
				).all(pluginId)
				
				const data = {}
				for (const row of rows) {
					try {
						data[row.key] = JSON.parse(row.value)
					} catch {
						data[row.key] = row.value
					}
				}
				return data
			}
		} catch (error) {
			this.logger.warn(`[PluginManager] 从数据库读取插件存储失败 (${pluginId}):`, error.message)
		}
		
		// 回退到 JSON 文件（向后兼容）
		const storagePath = path.join(this.storageDir, `${pluginId}.json`)
		try {
			const raw = await fsp.readFile(storagePath, 'utf8')
			const data = JSON.parse(raw)
			
			// 迁移到数据库
			if (this.dbManager?.getDatabase() && data && typeof data === 'object') {
				await this._migrateStorageToDb(pluginId, data)
				// 删除旧文件
				await fsp.unlink(storagePath).catch(() => {})
				this.logger.info(`[PluginManager] 已将 ${pluginId} 存储迁移到数据库`)
			}
			
			return data && typeof data === 'object' ? data : {}
		} catch (error) {
			if (error.code === 'ENOENT') {
				return {}
			}
			// JSON 解析错误 - 文件损坏，直接返回空对象
			if (error instanceof SyntaxError) {
				this.logger.warn(`[PluginManager] 插件存储文件损坏 (${pluginId})，将重置`)
				await fsp.unlink(storagePath).catch(() => {})
				return {}
			}
			this.logger.warn(`[PluginManager] 读取插件存储失败 (${pluginId}):`, error)
			return {}
		}
	}

	async savePluginStorage(pluginId, data) {
		// 优先使用数据库存储
		const db = this.dbManager?.getDatabase()
		if (db) {
			try {
				const stmt = db.prepare(`
					INSERT OR REPLACE INTO plugin_storage (plugin_id, key, value, updated_at)
					VALUES (?, ?, ?, datetime('now'))
				`)
				
				const deleteStmt = db.prepare(
					'DELETE FROM plugin_storage WHERE plugin_id = ?'
				)
				
				// 使用事务确保原子性
				db.transaction(() => {
					deleteStmt.run(pluginId)
					for (const [key, value] of Object.entries(data)) {
						const jsonValue = JSON.stringify(value)
						stmt.run(pluginId, key, jsonValue)
					}
				})()
				
				return
			} catch (error) {
				this.logger.warn(`[PluginManager] 保存到数据库失败 (${pluginId}):`, error.message)
				// 回退到文件存储
			}
		}
		
		// 回退到 JSON 文件
		const storagePath = path.join(this.storageDir, `${pluginId}.json`)
		await fsp.writeFile(storagePath, JSON.stringify(data, null, 2), 'utf8')
	}
	
	/**
	 * 将 JSON 文件存储迁移到数据库
	 * @private
	 */
	async _migrateStorageToDb(pluginId, data) {
		const db = this.dbManager?.getDatabase()
		if (!db || !data) return
		
		const stmt = db.prepare(`
			INSERT OR REPLACE INTO plugin_storage (plugin_id, key, value, updated_at)
			VALUES (?, ?, ?, datetime('now'))
		`)
		
		db.transaction(() => {
			for (const [key, value] of Object.entries(data)) {
				const jsonValue = JSON.stringify(value)
				stmt.run(pluginId, key, jsonValue)
			}
		})()
	}

	async registerCommand(pluginId, command) {
		if (!command || !command.id) {
			return
		}

		let binding = null
		const pluginRecord = this.installedPlugins.get(pluginId)
		const pluginName = pluginRecord?.manifest?.name || pluginId

		if (this.shortcutService && typeof this.shortcutService.registerPluginCommand === 'function') {
			try {
				binding = await this.shortcutService.registerPluginCommand(pluginId, {
					...command,
					pluginName
				})
			} catch (error) {
				this.logger.error(`[PluginManager] 注册插件快捷键失败 (${pluginId}:${command.id}):`, error)
			}
		}

		const definition = {
			...command,
			shortcutBinding: binding
		}

		this.commandRegistry.set(command.id, { pluginId, definition })
		this.emitStoreEvent({
			type: 'command-registered',
			pluginId,
			command: definition,
			plugin: this.getPluginStateSnapshot(pluginId)
		})
	}

	async unregisterCommand(pluginId, commandId) {
		if (!commandId) return
		const existing = this.commandRegistry.get(commandId)
		if (existing && existing.pluginId === pluginId) {
			this.commandRegistry.delete(commandId)

			if (this.shortcutService && typeof this.shortcutService.unregisterPluginCommand === 'function') {
				try {
					await this.shortcutService.unregisterPluginCommand(pluginId, commandId)
				} catch (error) {
					this.logger.error(`[PluginManager] 注销插件快捷键失败 (${pluginId}:${commandId}):`, error)
				}
			}

			this.emitStoreEvent({
				type: 'command-unregistered',
				pluginId,
				commandId,
				plugin: this.getPluginStateSnapshot(pluginId)
			})
		}
	}

	async executeCommand(pluginId, commandId, payload) {
		if (!this.pluginWorkers.has(pluginId)) {
			throw new Error('插件未运行或已禁用')
		}
		const worker = this.pluginWorkers.get(pluginId)
			const requestId = typeof crypto.randomUUID === 'function'
				? crypto.randomUUID()
				: `${Date.now()}-${Math.random().toString(16).slice(2)}`

		return new Promise((resolve, reject) => {
			const key = `${pluginId}:${requestId}`

			// 根据命令类型动态设置超时时间
			// AI 相关命令需要更长的超时时间
			let timeoutDuration = 15000 // 默认 15 秒
			if (commandId && (
				commandId.includes('ai') || 
				commandId.includes('generate') || 
				commandId.includes('chat')
			)) {
				timeoutDuration = 60000 // AI 命令 60 秒
			}

			const timeout = setTimeout(() => {
				if (this.pendingCommandRequests.has(key)) {
					this.pendingCommandRequests.delete(key)
					reject(new Error('插件命令执行超时'))
				}
			}, timeoutDuration)

			const safeResolve = (value) => {
				clearTimeout(timeout)
				resolve(value)
			}

			const safeReject = (error) => {
				clearTimeout(timeout)
				reject(error)
			}

			this.pendingCommandRequests.set(key, { resolve: safeResolve, reject: safeReject })

			worker.postMessage({
				type: 'invoke-command',
				requestId,
				commandId,
				payload
			})
		})
	}

	emitStoreEvent(event) {
		this.emit('store-event', event)
		this.broadcast(STORE_EVENT_CHANNEL, event)
	}

	broadcast(channel, payload) {
		const windows = []
		try {
			const result = this.windowAccessor?.()
			if (Array.isArray(result)) {
				windows.push(...result)
			} else if (result) {
				windows.push(result)
			}
		} catch (error) {
			this.logger.error('[PluginManager] 获取窗口列表失败:', error)
		}

		windows.forEach((win) => {
			try {
				if (win && !win.isDestroyed()) {
					win.webContents.send(channel, payload)
				}
			} catch (error) {
				this.logger.error('[PluginManager] 广播插件事件失败:', error)
			}
		})
	}

	handleWorkerError(pluginId, error) {
		this.logger.error(`[PluginManager] 插件线程错误 (${pluginId}):`, error)

		const state = this.pluginStates.get(pluginId)
		if (state) {
			state.runtimeStatus = 'error'
			state.lastError = error.message
		}

		this.emitStoreEvent({ type: 'error', pluginId, error: error.message, plugin: this.getPluginStateSnapshot(pluginId) })
		
		// 尝试自动重启插件
		this.attemptPluginRestart(pluginId, error).catch((restartError) => {
			this.logger.error(`[PluginManager] 重启插件 ${pluginId} 失败:`, restartError)
		})
	}

	handleWorkerExit(pluginId, code) {
		this.pluginWorkers.delete(pluginId)

		const state = this.pluginStates.get(pluginId)
		if (state) {
			state.runtimeStatus = 'stopped'
		}

		if (code !== 0 && (state?.enabled || state?.lastError)) {
			this.logger.warn(`[PluginManager] 插件 ${pluginId} 线程异常退出，代码: ${code}`)
			this.emitStoreEvent({ type: 'exit', pluginId, code })
			
			// 尝试自动重启插件
			this.attemptPluginRestart(pluginId, new Error(`插件异常退出，代码: ${code}`)).catch((restartError) => {
				this.logger.error(`[PluginManager] 重启插件 ${pluginId} 失败:`, restartError)
			})
		} else {
			this.emitStoreEvent({ type: 'stopped', pluginId })
		}
	}

	/**
	 * 尝试自动重启插件（指数退避策略）
	 */
	async attemptPluginRestart(pluginId, error) {
		const state = this.pluginStates.get(pluginId)
		
		// 只重启已启用的插件
		if (!state || !state.enabled) {
			return
		}

		// 获取或初始化重启尝试记录
		let restartInfo = this.pluginRestartAttempts.get(pluginId)
		const now = Date.now()

		if (!restartInfo) {
			restartInfo = {
				count: 0,
				lastAttempt: 0,
				backoffDelay: this.INITIAL_BACKOFF_DELAY
			}
			this.pluginRestartAttempts.set(pluginId, restartInfo)
		}

		// 如果距离上次尝试超过重置间隔，重置计数
		if (now - restartInfo.lastAttempt > this.RESTART_RESET_INTERVAL) {
			restartInfo.count = 0
			restartInfo.backoffDelay = this.INITIAL_BACKOFF_DELAY
		}

		// 检查是否超过最大重试次数
		if (restartInfo.count >= this.MAX_RESTART_ATTEMPTS) {
			this.logger.error(
				`[PluginManager] 插件 ${pluginId} 已达到最大重启次数 (${this.MAX_RESTART_ATTEMPTS})，停止自动重启`
			)
			state.lastError = `插件崩溃次数过多，已停止自动重启: ${error.message}`
			this.emitStoreEvent({
				type: 'restart-failed',
				pluginId,
				error: state.lastError,
				plugin: this.getPluginStateSnapshot(pluginId)
			})
			return
		}

		// 增加重试计数
		restartInfo.count++
		restartInfo.lastAttempt = now

		this.logger.info(
			`[PluginManager] 将在 ${restartInfo.backoffDelay}ms 后尝试重启插件 ${pluginId} (第 ${restartInfo.count}/${this.MAX_RESTART_ATTEMPTS} 次)`
		)

		// 等待退避延迟
		await new Promise((resolve) => setTimeout(resolve, restartInfo.backoffDelay))

		// 计算下次退避延迟（指数增长）
		restartInfo.backoffDelay = Math.min(restartInfo.backoffDelay * 2, this.MAX_BACKOFF_DELAY)

		try {
			// 先停止插件（清理资源）
			await this.stopPlugin(pluginId)

			// 等待一小段时间确保资源释放
			await new Promise((resolve) => setTimeout(resolve, 500))

			// 重新启动插件
			await this.startPlugin(pluginId)

			this.logger.info(`[PluginManager] 插件 ${pluginId} 重启成功`)
			state.lastError = null
			this.emitStoreEvent({
				type: 'restarted',
				pluginId,
				plugin: this.getPluginStateSnapshot(pluginId)
			})
		} catch (restartError) {
			this.logger.error(`[PluginManager] 重启插件 ${pluginId} 失败:`, restartError)
			state.lastError = `重启失败: ${restartError.message}`
			throw restartError
		}
	}

	/**
	 * 重置插件重启计数（手动操作时调用）
	 */
	resetPluginRestartAttempts(pluginId) {
		this.pluginRestartAttempts.delete(pluginId)
		this.logger.info(`[PluginManager] 已重置插件 ${pluginId} 的重启计数`)
	}

	/**
	 * 获取插件重启统计信息
	 */
	getPluginRestartStats(pluginId) {
		const restartInfo = this.pluginRestartAttempts.get(pluginId)
		if (!restartInfo) {
			return { count: 0, lastAttempt: null, nextBackoffDelay: this.INITIAL_BACKOFF_DELAY }
		}
		return {
			count: restartInfo.count,
			lastAttempt: new Date(restartInfo.lastAttempt).toISOString(),
			nextBackoffDelay: restartInfo.backoffDelay
		}
	}

	/**
	 * 清理资源（应用退出时调用）
	 */
	async cleanup() {
		// 清除防抖定时器
		if (this.saveStateTimer) {
			clearTimeout(this.saveStateTimer)
			this.saveStateTimer = null
		}

		// 立即保存状态
		if (this.isDirty) {
			await this.saveStateImmediate()
		}

		// 停止所有插件
		const stopPromises = []
		for (const pluginId of this.pluginWorkers.keys()) {
			stopPromises.push(this.stopPlugin(pluginId).catch((error) => {
				this.logger.error(`[PluginManager] 停止插件 ${pluginId} 失败:`, error)
			}))
		}
		await Promise.all(stopPromises)

		this.logger.info('[PluginManager] 清理完成')
	}
}

module.exports = PluginManager
