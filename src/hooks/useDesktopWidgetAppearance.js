import { useEffect, useRef, useState } from 'react'

/** 宿主页面里能点的东西：点击穿透时鼠标在这些上面，窗口就接收点击 */
const HOST_INTERACTIVE = [
  '[data-desktop-handle]', '.MuiPopover-root', '.MuiTooltip-popper', '.MuiMenu-root', '.MuiDialog-root',
  'button', 'a[href]', 'input', 'textarea', 'select', 'label', '[role="button"]', '[role="checkbox"]',
  '[role="switch"]', '[role="slider"]', '[contenteditable="true"]',
].join(', ')

export const DEFAULT_DESKTOP_APPEARANCE = { opacity: 0.72, blur: true, scale: 0.9, clickThrough: false, blurSupported: true }

/** 点击穿透实际是否生效：开了穿透且背景没有模糊（与主进程 DesktopWidgets.clickThroughActive 一致） */
export const clickThroughActive = (appearance) => Boolean(appearance?.clickThrough) && !appearance?.blur

const fromQuery = () => {
  try {
    const raw = new URLSearchParams(window.location.search).get('appearance')
    return raw ? { ...DEFAULT_DESKTOP_APPEARANCE, ...JSON.parse(raw) } : null
  } catch (_) {
    return null
  }
}

/**
 * 桌面卡片外观（所有桌面卡片共用）：opacity 背景不透明度、blur 背后是否有系统模糊、scale 缩放。
 * 首次渲染用窗口地址里带的值，避免闪一下；之后跟随设置变化。
 * 同时让页面不画底色，窗口透出桌面。缩放由窗口自己套在卡片内容上（CSS zoom，外框仍铺满窗口）。
 */
export default function useDesktopWidgetAppearance(enabled = true) {
  const [appearance, setAppearance] = useState(() => fromQuery() || DEFAULT_DESKTOP_APPEARANCE)

  useEffect(() => {
    if (!enabled) return undefined
    const api = window.electronAPI?.widgets
    api?.getDesktopAppearance?.().then((res) => { if (res?.success) setAppearance(res.data) })
    return api?.onDesktopAppearance?.((next) => next && setAppearance(next))
  }, [enabled])

  useEffect(() => {
    if (!enabled) return undefined
    const root = document.documentElement
    const previous = { html: root.style.background, body: document.body.style.background }
    root.style.background = 'transparent'
    document.body.style.background = 'transparent'
    return () => {
      root.style.background = previous.html
      document.body.style.background = previous.body
    }
  }, [enabled])

  // 点击穿透：窗口平时不拦鼠标。主进程定时把光标在卡片里的位置发过来（系统转发的鼠标移动不可靠），
  // 这里看光标下面是不是能点的东西——按钮、输入框、勾选框、标题条、外观面板，或组件里报告可点的地方——
  // 是就让窗口临时接收点击，移开后继续穿透。按住鼠标（拖滑块、拖卡片）期间保持不变。
  const through = enabled && clickThroughActive(appearance)
  const [pointerInside, setPointerInside] = useState(false)
  const pointerApi = useRef({ setFrame: () => {} })
  const scaleRef = useRef(appearance.scale || 1)
  scaleRef.current = appearance.scale || 1
  useEffect(() => {
    const api = window.electronAPI?.widgets
    if (!through || !api?.setDesktopMouseCapture || !api?.onDesktopPointer) {
      pointerApi.current.setFrame = () => {}
      setPointerInside(false)
      return undefined
    }
    let capturing = null
    let hostInteractive = false
    let frameInteractive = false
    let pressed = false
    const apply = () => {
      if (pressed) return
      const value = hostInteractive || frameInteractive
      if (value === capturing) return
      capturing = value
      api.setDesktopMouseCapture(value)
    }
    const onDown = () => { pressed = true }
    const onUp = () => { pressed = false; apply() }
    const off = api.onDesktopPointer((pointer = {}) => {
      if (!pointer.inside) {
        setPointerInside(false)
        hostInteractive = false
        frameInteractive = false
        pressed = false
        capturing = false // 主进程离开时已经恢复穿透
        return
      }
      setPointerInside(true)
      if (pressed) return
      const element = document.elementFromPoint(pointer.x, pointer.y)
      if (element?.tagName === 'IFRAME') {
        // 组件在沙箱 iframe 里：把 iframe 内的坐标发给组件，由它回答那里能不能点（见 sdk.js 的 pointer-probe）
        const rect = element.getBoundingClientRect()
        const zoom = scaleRef.current
        hostInteractive = false
        element.contentWindow?.postMessage({ __flota: 1, type: 'pointer-probe', x: (pointer.x - rect.left) / zoom, y: (pointer.y - rect.top) / zoom }, '*')
        return
      }
      frameInteractive = false
      hostInteractive = Boolean(element?.closest?.(HOST_INTERACTIVE))
      apply()
    })
    pointerApi.current.setFrame = (value) => {
      frameInteractive = Boolean(value)
      apply()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointerup', onUp, true)
    return () => {
      off?.()
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', onUp, true)
      pointerApi.current.setFrame = () => {}
      setPointerInside(false)
    }
  }, [through])

  // 第二个返回值：本窗口先预览（拖动滑块时），松手后由设置保存并推给所有卡片；
  // 第三个：组件 iframe 报告「光标下面是否可点」；第四个：点击穿透时光标是否在这张卡片上（用来显示按钮）
  return [appearance, setAppearance, (value) => pointerApi.current.setFrame(value), pointerInside]
}

/**
 * 桌面卡片外框的样式：半透明底色 + 圆角 + 细边。
 * 有系统模糊时底色可以更透；没有模糊时同样的不透明度下文字背后是清晰的桌面，稍微加一点底色保证可读。
 */
export const desktopCardSurfaceSx = (appearance) => (theme) => {
  const dark = theme.palette.mode === 'dark'
  const base = dark ? '24, 28, 36' : '252, 252, 253'
  const opacity = Math.min(1, Math.max(0.05, Number(appearance?.opacity) || 0.72))
  const alpha = appearance?.blur ? opacity : Math.min(1, opacity + 0.08)
  return {
    bgcolor: `rgba(${base}, ${alpha.toFixed(3)})`,
    borderRadius: '14px',
    border: `1px solid ${dark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)'}`,
    boxSizing: 'border-box',
    // 不透明度很低时给文字加一层很淡的投影，压在花哨的墙纸上也看得清
    ...(opacity < 0.45 ? { textShadow: dark ? '0 1px 2px rgba(0,0,0,0.45)' : '0 1px 2px rgba(255,255,255,0.6)' } : {}),
  }
}
