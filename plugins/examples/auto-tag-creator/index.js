/**
 * 自动标签创建器插件
 * 
 * 功能：
 * 1. AI 智能标签建议
 * 2. 分析笔记内容，提取关键词并自动创建标签
 * 3. 批量创建预定义标签集
 */

const {
  onActivate,
  registerCommand,
  notes,
  tags,
  ai,
  notifications,
  logger
} = require('@flota/sdk')

// 预定义标签配置
const PREDEFINED_TAGS = [
  { name: '工作', color: '#1976d2' },
  { name: '学习', color: '#2e7d32' },
  { name: '生活', color: '#ed6c02' },
  { name: '项目', color: '#9c27b0' },
  { name: '会议', color: '#d32f2f' },
  { name: '想法', color: '#0288d1' },
  { name: '待办', color: '#f57c00' },
  { name: '重要', color: '#c62828' }
]

// 关键词到标签的映射
const KEYWORD_TAG_MAP = {
  '工作': ['工作', '项目', '会议'],
  '学习': ['学习', '笔记', '课程', '教程'],
  '会议': ['会议', '讨论', '沟通'],
  '项目': ['项目', '开发', '设计'],
  '重要': ['重要', '紧急', '优先']
}

onActivate(() => {
  logger.info('[自动标签创建器] 插件已激活')

  // 命令1: AI 智能标签建议（新功能）
  registerCommand(
    {
      id: 'auto-tag-creator.ai-suggest',
      title: 'AI 智能标签建议'
    },
    async (payload) => {
      try {
        logger.info('[自动标签创建器] AI 标签建议，收到 payload:', payload)

        // 检查 AI 是否可用
        const aiAvailable = await ai.isAvailable()
        if (!aiAvailable) {
          await notifications.show({
            title: 'AI 不可用',
            body: '请先配置 AI 服务',
            type: 'warning'
          })
          return { success: false, error: 'AI 不可用' }
        }

        // 从 payload 获取笔记内容和ID
        const { noteTitle, noteContent, noteId } = payload || {}
        
        logger.info('[自动标签创建器] 解析参数:', { noteTitle, noteContent: noteContent?.substring(0, 50), noteId })

        if (!noteTitle && !noteContent) {
          await notifications.show({
            title: '提示',
            body: '请提供笔记内容',
            type: 'info'
          })
          return { success: false, error: '无笔记内容' }
        }

        // 使用 AI 分析笔记内容并生成标签和分类
        const response = await ai.chat([
          {
            role: 'system',
            content: '你是一个标签和分类生成助手。根据笔记内容生成最多3个简短的中文标签，以及1个分类。只返回JSON格式：{"tags": ["标签1", "标签2", "标签3"], "category": "分类名称"}'
          },
          {
            role: 'user',
            content: `请为以下笔记生成标签和分类：\n\n标题：${noteTitle || '无标题'}\n\n内容：${noteContent || ''}`
          }
        ], {
          temperature: 0.7,
          maxTokens: 200
        })

        logger.info('[AI 完整响应]', response)

        // AI 返回格式：{ success: true, data: { content: '...', usage: {...} } }
        if (!response.success || !response.data) {
          await notifications.show({
            title: 'AI 调用失败',
            body: response.error || '未知错误',
            type: 'error'
          })
          return { success: false, error: response.error || 'AI 调用失败' }
        }

        const aiContent = response.data.content
        logger.info('[AI 内容]', aiContent)

        // 解析 AI 返回的标签和分类
        let suggestedTags = []
        let suggestedCategory = ''
        try {
          // 尝试直接解析 JSON
          const parsed = JSON.parse(aiContent)
          suggestedTags = parsed.tags || []
          suggestedCategory = parsed.category || ''
        } catch (e) {
          // 如果不是纯 JSON，尝试提取 JSON 对象
          const match = aiContent.match(/\{.*?\}/s)
          if (match) {
            const parsed = JSON.parse(match[0])
            suggestedTags = parsed.tags || []
            suggestedCategory = parsed.category || ''
          } else {
            // 降级：按逗号分割标签
            suggestedTags = aiContent
              .split(/[,，、]/)
              .map(t => t.trim().replace(/["'\[\]]/g, ''))
              .filter(t => t.length > 0 && t.length < 20)
              .slice(0, 3)
          }
        }

        // 限制最多3个标签
        suggestedTags = suggestedTags.slice(0, 3)

        if (suggestedTags.length === 0 && !suggestedCategory) {
          await notifications.show({
            title: 'AI 分析失败',
            body: '未能生成标签和分类建议',
            type: 'warning'
          })
          return { success: false, tags: [], category: '' }
        }

        // 获取现有标签
        const existingTags = await tags.list()
        const existingTagNames = new Set(existingTags.map(t => t.name))

        // 为新标签创建（如果不存在）
        const newTagsCreated = []

        for (const tagName of suggestedTags) {
          if (!existingTagNames.has(tagName)) {
            await tags.create(tagName)  // 注意：不支持颜色参数
            newTagsCreated.push(tagName)
            logger.info(`创建新标签: ${tagName}`)
          }
        }

        // 如果提供了笔记ID，自动应用标签和分类到笔记
        let noteUpdated = false
        if (noteId) {
          try {
            logger.info('[自动标签创建器] 准备更新笔记:', { noteId, suggestedTags, suggestedCategory })
            
            const updateData = {}
            
            // 添加标签
            if (suggestedTags.length > 0) {
              updateData.tags = suggestedTags.join(',')
            }
            
            // 添加分类
            if (suggestedCategory) {
              updateData.category = suggestedCategory
            }
            
            if (Object.keys(updateData).length > 0) {
              logger.info('[自动标签创建器] 调用 notes.update:', { id: noteId, data: updateData })
              
              const updateResult = await notes.update(noteId, updateData)
              
              logger.info('[自动标签创建器] 更新结果:', updateResult)
              
              noteUpdated = updateResult?.success !== false
              
              if (noteUpdated) {
                logger.info(`已自动应用标签和分类到笔记 ${noteId}`)
              } else {
                logger.warn(`更新笔记失败:`, updateResult)
              }
            }
          } catch (error) {
            logger.error('自动应用标签和分类失败:', error)
            // 继续执行，即使应用失败也要显示通知
          }
        } else {
          logger.warn('[自动标签创建器] 未提供 noteId，无法自动应用')
        }

        const categoryInfo = suggestedCategory ? `\n分类：${suggestedCategory}` : ''
        const appliedInfo = noteUpdated ? '\n✓ 已自动应用到笔记' : (noteId ? '\n⚠ 应用失败' : '')
        await notifications.show({
          title: 'AI 标签建议完成',
          body: `建议标签：${suggestedTags.join(', ')}${categoryInfo}\n新创建：${newTagsCreated.length} 个${appliedInfo}`,
          type: 'success'
        })

        return {
          success: true,
          suggestedTags,
          suggestedCategory,
          newTagsCreated,
          allTags: suggestedTags,
          applied: noteUpdated
        }

      } catch (error) {
        logger.error('[自动标签创建器] AI 建议失败', error)
        await notifications.show({
          title: 'AI 建议失败',
          body: error.message,
          type: 'error'
        })
        return { success: false, error: error.message }
      }
    }
  )

  // 命令2: 分析笔记并创建标签
  registerCommand(
    {
      id: 'auto-tag-creator.analyze',
      title: '分析笔记并创建标签'
    },
    async (payload) => {
      try {
        logger.info('[自动标签创建器] 分析笔记')

        const { noteId } = payload || {}
        if (!noteId) {
          return { success: false, error: '缺少笔记ID' }
        }

        // 获取笔记内容
        const notesList = await notes.list({ noteIds: [noteId] })
        if (!notesList || !notesList.notes || notesList.notes.length === 0) {
          return { success: false, error: '笔记不存在' }
        }

        const note = notesList.notes[0]
        const text = `${note.title || ''} ${note.content || ''}`

        // 提取关键词并映射到标签
        const extractedTags = new Set()
        for (const [keyword, tagList] of Object.entries(KEYWORD_TAG_MAP)) {
          if (text.includes(keyword)) {
            tagList.forEach(tag => extractedTags.add(tag))
          }
        }

        if (extractedTags.size === 0) {
          await notifications.show({
            title: '未找到匹配标签',
            body: '笔记内容中没有匹配的关键词',
            type: 'info'
          })
          return { success: true, tags: [] }
        }

        // 获取现有标签
        const existingTags = await tags.list()
        const existingTagNames = new Set(existingTags.map(t => t.name))

        // 创建不存在的标签
        const createdTags = []
        for (const tagName of extractedTags) {
          if (!existingTagNames.has(tagName)) {
            await tags.create(tagName)
            createdTags.push(tagName)
          }
        }

        await notifications.show({
          title: '标签创建完成',
          body: `创建了 ${createdTags.length} 个新标签`,
          type: 'success'
        })

        return {
          success: true,
          extractedTags: Array.from(extractedTags),
          createdTags
        }

      } catch (error) {
        logger.error('[自动标签创建器] 分析失败', error)
        return { success: false, error: error.message }
      }
    }
  )

  // 命令3: 创建预定义标签集
  registerCommand(
    {
      id: 'auto-tag-creator.create-predefined',
      title: '创建预定义标签集'
    },
    async () => {
      try {
        logger.info('[自动标签创建器] 创建预定义标签集')

        // 获取现有标签
        const existingTags = await tags.list()
        const existingTagNames = new Set(existingTags.map(t => t.name))

        // 创建不存在的预定义标签
        const createdTags = []
        for (const tag of PREDEFINED_TAGS) {
          if (!existingTagNames.has(tag.name)) {
            await tags.create(tag.name)
            createdTags.push(tag.name)
          }
        }

        await notifications.show({
          title: '标签创建完成',
          body: `创建了 ${createdTags.length} 个预定义标签`,
          type: 'success'
        })

        return {
          success: true,
          createdTags,
          skippedCount: PREDEFINED_TAGS.length - createdTags.length
        }

      } catch (error) {
        logger.error('[自动标签创建器] 创建预定义标签失败', error)
        await notifications.show({
          title: '创建失败',
          body: error.message,
          type: 'error'
        })
        return { success: false, error: error.message }
      }
    }
  )
})
