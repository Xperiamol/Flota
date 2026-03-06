import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
	Box,
	Typography,
	Stack,
	TextField,
	InputAdornment,
	IconButton,
	Tooltip,
	Card,
	CardContent,
	CardActions,
	Button,
	Chip,
	Divider,
	LinearProgress,
	Snackbar,
	Alert,
	Drawer,
	List,
	ListItem,
	ListItemText,
	Avatar
} from '@mui/material'
import {
	Search as SearchIcon,
	RefreshRounded,
	CloudDownloadRounded,
	DeleteRounded,
	PowerSettingsNewRounded,
	RocketLaunchRounded,
	CheckCircleOutline,
	ErrorOutline,
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

const getDisplayCategories = (plugin) => {
	if (!plugin) return []
	const categories = plugin.categories || []
	if (Array.isArray(categories)) return categories
	return typeof categories === 'string' ? [categories] : []
}

const formatPermissions = (permissions) => {
	if (!permissions) return []
	if (Array.isArray(permissions)) return permissions
	return Object.entries(permissions)
		.filter(([, value]) => Boolean(value))
		.map(([key]) => key)
}

const defaultPluginIcon = (name = '') => {
	const initials = name.trim().slice(0, 2).toUpperCase() || 'P'
	return (
		<Avatar 
			variant="circular"
			sx={{ 
				bgcolor: 'primary.main', 
				color: 'primary.contrastText',
				borderRadius: '50%'
			}}
		>
			{initials}
		</Avatar>
	)
}

const filterPlugins = (plugins, { search, category }) => {
	if (!Array.isArray(plugins) || plugins.length === 0) return []

	return plugins.filter((plugin) => {
		const matchesCategory =
			!category || category === 'all' || getDisplayCategories(plugin).some((item) => item === category)

		if (!matchesCategory) return false

		if (!search) return true

		const keywords = `${plugin.name || ''} ${plugin.description || ''} ${plugin.author?.name || ''}`.toLowerCase()
		return keywords.includes(search.toLowerCase())
	})
}

const PluginCard = ({
	plugin,
	isInstalled,
	isEnabled,
	hasUpdate,
	pendingAction,
	onInstall,
	onEnableToggle,
	onUninstall,
	onSelect,
	compact
}) => {
	if (!plugin) return null

	const categories = getDisplayCategories(plugin)
	// 统一描述字段优先级：shortDescription > description > manifest.description
	const description = plugin.shortDescription || plugin.description || plugin.manifest?.description || '暂未提供描述'

	return (
		<Card
			variant="outlined"
			sx={(muiTheme) => ({
				position: 'relative',
				height: '100%',
				display: 'flex',
				flexDirection: 'column',
				backgroundColor: muiTheme.palette.mode === 'dark'
					? 'rgba(30, 41, 59, 0.85)'
					: 'rgba(255, 255, 255, 0.85)',
				backdropFilter: 'blur(12px) saturate(150%)',
				WebkitBackdropFilter: 'blur(12px) saturate(150%)',
				transition: 'border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease',
				'&:hover': {
					borderColor: 'primary.main',
					boxShadow: muiTheme.palette.mode === 'dark'
						? '0 8px 32px rgba(0, 0, 0, 0.3)'
						: '0 8px 32px rgba(0, 0, 0, 0.1)',
					transform: 'translateY(-2px)',
					cursor: 'pointer'
				}
			})}
			onClick={() => onSelect(plugin.id)}
		>
			{/* 状态标签 - 右上角定位 */}
			<Box sx={{ position: 'absolute', top: 12, right: 12, zIndex: 1 }}>
				{isInstalled ? (
					<Chip
						size="small"
						color={isEnabled ? 'success' : 'default'}
						icon={isEnabled ? <CheckCircleOutline fontSize="small" /> : <PowerSettingsNewRounded fontSize="small" />}
						label={isEnabled ? '已启用' : '已禁用'}
						sx={{ 
							fontWeight: 500,
							'& .MuiChip-icon': { fontSize: '0.9rem' }
						}}
					/>
				) : (
					<Chip 
						size="small" 
						color="primary" 
						variant="outlined" 
						label="未安装"
						sx={{ fontWeight: 500 }}
					/>
				)}
			</Box>

			<CardContent sx={{ pb: 1.5, flex: 1, display: 'flex', flexDirection: 'column', pt: 2 }}>
				{/* 头部：图标和基本信息 */}
				<Stack direction="row" spacing={2} alignItems="flex-start" sx={{ mb: 2 }}>
					{plugin.icon ? (
						<Avatar 
							variant="circular"
							src={plugin.icon} 
							alt={plugin.name} 
							sx={{ 
								width: 52, 
								height: 52,
								boxShadow: 1,
								flexShrink: 0,
								borderRadius: '50%'
							}} 
						/>
					) : (
						<Avatar 
							variant="circular"
							sx={{ 
								bgcolor: 'primary.main', 
								color: 'primary.contrastText',
								width: 52,
								height: 52,
								fontSize: '1.25rem',
								fontWeight: 600,
								boxShadow: 1,
								flexShrink: 0,
								borderRadius: '50%'
							}}
						>
							{(plugin.name || '').trim().slice(0, 2).toUpperCase() || 'P'}
						</Avatar>
					)}
					<Box sx={{ flexGrow: 1, minWidth: 0, pr: 8 }}>
						<Typography 
							variant="h6" 
							component="div" 
							sx={{ 
								lineHeight: 1.3,
								fontWeight: 600,
								overflow: 'hidden',
								textOverflow: 'ellipsis',
								whiteSpace: 'nowrap'
							}}
						>
							{plugin.manifest?.name || plugin.name || '未知插件'}
						</Typography>
						<Stack 
							direction="row" 
							spacing={0.75} 
							alignItems="center" 
							sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}
						>
							<Typography 
								variant="caption" 
								sx={{ 
									color: 'text.secondary',
									fontWeight: 500,
									backgroundColor: (theme) => theme.palette.mode === 'dark' 
										? 'rgba(255,255,255,0.08)' 
										: 'rgba(0,0,0,0.04)',
									px: 0.75,
									py: 0.25,
									borderRadius: 0.5
								}}
							>
								v{plugin.manifest?.version || plugin.version || '0.0.0'}
							</Typography>
							{plugin.author?.name && (
								<Typography 
									variant="caption" 
									sx={{ color: 'text.secondary' }}
								>
									by {plugin.author.name}
								</Typography>
							)}
						</Stack>
					</Box>
				</Stack>

				{/* 描述区域 */}
				<Typography 
					variant="body2" 
					color="text.secondary" 
					sx={{ 
						minHeight: compact ? 'auto' : 54,
						overflow: 'hidden',
						display: '-webkit-box',
						WebkitLineClamp: compact ? 2 : 3,
						WebkitBoxOrient: 'vertical',
						textOverflow: 'ellipsis',
						lineHeight: 1.5,
						mb: 1.5
					}}
				>
					{description}
				</Typography>

				{/* 标签区域 */}
				<Box sx={{ mt: 'auto' }}>
					<Stack 
						direction="row" 
						sx={{ 
							flexWrap: 'wrap', 
							gap: 0.5,
							'& .MuiChip-root': {
								height: 22,
								fontSize: '0.7rem'
							}
						}}
					>
						{plugin.sourceType && (
							<Chip
								size="small"
								label={plugin.sourceType === 'development' ?
									(plugin.sourceLabel === 'examples' ? '📦 示例' : '💻 本地') :
									'☁️ 云端'
								}
								color={plugin.sourceType === 'development' ? 'secondary' : 'default'}
								variant="filled"
								sx={{ 
									fontWeight: 500,
									opacity: 0.9
								}}
							/>
						)}
						{categories.slice(0, 2).map((category) => (
							<Chip 
								key={category} 
								size="small" 
								label={category} 
								variant="outlined"
								sx={{ opacity: 0.8 }}
							/>
						))}
						{categories.length > 2 && (
							<Chip 
								size="small" 
								label={`+${categories.length - 2}`} 
								variant="outlined"
								sx={{ opacity: 0.6 }}
							/>
						)}
						{hasUpdate && (
							<Chip 
								size="small" 
								color="warning" 
								label="🔄 可更新"
								sx={{ fontWeight: 500 }}
							/>
						)}
					</Stack>
				</Box>
			</CardContent>

			{/* 操作区域 */}
			<Box 
				sx={(muiTheme) => ({ 
					px: 2, 
					py: 1.5,
					borderTop: `1px solid ${muiTheme.palette.divider}`,
					backgroundColor: muiTheme.palette.mode === 'dark'
						? 'rgba(0, 0, 0, 0.1)'
						: 'rgba(0, 0, 0, 0.02)',
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'center'
				})}
			>
				<Button
					size="small"
					color="primary"
					startIcon={<RocketLaunchRounded fontSize="small" />}
					onClick={(event) => {
						event.stopPropagation()
						onSelect(plugin.id)
					}}
					sx={{ 
						textTransform: 'none',
						fontWeight: 500
					}}
				>
					查看详情
				</Button>

				<Stack direction="row" spacing={0.75} alignItems="center">
					{!isInstalled && (
						<Button
							size="small"
							variant="contained"
							startIcon={<CloudDownloadRounded fontSize="small" />}
							disabled={Boolean(pendingAction)}
							onClick={(event) => {
								event.stopPropagation()
								onInstall(plugin.id)
							}}
							sx={{ 
								textTransform: 'none',
								fontWeight: 500,
								boxShadow: 1
							}}
						>
							安装
						</Button>
					)}

					{isInstalled && (
						<>
							<Button
								size="small"
								variant={isEnabled ? 'outlined' : 'contained'}
								color={isEnabled ? 'warning' : 'success'}
								disabled={Boolean(pendingAction)}
								startIcon={<PowerSettingsNewRounded fontSize="small" />}
								onClick={(event) => {
									event.stopPropagation()
									onEnableToggle(plugin.id, !isEnabled)
								}}
								sx={{ 
									textTransform: 'none',
									fontWeight: 500,
									minWidth: 72
								}}
							>
								{isEnabled ? '禁用' : '启用'}
							</Button>
							<Tooltip title="卸载插件">
								<IconButton
									size="small"
									color="error"
									disabled={Boolean(pendingAction)}
									onClick={(event) => {
										event.stopPropagation()
										onUninstall(plugin.id)
									}}
									sx={{
										'&:hover': {
											backgroundColor: 'error.main',
											color: 'error.contrastText'
										}
									}}
								>
									<DeleteRounded fontSize="small" />
								</IconButton>
							</Tooltip>
						</>
					)}
				</Stack>
			</Box>

			{pendingAction && (
				<LinearProgress 
					sx={{ 
						position: 'absolute', 
						bottom: 0, 
						left: 0, 
						right: 0,
						borderRadius: '0 0 8px 8px'
					}} 
				/>
			)}
		</Card>
	)
}

