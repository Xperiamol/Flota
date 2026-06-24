export const getWhiteboardPreviewKey = (noteLike) => {
  const raw = noteLike?.sync_id || noteLike?.syncId || noteLike?.id || ''
  const key = String(raw).trim()
  return key || ''
}

export const getWhiteboardPreviewUrl = (noteLike, fallbackTime) => {
  const previewKey = getWhiteboardPreviewKey(noteLike)
  if (!previewKey) return ''
  const stamp = encodeURIComponent(String(
    noteLike?.updated_at ||
    noteLike?.updatedAt ||
    fallbackTime ||
    Date.now()
  ))
  return `app://images/whiteboard-preview/${previewKey}.png?t=${stamp}`
}
