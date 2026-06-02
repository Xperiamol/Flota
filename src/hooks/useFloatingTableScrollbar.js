import { useEffect } from 'react'

/**
 * 当根容器内的超宽表格在视口中可见但其原生水平滚动条超出视口下沿时，
 * 在视口底部贴一根浮动滚动条，与表格双向同步，保证大表格随时可左右拖动。
 *
 * @param {React.RefObject<HTMLElement>} rootRef 根容器
 * @param {object} [options]
 * @param {string} [options.selector='.tableWrapper'] 滚动容器选择器
 */
export default function useFloatingTableScrollbar(rootRef, { selector = '.tableWrapper' } = {}) {
  useEffect(() => {
    const root = rootRef?.current
    if (!root) return

    // 浮动条容器（共享一个 host），按需创建/销毁子条
    const host = document.createElement('div')
    host.setAttribute('data-floating-table-scrollbar-host', '')
    Object.assign(host.style, {
      position: 'fixed',
      left: '0',
      right: '0',
      bottom: '0',
      pointerEvents: 'none',
      zIndex: '1200',
    })
    document.body.appendChild(host)

    // target → { bar, inner, syncing }
    const map = new WeakMap()
    const liveTargets = new Set()

    const makeBar = (target) => {
      const bar = document.createElement('div')
      Object.assign(bar.style, {
        position: 'fixed',
        height: '14px',
        overflowX: 'auto',
        overflowY: 'hidden',
        pointerEvents: 'auto',
        bottom: '0',
        background: 'transparent',
      })
      const inner = document.createElement('div')
      inner.style.height = '1px'
      bar.appendChild(inner)
      host.appendChild(bar)

      const onBarScroll = () => {
        const rec = map.get(target)
        if (!rec || rec.syncing) return
        rec.syncing = true
        target.scrollLeft = bar.scrollLeft
        rec.syncing = false
      }
      const onTargetScroll = () => {
        const rec = map.get(target)
        if (!rec || rec.syncing) return
        rec.syncing = true
        bar.scrollLeft = target.scrollLeft
        rec.syncing = false
      }
      bar.addEventListener('scroll', onBarScroll, { passive: true })
      target.addEventListener('scroll', onTargetScroll, { passive: true })
      const rec = { bar, inner, syncing: false, onBarScroll, onTargetScroll }
      map.set(target, rec)
      return rec
    }

    const removeBar = (target) => {
      const rec = map.get(target)
      if (!rec) return
      target.removeEventListener('scroll', rec.onTargetScroll)
      rec.bar.remove()
      map.delete(target)
    }

    let rafId = null
    const update = () => {
      rafId = null
      const targets = Array.from(root.querySelectorAll(selector))
      const vh = window.innerHeight
      const next = new Set()

      for (const target of targets) {
        const overflow = target.scrollWidth > target.clientWidth + 1
        const rect = target.getBoundingClientRect()
        const visible = rect.bottom > 0 && rect.top < vh
        const nativeBarVisible = rect.bottom <= vh
        const tooLow = rect.top >= vh - 24
        if (!overflow || !visible || nativeBarVisible || tooLow) continue

        const rec = map.get(target) || makeBar(target)
        next.add(target)

        rec.bar.style.left = `${Math.max(0, rect.left)}px`
        rec.bar.style.width = `${Math.min(rect.width, window.innerWidth - Math.max(0, rect.left))}px`
        rec.inner.style.width = `${target.scrollWidth}px`
        if (rec.bar.scrollLeft !== target.scrollLeft) {
          rec.syncing = true
          rec.bar.scrollLeft = target.scrollLeft
          rec.syncing = false
        }
      }

      // 清理本轮不再需要的浮动条
      liveTargets.forEach((t) => { if (!next.has(t)) removeBar(t) })
      liveTargets.clear()
      next.forEach((t) => liveTargets.add(t))
    }

    const schedule = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(update)
    }

    schedule()

    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    const ro = new ResizeObserver(schedule)
    ro.observe(root)
    const mo = new MutationObserver(schedule)
    mo.observe(root, { childList: true, subtree: true, attributes: true, characterData: true })

    return () => {
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      ro.disconnect()
      mo.disconnect()
      if (rafId !== null) cancelAnimationFrame(rafId)
      liveTargets.forEach((t) => removeBar(t))
      liveTargets.clear()
      host.remove()
    }
  }, [rootRef, selector])
}
