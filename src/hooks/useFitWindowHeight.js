import { useEffect } from 'react'

const MIN_HEIGHT = 80
const MAX_HEIGHT = 900

/**
 * 桌面卡片的窗口高度跟着内容走（宽度仍由用户调整）：内容变多变少时窗口随之伸缩，不留空白。
 * @param {import('react').RefObject<HTMLElement>} contentRef 卡片内容（不含标题条）
 * @param {number} chromeHeight  标题条等固定部分的高度
 * @param {boolean} enabled
 * @param {number} zoom  内容和标题条外面套的 CSS zoom（桌面卡片的「大小」）；变化时重新计算
 */
export default function useFitWindowHeight(contentRef, chromeHeight, enabled = true, zoom = 1) {
  useEffect(() => {
    const element = contentRef.current
    if (!enabled || !element || typeof ResizeObserver === 'undefined') return undefined
    // 用定时器而不是 requestAnimationFrame：桌面卡片通常不在焦点或被别的窗口挡住，Chromium 会暂停这类窗口的动画帧
    let timer = 0
    const fit = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        // 桌面卡片可能整体缩放：按实际显示出来的高度算，标题条高度也一起缩放
        const contentHeight = element.getBoundingClientRect().height || element.scrollHeight * zoom
        // 向上取整，再留 1px 余量：缩放后的小数高度四舍五入会比内容矮一点，导致出现滚动条
        const wanted = Math.ceil(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT * Math.min(1, zoom), chromeHeight * zoom + contentHeight + 1)))
        if (Math.abs(wanted - window.innerHeight) > 3) window.electronAPI?.window?.setSize?.(window.innerWidth, wanted)
      }, 30)
    }
    const observer = new ResizeObserver(fit)
    observer.observe(element)
    fit()
    return () => { observer.disconnect(); clearTimeout(timer) }
  }, [contentRef, chromeHeight, enabled, zoom])
}