const permissionDescriptions = {
	// 笔记和待办
	'notes:read': '读取你的笔记列表与基础元数据（标题、标签、时间等）',
	'notes:read:full': '读取笔记的完整内容，包括正文、收藏状态等所有信息',
	'notes:write': '创建或更新笔记内容',
	'todos:read': '读取待办事项列表与基础信息（标题、完成状态、优先级等）',
	'todos:read:full': '读取待办事项的完整信息，包括描述、截止时间、提醒等',
	'todos:write': '创建或更新待办事项',
	// 标签
	'tags:read': '读取标签列表和标签统计信息',
	'tags:write': '创建、更新或删除标签',
	// UI和通知
	'ui:open-note': '请求宿主应用打开指定笔记',
	'ui:theme': '读取或修改应用主题，注入自定义样式',
	'notifications:show': '通过宿主通知中心展示提示',
	// 存储和设置
	'settings:read': '读取基础设置用于适配展示',
	'storage:read': '访问插件私有存储中的数据',
	'storage:write': '写入或删除插件私有存储数据',
	// 网络和文件系统
	'network:request': '发起网络请求，访问互联网资源',
	'filesystem:read': '通过对话框选择并读取文件内容',
	'filesystem:write': '通过对话框选择位置并写入文件',
	// 剪贴板
	'clipboard:read': '读取系统剪贴板中的文本或图片',
	'clipboard:write': '写入文本或图片到系统剪贴板',
	// 搜索和附件
	'search:advanced': '使用高级搜索功能（全文搜索、过滤等）',
	'attachments:read': '读取笔记的附件列表和附件信息',
	'attachments:write': '上传或删除笔记附件',
	// 事件和调度
	'events:subscribe': '订阅应用事件（笔记创建、待办完成等）',
	'scheduler:create': '创建和管理定时任务',
	// 分析和扩展
	'analytics:read': '读取笔记和待办的统计分析数据',
	'markdown:extend': '扩展 Markdown 语法，注册自定义渲染器',
	'ai:inference': '调用 AI 服务进行推理（需用户配置 AI）'
}

