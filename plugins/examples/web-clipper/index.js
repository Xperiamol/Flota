// 网页剪藏插件：接收浏览器扩展经本地接收通道（/v1/clip）发来的内容，交给核心剪藏服务保存为笔记。
// 解析、图片本地化、去重、AI 摘要由宿主 ClipService 完成，插件只负责校验与编排。

const { onActivate, registerCommand, clips, notifications, logger } = require('@flota/sdk')

const KINDS = new Set(['article', 'selection', 'bookmark'])

const pickOptions = (options = {}) => ({
	aiSummary: typeof options.aiSummary === 'boolean' ? options.aiSummary : undefined,
	aiTags: typeof options.aiTags === 'boolean' ? options.aiTags : undefined,
	createTodo: Boolean(options.createTodo),
	allowDuplicate: Boolean(options.allowDuplicate)
})

onActivate(() => {
	registerCommand(
		{ id: 'web-clipper.receive', title: '接收网页剪藏', hidden: true },
		async ({ payload, context } = {}) => {
			const clip = payload?.clip || {}
			if (!clip.url || typeof clip.url !== 'string') return { error: '缺少网页链接' }
			if (clip.kind && !KINDS.has(clip.kind)) return { error: `不支持的剪藏类型：${clip.kind}` }
			try {
				const result = clip.fetch
					? await clips.clipUrl(clip.url, { ...pickOptions(payload?.options), kind: clip.kind, target: clip.target, source: `extension:${context?.client?.name || ''}` })
					: await clips.save(clip, { ...pickOptions(payload?.options), source: `extension:${context?.client?.name || ''}` })
				if (!result?.duplicate) {
					await notifications.show({ title: '已剪藏到 Flota', body: result?.title || clip.title || clip.url })
				}
				return result
			} catch (error) {
				logger.error('剪藏失败', error)
				return { error: error.message || '剪藏失败' }
			}
		}
	)
	logger.info('[网页剪藏] 插件已激活')
})
