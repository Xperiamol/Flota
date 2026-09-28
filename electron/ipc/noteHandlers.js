const { registerIpcHandlers, createServicePassthroughHandler } = require('./helpers')

const NOTE_PASSTHROUGH = {
  'note:create': 'createNote',
  'note:get-by-id': 'getNoteById',
  'note:get-all': 'getNotes',
  'note:get-pinned': 'getPinnedNotes',
  'note:get-deleted': 'getDeletedNotes',
  'note:get-recently-modified': 'getRecentlyModifiedNotes',
  'note:update': 'updateNote',
  'note:delete': 'deleteNote',
  'note:restore': 'restoreNote',
  'note:permanent-delete': 'permanentDeleteNote',
  'note:toggle-pin': 'togglePinNote',
  'note:search': 'searchNotes',
  'note:batch-update': 'batchUpdateNotes',
  'note:batch-delete': 'batchDeleteNotes',
  'note:batch-restore': 'batchRestoreNotes',
  'note:batch-permanent-delete': 'batchPermanentDeleteNotes',
  'note:empty-trash': 'emptyTrash',
  'note:batch-set-tags': 'batchSetTags',
  'note:get-stats': 'getStats',
  'note:get-activity-heatmap': 'getActivityHeatmap',
  'note:get-activity-range': 'getActivityRange',
  'note:export': 'exportNotes',
  'note:import': 'importNotes'
}

const registerNoteHandlers = (services) => {
  registerIpcHandlers([
    ...Object.entries(NOTE_PASSTHROUGH).map(([channel, methodName]) => ({
      channel,
      handler: createServicePassthroughHandler(() => services.noteService, methodName)
    })),
    {
      channel: 'note:get-trash-policy',
      handler: async () => {
        try {
          return { success: true, data: services.trashRetention.getPolicy() }
        } catch (error) {
          return { success: false, error: error.message }
        }
      }
    },
    {
      channel: 'note:set-trash-retention',
      handler: async (event, days) => {
        try {
          const result = await services.trashRetention.setDays(days)
          return { success: true, data: { policy: result.policy, purged: result.purged } }
        } catch (error) {
          return { success: false, error: error.message }
        }
      }
    },
    {
      channel: 'note:auto-save',
      handler: async (event, id, content) =>
        services.noteService.autoSaveNote(id, { content })
    }
  ])
}

module.exports = { registerNoteHandlers }
