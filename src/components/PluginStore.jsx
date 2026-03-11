import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
	Box,
	Typography,
	Stack,
	TextField,
	InputAdornment,
	IconButton,
	Tooltip,
	Chip,
	Snackbar,
	Alert,
	LinearProgress,
	Button,
	List,
	ListItem,
	ListItemText
} from '@mui/material'
import {
	Search as SearchIcon,
	RefreshRounded,
	FolderOpenRounded
} from '@mui/icons-material'

import {
	fetchAvailablePlugins,
	fetchInstalledPlugins,
	fetchLocalPlugins,
	installPlugin,
	uninstallPlugin,
	enablePlugin,
	disablePlugin,
	executePluginCommand,
	openPluginFolder,
	openPluginsDirectory,
	subscribePluginEvents,
	subscribePluginUiRequests
} from '../api/pluginAPI'
import { useStore } from '../store/useStore'
import { getDisplayCategories, filterPlugins } from './pluginUtils'
import PluginCard from './PluginCard'
import PluginDetailDrawer from './PluginDetailDrawer'

const PluginStore = () => {
	const pluginStoreFilters = useStore((state) => state.pluginStoreFilters)
	const setPluginStoreSearch = useStore((state) => state.setPluginStoreSearch)
	const pluginStoreSelectedPluginId = useStore((state) => state.pluginStoreSelectedPluginId)
	const setPluginStoreSelectedPluginId = useStore((state) => state.setPluginStoreSelectedPluginId)
	const setPluginStoreCategories = useStore((state) => state.setPluginStoreCategories)

	const [availablePlugins, setAvailablePlugins] = useState([])
	const [installedPlugins, setInstalledPlugins] = useState([])
	const [localPlugins, setLocalPlugins] = useState([])
	const [loading, setLoading] = useState(true)
	const [localLoading, setLocalLoading] = useState(false)
	const [error, setError] = useState(null)
	const [pendingActions, setPendingActions] = useState({})
	const [snackbar, setSnackbar] = useState({ open: false, severity: 'success', message: '' })
	const [commandPending, setCommandPending] = useState(null)

	const showMessage = useCallback((severity, message) => {
		setSnackbar({ open: true, severity, message })
	}, [])

	const closeSnackbar = () => setSnackbar((prev) => ({ ...prev, open: false }))

	const synchronizeCategories = useCallback((plugins) => {
		const categorySet = new Set()
		plugins.forEach((plugin) => {
			getDisplayCategories(plugin).forEach((category) => categorySet.add(category))
		})
		const normalized = Array.from(categorySet).map((category) => ({ id: category, name: category }))
		setPluginStoreCategories(normalized)
	}, [setPluginStoreCategories])

	const loadLocalPlugins = useCallback(async () => {
		setLocalLoading(true)
		try {
			const local = await fetchLocalPlugins()
			setLocalPlugins(Array.isArray(local) ? local : [])
		} catch (err) {
			console.error('加载本地插件失败', err)
		} finally {
			setLocalLoading(false)
		}
	}, [])

	const fetchData = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const [available, installed] = await Promise.all([
				fetchAvailablePlugins(),
				fetchInstalledPlugins()
			])

			setAvailablePlugins(Array.isArray(available) ? available : [])
			setInstalledPlugins(Array.isArray(installed) ? installed : [])
			synchronizeCategories(Array.isArray(available) ? available : [])
		} catch (err) {
			console.error('加载插件数据失败', err)
			setError(err?.message || '加载插件数据失败')
		} finally {
			setLoading(false)
		}
	}, [synchronizeCategories])

	useEffect(() => {
		fetchData()
	}, [fetchData])

	// 当切换到本地开发标签时，加载本地插件
	useEffect(() => {
		if (pluginStoreFilters.tab === 'local') {
			loadLocalPlugins()
		}
	}, [pluginStoreFilters.tab, loadLocalPlugins])

	// 当 availablePlugins 改变时，同步更新分类
	useEffect(() => {
		if (availablePlugins.length > 0) {
			synchronizeCategories(availablePlugins)
		}
	}, [availablePlugins, synchronizeCategories])

	useEffect(() => {
		const unsubscribe = subscribePluginEvents((event) => {
			if (!event || !event.pluginId) return

			setAvailablePlugins((prev) => {
				return prev.map((item) => {
					if (item.id !== event.pluginId) return item

					if (event.type === 'uninstalled') {
						return {
							...item,
							installed: false,
							enabled: false,
							installedVersion: null,
							lastError: event.error || null
						}
					}

					if (event.plugin) {
						return {
							...item,
							installed: true,
							enabled: event.plugin.enabled,
							installedVersion: event.plugin.installedVersion,
							lastError: event.plugin.lastError || null,
							commands: event.plugin.commands || item.commands
						}
					}

					if (event.type === 'command-registered' && event.command) {
						const commands = Array.isArray(item.commands) ? item.commands : []
						if (commands.some((cmd) => cmd.id === event.command.id)) return item
						return {
							...item,
							commands: [...commands, event.command]
						}
					}

					if (event.type === 'command-unregistered' && event.commandId) {
						const commands = Array.isArray(item.commands) ? item.commands.filter((cmd) => cmd.id !== event.commandId) : []
						return {
							...item,
							commands
						}
					}

					return item
				})
			})

			setInstalledPlugins((prev) => {
				switch (event.type) {
					case 'installed':
					case 'ready':
					case 'enabled':
					case 'disabled':
					case 'error':
						if (event.plugin) {
							const exists = prev.find((plugin) => plugin.id === event.pluginId)
							if (exists) {
								// 更新时保留现有图标
								return prev.map((plugin) => plugin.id === event.pluginId 
									? { ...event.plugin, icon: event.plugin.icon || plugin.icon }
									: plugin)
							}
							return [...prev, event.plugin]
						}
						return prev
					case 'uninstalled':
						return prev.filter((plugin) => plugin.id !== event.pluginId)
					case 'command-registered':
						return prev.map((plugin) => {
							if (plugin.id !== event.pluginId) return plugin
							const commands = Array.isArray(plugin.commands) ? plugin.commands : []
							if (commands.some((cmd) => cmd.id === event.command.id)) return plugin
							return {
								...plugin,
								commands: [...commands, event.command]
							}
						})
					case 'command-unregistered':
						return prev.map((plugin) => {
							if (plugin.id !== event.pluginId) return plugin
							return {
								...plugin,
								commands: Array.isArray(plugin.commands)
									? plugin.commands.filter((cmd) => cmd.id !== event.commandId)
									: []
							}
						})
					default:
						return prev
				}
			})
		})

		const detachUi = subscribePluginUiRequests((payload) => {
			if (!payload?.noteId) return
			showMessage('info', `插件请求打开笔记 ${payload.noteId}`)
		})

		return () => {
			unsubscribe && unsubscribe()
			detachUi && detachUi()
		}
	}, [showMessage])

	const withPendingAction = useCallback(async (pluginId, actionKey, runner, successMessage) => {
		setPendingActions((prev) => ({ ...prev, [pluginId]: actionKey }))
		try {
			const result = await runner()
			if (result && result.success === false && result.error) {
				throw new Error(result.error)
			}
			if (successMessage) {
				showMessage('success', successMessage)
			}
			await fetchData()
			return result
		} catch (err) {
			console.error(`执行插件操作失败: ${pluginId}`, err)
			showMessage('error', err?.message || '操作失败')
			throw err
		} finally {
			setPendingActions((prev) => {
				const next = { ...prev }
				delete next[pluginId]
				return next
			})
		}
	}, [fetchData, showMessage])

	const handleInstall = useCallback((pluginId) => {
		return withPendingAction(pluginId, 'install', () => installPlugin(pluginId), '插件安装成功')
	}, [withPendingAction])

	const handleUninstall = useCallback((pluginId) => {
		return withPendingAction(pluginId, 'uninstall', () => uninstallPlugin(pluginId), '插件已卸载')
	}, [withPendingAction])

	const handleEnableToggle = useCallback((pluginId, enable) => {
		const runner = enable ? () => enablePlugin(pluginId) : () => disablePlugin(pluginId)
		const message = enable ? '插件已启用' : '插件已禁用'
		return withPendingAction(pluginId, 'toggle', runner, message)
	}, [withPendingAction])

	const handleExecuteCommand = useCallback(async (pluginId, commandId) => {
		setCommandPending(commandId)
		try {
			const result = await executePluginCommand(pluginId, commandId)
			if (result?.success === false) {
				throw new Error(result.error || '命令执行失败')
			}
			showMessage('success', '命令已执行')
		} catch (err) {
			console.error('执行插件命令失败', err)
			showMessage('error', err?.message || '执行命令失败')
		} finally {
			setCommandPending(null)
		}
	}, [showMessage])

	const handleOpenPluginFolder = useCallback(async (pluginId) => {
		try {
			const result = await openPluginFolder(pluginId)
			if (result?.success === false) {
				throw new Error(result.error || '打开插件目录失败')
			}
		} catch (err) {
			console.error('打开插件目录失败', err)
			showMessage('error', err?.message || '打开插件目录失败')
		}
	}, [showMessage])

	const handleOpenPluginsDirectory = useCallback(async () => {
		try {
			const result = await openPluginsDirectory()
			if (result?.success === false) {
				throw new Error(result.error || '打开插件开发目录失败')
			}
		} catch (err) {
			console.error('打开插件开发目录失败', err)
			showMessage('error', err?.message || '打开插件开发目录失败')
		}
	}, [showMessage])

	const filteredAvailable = useMemo(() => {
		if (pluginStoreFilters.tab !== 'market') return []
		return filterPlugins(availablePlugins, pluginStoreFilters)
	}, [availablePlugins, pluginStoreFilters])

	const filteredInstalled = useMemo(() => {
		if (pluginStoreFilters.tab !== 'installed') return []
		return filterPlugins(installedPlugins, pluginStoreFilters)
	}, [installedPlugins, pluginStoreFilters])

	const filteredLocal = useMemo(() => {
		if (pluginStoreFilters.tab !== 'local') return []
		return filterPlugins(localPlugins, pluginStoreFilters)
	}, [localPlugins, pluginStoreFilters])

	const selectedPlugin = useMemo(() => {
		if (!pluginStoreSelectedPluginId) return null

		// 从可用列表查找（包含完整的市场信息，如 icon、description 等）
		const available = availablePlugins.find((plugin) => plugin.id === pluginStoreSelectedPluginId)

		// 从本地插件列表查找
		const local = localPlugins.find((plugin) => plugin.id === pluginStoreSelectedPluginId)

		// 从已安装列表查找（包含运行时状态）
		const installed = installedPlugins.find((plugin) => plugin.id === pluginStoreSelectedPluginId)

		// 如果都不存在，返回 null
		if (!available && !local && !installed) return null

		// 优先使用本地插件信息（本地开发模式）
		if (local) {
			return {
				...local,
				// 如果已安装，合并安装状态
				...(installed && {
					enabled: installed.enabled,
					installedVersion: installed.installedVersion,
					runtimeStatus: installed.runtimeStatus,
					lastError: installed.lastError
				})
			}
		}

		// 如果已安装，合并市场信息和安装状态
		if (installed && available) {
			return {
				...available,  // 保留市场信息（description、shortDescription 等）
				...installed,  // 覆盖运行时状态（enabled、installedVersion、runtimeStatus 等）
				// 确保关键字段正确 - 优先使用已加载的图标 (data URI)
				icon: installed.icon || available.icon,
				name: available.name || installed.manifest?.name,
				description: available.description || installed.manifest?.description,
				manifest: installed.manifest || available.manifest
			}
		}

		// 只在已安装列表中（不在市场列表，可能是本地插件）
		if (installed) {
			return {
				...installed,
				name: installed.manifest?.name || installed.id,
				description: installed.manifest?.description,
				installed: true
			}
		}

		// 只在市场列表中（未安装）
		return {
			...available,
			installed: false,
			enabled: false
		}
	}, [pluginStoreSelectedPluginId, installedPlugins, availablePlugins, localPlugins])

	const pendingActionFor = (pluginId) => pendingActions[pluginId] || null

	const handleSearchChange = (event) => {
		setPluginStoreSearch(event.target.value)
	}

	const handleSelectPlugin = (pluginId) => {
		setPluginStoreSelectedPluginId(pluginId)
	}

	const handleRefresh = () => {
		fetchData()
		if (pluginStoreFilters.tab === 'local') {
			loadLocalPlugins()
		}
		showMessage('info', '插件列表已刷新')
	}

	const renderEmptyState = (message) => (
		<Box sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
			<Typography variant="body1">{message}</Typography>
		</Box>
	)

	const renderLocalDev = () => (
		<Box>
			<Box sx={{ py: 3, px: 2, mb: 3, bgcolor: 'background.paper', borderRadius: 2 }}>
				<Typography variant="h6" sx={{ mb: 2 }}>
					本地开发模式
				</Typography>
				<Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
					系统会自动扫描以下位置的插件：
				</Typography>
				<List dense>
					<ListItem>
						<ListItemText
							primary="开发环境插件"
							secondary="plugins/examples 和 plugins/local 目录（用于开发和测试）"
						/>
					</ListItem>
					<ListItem>
						<ListItemText
							primary="用户安装插件"
							secondary="用户数据目录的插件文件夹（手动安装的插件）"
						/>
					</ListItem>
					<ListItem>
						<ListItemText
							primary="使用方法"
							secondary="创建插件目录，编写 manifest.json 和入口文件，然后点击刷新"
						/>
					</ListItem>
				</List>
				<Stack direction="row" spacing={2} sx={{ mt: 2 }}>
					<Button
						variant="outlined"
						onClick={() => handleRefresh()}
						startIcon={<RefreshRounded />}
					>
						刷新本地插件
					</Button>
					<Button
						variant="outlined"
						onClick={() => handleOpenPluginsDirectory()}
						startIcon={<FolderOpenRounded />}
					>
						打开插件目录
					</Button>
				</Stack>
			</Box>

			{/* 本地插件加载状态 */}
			{localLoading && <LinearProgress sx={{ mb: 2 }} />}

			{/* 显示本地开发插件列表 */}
			{filteredLocal.length === 0 && !localLoading && (
				<Box sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
					<Typography variant="body1">
						暂无本地开发插件，请创建插件或点击"刷新本地插件"
					</Typography>
					<Typography variant="body2" sx={{ mt: 1, color: 'text.disabled' }}>
						系统会自动扫描开发环境和用户数据目录的插件
					</Typography>
				</Box>
			)}

			{filteredLocal.length > 0 && (
				<Box
					sx={{
						display: 'grid',
						gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
						gap: 2,
						px: 1,
						py: 0.5
					}}
				>
					{filteredLocal.map((plugin) => {
						const status = getPluginStatus(plugin)
						return (
							<PluginCard
								key={plugin.id}
								plugin={plugin}
								isInstalled={status.isInstalled}
								isEnabled={status.isEnabled}
								hasUpdate={plugin.hasUpdate}
								pendingAction={pendingActionFor(plugin.id)}
								onInstall={handleInstall}
								onEnableToggle={handleEnableToggle}
								onUninstall={handleUninstall}
								onSelect={handleSelectPlugin}
								compact={false}
							/>
						)
					})}
				</Box>
			)}
		</Box>
	)

	// 辅助函数：获取插件的安装和启用状态
	const getPluginStatus = useCallback((plugin) => {
		const installedPlugin = installedPlugins.find(p => p.id === plugin.id)
		return {
			isInstalled: Boolean(plugin.installed || installedPlugin),
			isEnabled: installedPlugin?.enabled || false
		}
	}, [installedPlugins])

	const pluginsToRender = pluginStoreFilters.tab === 'market' ? filteredAvailable : filteredInstalled

	return (
		<Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
			<Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mb: 3, px: 1 }}>
				<TextField
					placeholder="搜索插件"
					size="small"
					value={pluginStoreFilters.search}
					onChange={handleSearchChange}
					fullWidth
					aria-label="搜索插件"
					InputProps={{
						startAdornment: (
							<InputAdornment position="start">
								<SearchIcon fontSize="small" />
							</InputAdornment>
						)
					}}
				/>
				<Tooltip title="刷新插件列表">
					<span>
						<IconButton color="primary" size="small" onClick={handleRefresh} disabled={loading}>
							<RefreshRounded />
						</IconButton>
					</span>
				</Tooltip>
			</Stack>

			{loading && <LinearProgress sx={{ mb: 2 }} />}
			{error && (
				<Alert severity="error" sx={{ mb: 2 }}>
					{error}
				</Alert>
			)}

			<Box sx={{ flex: 1, overflow: 'auto', pb: 4 }}>
				{pluginStoreFilters.tab === 'local' && renderLocalDev()}

				{pluginStoreFilters.tab !== 'local' && pluginsToRender.length === 0 && !loading &&
					renderEmptyState('暂无插件匹配当前筛选条件')}

				{pluginStoreFilters.tab !== 'local' && pluginsToRender.length > 0 && (
					<Box
						sx={{
							display: 'grid',
							gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
							gap: 2,
							px: 1,
							py: 0.5
						}}
					>
						{pluginsToRender.map((plugin) => {
							const status = getPluginStatus(plugin)
							return (
								<PluginCard
									key={plugin.id}
									plugin={plugin}
									isInstalled={status.isInstalled}
									isEnabled={status.isEnabled}
									hasUpdate={plugin.hasUpdate}
									pendingAction={pendingActionFor(plugin.id)}
									onInstall={handleInstall}
									onEnableToggle={handleEnableToggle}
									onUninstall={handleUninstall}
									onSelect={handleSelectPlugin}
									compact={false}
								/>
							)
						})}
					</Box>
				)}
			</Box>

			<PluginDetailDrawer
				plugin={selectedPlugin}
				open={Boolean(selectedPlugin)}
				onClose={() => setPluginStoreSelectedPluginId(null)}
				onInstall={handleInstall}
				onEnableToggle={handleEnableToggle}
				onUninstall={handleUninstall}
				pendingAction={selectedPlugin ? pendingActionFor(selectedPlugin.id) : null}
				onExecuteCommand={handleExecuteCommand}
				commandPending={commandPending}
				onOpenFolder={handleOpenPluginFolder}
			/>

			<Snackbar
				open={snackbar.open}
				autoHideDuration={3000}
				onClose={closeSnackbar}
				anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
			>
				<Alert onClose={closeSnackbar} severity={snackbar.severity} sx={{ width: '100%' }}>
					{snackbar.message}
				</Alert>
			</Snackbar>
		</Box>
	)
}

export default PluginStore
