import { useEffect, useState } from 'react'

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

  // 点击穿透：窗口不拦鼠标，但仍收到鼠标移动（forward）。移到标了 data-desktop-handle 的标题条 / 按钮上时
  // 让窗口恢复接收鼠标，离开（或移出窗口）后继续穿透；弹出的外观面板也算在内，免得调到一半点不动
  const through = enabled && clickThroughActive(appearance)
  useEffect(() => {
    const api = window.electronAPI?.widgets
    if (!through || !api?.setDesktopMouseCapture) return undefined
    let capturing = null
    const set = (value) => {
      if (value === capturing) return
      capturing = value
      api.setDesktopMouseCapture(value)
    }
    const onMove = (event) => set(Boolean(event.target?.closest?.('[data-desktop-handle], .MuiPopover-root, .MuiTooltip-popper')))
    const onLeave = () => set(false)
    document.addEventListener('mousemove', onMove, true)
    document.documentElement.addEventListener('mouseleave', onLeave)
    set(false)
    return () => {
      document.removeEventListener('mousemove', onMove, true)
      document.documentElement.removeEventListener('mouseleave', onLeave)
    }
  }, [through])

  // 第二个返回值：本窗口先预览（拖动滑块时），松手后由设置保存并推给所有卡片
  return [appearance, setAppearance]
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
