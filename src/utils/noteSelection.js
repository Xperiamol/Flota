export function selectionAfterRemoval(notes, selectedId, removedIds, preferredId) {
  const removed = new Set(removedIds.map(String))
  if (!removed.has(String(selectedId))) return selectedId
  if (preferredId === null || (preferredId !== undefined && notes.some(note => String(note.id) === String(preferredId) && !removed.has(String(note.id))))) return preferredId
  const index = notes.findIndex(note => String(note.id) === String(selectedId))
  // Prefer the following row, then the closest previous one. One state update avoids an empty editor flash.
  return notes.slice(index + 1).find(note => !removed.has(String(note.id)))?.id
    ?? notes.slice(0, Math.max(0, index)).reverse().find(note => !removed.has(String(note.id)))?.id
    ?? null
}
