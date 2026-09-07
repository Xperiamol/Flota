import { useEffect } from 'react'
import { getCommonBounds } from '@excalidraw/excalidraw'
import { chooseWhiteboardPanelPosition } from '../utils/whiteboardPanelLayout'

export default function useWhiteboardProperties(api, container, collapsed) {
  useEffect(() => {
    if (!container || !api || collapsed) return
    let frame = 0
    let panel = null
    let side = 'left-top'
    let interacting = false
    const popoverOffsets = new WeakMap()
    const resize = new ResizeObserver(() => schedule())
    const layout = () => {
      frame = 0
      const nextPanel = container.querySelector('.App-menu__left')
      if (nextPanel !== panel) {
        if (panel) resize.unobserve(panel)
        panel = nextPanel
        if (panel) resize.observe(panel)
      }
      const canvas = container.getBoundingClientRect()
      // Radix checks the window boundary; an embedded whiteboard can be much
      // narrower. Keep color/font popovers inside this canvas as well.
      container.querySelectorAll('[data-radix-popper-content-wrapper]').forEach(popover => {
        const previous = popoverOffsets.get(popover) || { x: 0, y: 0 }
        const rect = popover.getBoundingClientRect()
        if (!rect.width || !rect.height) return
        const left = rect.left - previous.x
        const top = rect.top - previous.y
        let x = Math.min(Math.max(left, canvas.left + 8), Math.max(canvas.left + 8, canvas.right - rect.width - 8)) - left
        const panelBounds = panel?.getBoundingClientRect()
        if (left + rect.width > canvas.right && panelBounds && panelBounds.left - rect.width - 12 >= canvas.left) x = panelBounds.left - rect.width - 12 - left
        const y = Math.min(Math.max(top, canvas.top + 8), Math.max(canvas.top + 8, canvas.bottom - rect.height - 8)) - top
        popover.style.translate = `${x}px ${y}px`
        popover.style.maxHeight = `${Math.max(80, canvas.height - 16)}px`
        popover.style.overflowY = Math.max(rect.height, popover.scrollHeight) > canvas.height - 16 ? 'auto' : 'visible'
        popoverOffsets.set(popover, { x, y })
      })
      if (!panel || interacting || panel.contains(document.activeElement)) return
      if (!canvas.width || !canvas.height || !panel.offsetParent) return
      const appState = api.getAppState()
      const toolbar = container.querySelector('.App-menu_top')?.getBoundingClientRect()
      const top = Math.max(68, (toolbar?.bottom || canvas.top + 56) - canvas.top + 12)
      const maxHeight = Math.max(80, canvas.height - top - 64)
      panel.style.setProperty('max-height', `${maxHeight}px`, 'important')
      const bounds = panel.getBoundingClientRect()
      const elements = api.getSceneElements().filter(element => !element.isDeleted && (appState.selectedElementIds?.[element.id] || element.id === appState.editingTextElement?.id))
      let selection = null
      if (elements.length) {
        const [x1, y1, x2, y2] = getCommonBounds(elements)
        const zoom = appState.zoom.value
        selection = { left: (x1 + appState.scrollX) * zoom, top: (y1 + appState.scrollY) * zoom, right: (x2 + appState.scrollX) * zoom, bottom: (y2 + appState.scrollY) * zoom }
      }
      const sidebar = container.querySelector('.sidebar')?.getBoundingClientRect()
      const position = chooseWhiteboardPanelPosition({
        width: canvas.width, height: canvas.height, panelWidth: bounds.width, panelHeight: bounds.height,
        top, selection, previous: side, rightInset: sidebar ? Math.max(0, canvas.right - sidebar.left) : 0,
      })
      side = position.side
      const parent = panel.offsetParent.getBoundingClientRect()
      panel.style.setProperty('left', `${canvas.left - parent.left + position.left}px`, 'important')
      panel.style.setProperty('top', `${canvas.top - parent.top + position.top}px`, 'important')
      panel.style.setProperty('right', 'auto', 'important')
      panel.style.setProperty('bottom', 'auto', 'important')
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(layout) }
    const down = event => { interacting = Boolean(event.target.closest?.('.App-menu__left, .popover, .color-picker, .Dialog')) }
    const up = () => { interacting = false; schedule() }
    resize.observe(container)
    const mutation = new MutationObserver(schedule)
    mutation.observe(container, { childList: true, subtree: true })
    const unsubscribe = api.onChange(schedule)
    container.addEventListener('pointerdown', down, true)
    container.addEventListener('focusout', schedule)
    window.addEventListener('pointerup', up)
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutation.disconnect()
      unsubscribe()
      container.removeEventListener('pointerdown', down, true)
      container.removeEventListener('focusout', schedule)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('resize', schedule)
    }
  }, [api, container, collapsed])
}