const PluginDetailDrawer = ({
	plugin,
	open,
	onClose,
	onInstall,
	onEnableToggle,
	onUninstall,
	pendingAction,
	onExecuteCommand,
	commandPending,
	onOpenFolder
}) => {
	if (!plugin) return null

	const permissions = formatPermissions(plugin.permissions)
	const categories = getDisplayCategories(plugin)
	const commands = Array.isArray(plugin.commands) ? plugin.commands : []

	return (
		<Drawer anchor="right" open={open} onClose={onClose} sx={{ '& .MuiDrawer-paper': { width: 400, p: 3 } }}>
			<Stack spacing={2}>
				<Stack direction="row" spacing={2} alignItems="center">
					{plugin.icon ? (
						<Avatar 
							variant="circular"
							src={plugin.icon} 
							alt={plugin.name} 
							sx={{ width: 56, height: 56, borderRadius: '50%' }} 
						/>
					) : (
						defaultPluginIcon(plugin.name)
					)}
					<Box>
						<Typography variant="h5" sx={{ lineHeight: 1.2 }}>
							{plugin.manifest?.name || plugin.name || '未知插件'}
						</Typography>
						<Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
							<Chip size="small" label={`版本 ${plugin.manifest?.version || plugin.version || '未知'}`} />
							{plugin.manifest?.minAppVersion && (
								<Chip size="small" variant="outlined" label={`最低版本 ${plugin.manifest.minAppVersion}`} />
							)}
						</Stack>
					</Box>
				</Stack>

				<Typography variant="body1" color="text.secondary">
					{plugin.shortDescription || plugin.description || plugin.manifest?.description || '暂无详细描述'}
				</Typography>

				<Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
					{categories.map((category) => (
						<Chip key={category} label={category} variant="outlined" />
					))}
				</Stack>

				<Divider />

				<Stack direction="row" spacing={1}>
					<Button
						variant="contained"
						startIcon={<CloudDownloadRounded />}
						disabled={pendingAction === 'install'}
						onClick={() => onInstall(plugin.id)}
					>
						{plugin.installed ? '重新安装' : '安装插件'}
					</Button>
					<Button
						variant={plugin.enabled ? 'outlined' : 'contained'}
						color={plugin.enabled ? 'warning' : 'primary'}
						startIcon={<PowerSettingsNewRounded />}
						disabled={pendingAction === 'toggle'}
						onClick={() => onEnableToggle(plugin.id, !plugin.enabled)}
					>
						{plugin.enabled ? '禁用' : '启用'}
					</Button>
					{plugin.installed && (
						<>
							<Tooltip title="打开插件位置">
								<IconButton
									color="primary"
									onClick={() => onOpenFolder(plugin.id)}
								>
									<FolderOpenRounded />
								</IconButton>
							</Tooltip>
							<Button
								color="error"
								variant="text"
								startIcon={<DeleteRounded />}
								disabled={pendingAction === 'uninstall'}
								onClick={() => onUninstall(plugin.id)}
							>
								卸载
							</Button>
						</>
					)}
				</Stack>

				{permissions.length > 0 && (
					<Box>
						<Typography variant="subtitle1" sx={{ mb: 1 }}>
							权限需求
						</Typography>
						<List dense>
							{permissions.map((permission) => (
								<ListItem key={permission} disableGutters>
									<ListItemText
										primary={permission}
										primaryTypographyProps={{ variant: 'body2' }}
										secondary={permissionDescriptions[permission] || '自定义权限'}
									/>
								</ListItem>
							))}
						</List>
					</Box>
				)}

				{commands.length > 0 && (
					<Box>
						<Typography variant="subtitle1" sx={{ mb: 1 }}>
							可用命令
						</Typography>
						<Stack spacing={1}>
							{commands.map((command) => (
								<Card key={command.id} variant="outlined">
									<CardContent sx={{ pb: 1 }}>
										<Typography variant="subtitle2">{command.title || command.id}</Typography>
										{command.description && (
											<Typography variant="body2" color="text.secondary">
												{command.description}
											</Typography>
										)}
									</CardContent>
									<CardActions sx={{ justifyContent: 'flex-end', pt: 0 }}>
										<Button
											size="small"
											variant="contained"
											startIcon={<RocketLaunchRounded />}
											disabled={commandPending === command.id}
											onClick={() => onExecuteCommand(plugin.id, command.id)}
										>
											运行
										</Button>
									</CardActions>
								</Card>
							))}
						</Stack>
					</Box>
				)}

				{plugin.lastError && (
					<Alert severity="error" icon={<ErrorOutline />}>
						{plugin.lastError}
					</Alert>
				)}
			</Stack>
		</Drawer>
	)
}

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
