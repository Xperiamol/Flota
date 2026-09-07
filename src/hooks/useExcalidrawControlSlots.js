import { useEffect, useState } from 'react'

const EXCALIDRAW_LABEL_OVERRIDES = {
  'zh-CN': {
    'Toggle grid': '显示网格',
    'Canvas & Shape properties': '画布与图形属性',
  },
  'en-US': {
    '显示网格': 'Toggle grid',
    '画布与图形属性': 'Canvas & Shape properties',
  },
}

const localizeMissingExcalidrawLabels = (container, language) => {
  const replacements = EXCALIDRAW_LABEL_OVERRIDES[language] || EXCALIDRAW_LABEL_OVERRIDES['en-US']
  const replaceText = value => Object.entries(replacements).reduce(
    (result, [source, target]) => result.replaceAll(source, target),
    value,
  )

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const next = replaceText(node.nodeValue || '')
    if (next !== node.nodeValue) node.nodeValue = next
    node = walker.nextNode()
  }

  container.querySelectorAll('[aria-label], [title]').forEach((element) => {
    for (const attribute of ['aria-label', 'title']) {
      const value = element.getAttribute(attribute)
      if (!value) continue
      const next = replaceText(value)
      if (next !== value) element.setAttribute(attribute, next)
    }
  })
}

// Excalidraw does not expose extension slots for its main toolbar, property panel
// or zoom group. Track those stable DOM regions so React can portal Flota controls
// into their original positions instead of adding detached floating controls.
export default function useExcalidrawControlSlots(container, language = 'zh-CN') {
  const [slots, setSlots] = useState({ toolbar: null, zoom: null, properties: null, contextMenu: null })

  useEffect(() => {
    if (!container) return undefined
    let frame = 0
    let contextPoint = null
    const findSlots = () => {
      frame = 0
      localizeMissingExcalidrawLabels(container, language)
      const contextMenu = container.querySelector('.context-menu')
      let contextMenuHost = contextMenu?.querySelector(':scope > .flota-context-menu-host') || null
      if (contextMenu && !contextMenuHost) {
        contextMenuHost = document.createElement('li')
        contextMenuHost.className = 'flota-context-menu-host'
        contextMenu.insertBefore(contextMenuHost, contextMenu.firstChild)
      }
      if (contextMenu) {
        const popover = contextMenu.closest('.popover')
        const canvas = container.getBoundingClientRect()
        const menuMaxHeight = Math.max(160, Math.min(560, canvas.height - 16))
        contextMenu.style.maxHeight = `${menuMaxHeight}px`
        contextMenu.style.overflowY = 'auto'
        contextMenu.style.overscrollBehavior = 'contain'
        if (popover) {
          // Excalidraw may freeze the wrapper height after its first measure.
          // The injected first action changes that measurement, so let the
          // menu own scrolling and measure the wrapper again at its real size.
          popover.style.height = 'auto'
          popover.style.maxHeight = `${menuMaxHeight}px`
          popover.style.overflowY = 'visible'
        }
        const bounds = popover?.getBoundingClientRect()
        if (popover && bounds?.width && bounds?.height) {
          const inset = 8
          const parent = popover.offsetParent?.getBoundingClientRect() || canvas
          const desiredLeft = (contextPoint?.x ?? bounds.left) - parent.left
          const desiredTop = (contextPoint?.y ?? bounds.top) - parent.top
          const minLeft = canvas.left + inset - parent.left
          const minTop = canvas.top + inset - parent.top
          const maxLeft = Math.max(minLeft, canvas.right - inset - parent.left - bounds.width)
          const maxTop = Math.max(minTop, canvas.bottom - inset - parent.top - bounds.height)
          popover.style.left = `${Math.min(Math.max(desiredLeft, minLeft), maxLeft)}px`
          popover.style.top = `${Math.min(Math.max(desiredTop, minTop), maxTop)}px`
        }
      }
      const next = {
        toolbar: container.querySelector('.shapes-section'),
        zoom: container.querySelector('.zoom-actions'),
        properties: container.querySelector('.App-menu__left'),
        contextMenu: contextMenuHost,
      }
      setSlots(previous => (
        previous.toolbar === next.toolbar
          && previous.zoom === next.zoom
          && previous.properties === next.properties
          && previous.contextMenu === next.contextMenu
          ? previous
          : next
      ))
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(findSlots) }
    const rememberContextPoint = event => {
      contextPoint = { x: event.clientX, y: event.clientY }
      schedule()
    }
    const observer = new MutationObserver(schedule)
    observer.observe(container, { childList: true, subtree: true })
    container.addEventListener('contextmenu', rememberContextPoint, true)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      container.removeEventListener('contextmenu', rememberContextPoint, true)
    }
  }, [container, language])

  return slots
}
