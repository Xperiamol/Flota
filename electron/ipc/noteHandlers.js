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
  'note:batch-set-tags': 'batchSetTags',
  'note:get-stats': 'getStats',
  'note:get-activity-heatmap': 'getActivityHeatmap',
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
      channel: 'note:auto-save',
      handler: async (event, id, content) =>
        services.noteService.autoSaveNote(id, { content })
    }
  ])
}

module.exports = { registerNoteHandlers }
