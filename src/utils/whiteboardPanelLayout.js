const overlapArea = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))

// Coordinates are relative to the canvas, independent of zoom and window offset.
export const chooseWhiteboardPanelPosition = ({ width, height, panelWidth, panelHeight, top = 72, selection, previous = 'left-top', rightInset = 0 }) => {
  const margin = 12
  const bottom = Math.max(top, height - 64 - panelHeight)
  const right = Math.max(margin, width - rightInset - panelWidth - margin)
  const candidates = [
    { side: 'left-top', left: margin, top },
    { side: 'right-top', left: right, top },
    { side: 'left-bottom', left: margin, top: bottom },
    { side: 'right-bottom', left: right, top: bottom },
  ]
  if (!selection) return candidates[0]
  const padded = { left: selection.left - 16, top: selection.top - 16, right: selection.right + 16, bottom: selection.bottom + 16 }
  const scored = candidates.map(candidate => ({ ...candidate, score: overlapArea({ ...candidate, right: candidate.left + panelWidth, bottom: candidate.top + panelHeight }, padded) }))
  const best = scored.reduce((a, b) => a.score <= b.score ? a : b)
  const current = scored.find(candidate => candidate.side === previous)
  // Avoid jumping between equally usable corners while dragging/resizing.
  return current && current.score <= best.score + 600 ? current : best
}
