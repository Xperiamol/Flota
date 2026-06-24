const { registerIpcHandlers, createServicePassthroughHandler } = require('./helpers')

const CONVERSATION_PASSTHROUGH = {
  'conversation:get-all': 'getAllConversations',
  'conversation:save': 'saveConversation',
  'conversation:delete': 'deleteConversation',
  'conversation:delete-many': 'deleteConversations'
}

const registerConversationHandlers = (services) => {
  registerIpcHandlers(
    Object.entries(CONVERSATION_PASSTHROUGH).map(([channel, methodName]) => ({
      channel,
      handler: createServicePassthroughHandler(() => services.conversationService, methodName)
    }))
  )
}

module.exports = { registerConversationHandlers }
