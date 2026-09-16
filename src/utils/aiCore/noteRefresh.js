export const getEditedNoteIds = (action) => {
  if (!action || typeof action !== 'object') return []
  if (action.name === 'edit_note' && action.args?.id != null) return [String(action.args.id)]
  if (action.name === 'edit_notes' && Array.isArray(action.args?.edits)) {
    return action.args.edits
      .map((edit) => edit?.id)
      .filter((id) => id != null)
      .map(String)
  }
  return []
}

export const notifyAINoteIdsUpdated = (ids) => {
  const noteIds = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => id != null).map(String))]
  if (noteIds.length === 0 || typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('ai-notes-updated', { detail: { noteIds } }))
}

export const notifyAINotesUpdated = (action) => notifyAINoteIdsUpdated(getEditedNoteIds(action))
