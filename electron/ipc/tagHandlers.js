const { registerIpcHandlers, createServicePassthroughHandler } = require('./helpers')

const TAG_PASSTHROUGH = {
  'tag:get-all': 'getAllTags',
  'tag:search': 'searchTags',
  'tag:get-suggestions': 'getTagSuggestions',
  'tag:get-stats': 'getTagStats',
  'tag:delete': 'deleteTag',
  'tag:cleanup': 'cleanupUnusedTags',
  'tag:recalculate-usage': 'recalculateTagUsage'
}

const registerTagHandlers = (services) => {
  registerIpcHandlers([
    ...Object.entries(TAG_PASSTHROUGH).map(([channel, methodName]) => ({
      channel,
      handler: createServicePassthroughHandler(() => services.tagService, methodName)
    })),
    {
      channel: 'tag:get-popular',
      handler: async (event, limit) =>
        services.tagService.getAllTags({ limit, orderBy: 'usage_count', order: 'DESC' })
    },
    {
      channel: 'tags:getPopular',
      handler: async (event, limit) => services.tagService.getPopularTags(limit)
    },
    {
      channel: 'tag:batch-delete',
      handler: async (event, tagNames) => {
        const results = []
        for (const tagName of tagNames) {
          results.push(await services.tagService.deleteTag(tagName))
        }
        return { success: true, data: results }
      }
    }
  ])
}

module.exports = { registerTagHandlers }
