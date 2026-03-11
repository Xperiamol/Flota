// 插件入口文件
// 插件运行时会在隔离的 Worker 线程中加载此文件
// 你可以通过 `@flota/sdk` 获取到受限的 API

const {
	onActivate,
	registerCommand,
	notes,
	ui,
	logger
} = require('@flota/sdk')

onActivate(() => {
	logger.info('[Random Note] 插件已激活')

	registerCommand(
		{
			id: 'random-note.open',
			title: '随机打开一篇笔记',
			description: '快速打开一篇随机笔记以唤醒旧灵感',
			surfaces: ['toolbar:notes'],
			icon: 'shuffle',
			shortcut: {
				default: 'Ctrl+Alt+R',
				description: '在任意界面抽取一篇随机笔记'
			}
		},
		async () => {
			try {
				const note = await notes.getRandom()
				if (!note) {
					logger.warn('当前没有可用的笔记，随机笔记命令已跳过')
					return { status: 'empty' }
				}

				await ui.openNote(note.id)
				logger.info(`已打开随机笔记: ${note.title || note.id}`)
				return { status: 'opened', noteId: note.id }
			} catch (error) {
				logger.error('随机笔记命令执行失败', error)
				return { status: 'error', error: error.message }
			}
		}
	)
})
