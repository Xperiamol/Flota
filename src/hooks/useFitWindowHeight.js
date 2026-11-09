import { useEffect } from 'react'

const MIN_HEIGHT = 120
const MAX_HEIGHT = 900

/**
 * 桌面卡片的窗口高度跟着内容走（宽度仍由用户调整）：内容变多变少时窗口随之伸缩，不留空白。
 * @param {import('react').RefObject<HTMLElement>} contentRef 卡片内容（不含标题条）
 * @param {number} chromeHeight  标题条等固定部分的高度
 * @param {boolean} enabled
 */
export default function useFitWindowHeight(contentRef, chromeHeight, enabled = true) {
  useEffect(() => {
    const element = contentRef.current
    if (!enabled || !element || typeof ResizeObserver === 'undefined') return undefined
    // 用定时器而不是 requestAnimationFrame：桌面卡片通常不在焦点或被别的窗口挡住，Chromium 会暂停这类窗口的动画帧
    let timer = 0
    const fit = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const wanted = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, chromeHeight + element.scrollHeight)))
        if (Math.abs(wanted - window.innerHeight) > 3) window.electronAPI?.window?.setSize?.(window.innerWidth, wanted)
      }, 30)
    }
    const observer = new ResizeObserver(fit)
    observer.observe(element)
    fit()
    return () => { observer.disconnect(); clearTimeout(timer) }
  }, [contentRef, chromeHeight, enabled])
}
