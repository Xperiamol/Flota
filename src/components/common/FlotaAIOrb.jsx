import React, { useEffect, useRef } from 'react'
import { Box } from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'

let orbSeq = 0

/**
 * 空状态英雄区的「流体生命」主视觉：gooey 粘性滤镜 + 形变呼吸 + 弹簧鼠标跟随 + 点击融合水滴。
 * 完全还原给定的物理比例和尺寸（240px 容器，220px 交互区）。
 */
const SPRING = 0.08
const FRICTION = 0.74
const MAX_DISTANCE = 90

const FlotaAIOrb = ({ sx }) => {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const primary = theme.palette.primary.main
  const filterId = useRef(`flota-orb-goo-${(orbSeq += 1)}`).current

  const interactiveRef = useRef(null)
  const gooeyRef = useRef(null)
  const baseRef = useRef(null)
  const attractorRef = useRef(null)
  const satelliteRef = useRef(null)
  const ambientRef = useRef(null)
  const foregroundRef = useRef(null)

  // 恢复原版那种清透、温润玻璃质感，但加入应用主题色 (primary) 进行微妙的染色
  const blobTop = isDark ? alpha('#ffffff', 0.15) : alpha('#ffffff', 0.45)
  const blobBottom = isDark ? alpha(primary, 0.2) : alpha(primary, 0.25)
  const blobGradient = `linear-gradient(135deg, ${blobTop} 0%, ${blobBottom} 100%)`

  useEffect(() => {
    const prefersReduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    const interactive = interactiveRef.current
    if (!interactive || prefersReduced) return

    let mx = 0, my = 0, tx = 0, ty = 0, vx = 0, vy = 0
    let hovered = false
    let scaleVal = 1
    let rafId = 0

    const loop = () => {
      vx += (tx - mx) * SPRING
      vy += (ty - my) * SPRING
      vx *= FRICTION
      vy *= FRICTION
      mx += vx
      my += vy

      if (attractorRef.current) {
        attractorRef.current.style.transform =
          `translate(${mx}px, ${my}px) scale(${hovered ? 1.15 * scaleVal : 0.55})`
      }
      if (foregroundRef.current) {
        foregroundRef.current.style.transform =
          `translate(${mx * 0.45}px, ${my * 0.45}px) scale(${scaleVal})`
      }
      if (ambientRef.current) {
        ambientRef.current.style.transform =
          `translate(${mx * 0.3}px, ${my * 0.3}px) scale(${1 + (hovered ? 0.08 : 0)})`
      }
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)

    const onMove = (e) => {
      const rect = interactive.getBoundingClientRect()
      const rawX = e.clientX - (rect.left + rect.width / 2)
      const rawY = e.clientY - (rect.top + rect.height / 2)
      const dist = Math.hypot(rawX, rawY)
      if (dist > MAX_DISTANCE) {
        const angle = Math.atan2(rawY, rawX)
        tx = Math.cos(angle) * MAX_DISTANCE
        ty = Math.sin(angle) * MAX_DISTANCE
      } else {
        tx = rawX
        ty = rawY
      }
    }
    const onEnter = () => {
      hovered = true
      if (attractorRef.current) attractorRef.current.style.opacity = '0.95'
      if (satelliteRef.current) satelliteRef.current.style.transform = 'translate(62px) scale(0.8)'
      if (baseRef.current) {
        const anims = baseRef.current.getAnimations()
        anims.forEach((a) => { a.playbackRate = 2 })
      }
    }
    const onLeave = () => {
      hovered = false
      tx = 0
      ty = 0
      if (attractorRef.current) attractorRef.current.style.opacity = '0'
      if (satelliteRef.current) satelliteRef.current.style.transform = 'translate(62px) scale(0.4)'
      if (baseRef.current) {
        const anims = baseRef.current.getAnimations()
        anims.forEach((a) => { a.playbackRate = 1 })
      }
    }
    const onDown = (e) => {
      scaleVal = 0.88
      if (baseRef.current) baseRef.current.style.transform = `scale(${scaleVal})`
      const rect = interactive.getBoundingClientRect()
      const cx = e.clientX - rect.left - rect.width / 2
      const cy = e.clientY - rect.top - rect.height / 2
      if (Math.hypot(cx, cy) > 30) spawnDrop(cx, cy)
    }
    const onUp = () => {
      scaleVal = 1.05
      if (baseRef.current) baseRef.current.style.transform = `scale(${scaleVal})`
      window.setTimeout(() => {
        scaleVal = 1
        if (baseRef.current) baseRef.current.style.transform = `scale(${scaleVal})`
      }, 200)
    }

    const dropTimers = new Set()
    const spawnDrop = (startX, startY) => {
      const goo = gooeyRef.current
      if (!goo) return
      const drop = document.createElement('div')
      drop.style.cssText = [
        'position:absolute', 'width:20px', 'height:20px', 'border-radius:9999px',
        'pointer-events:none', 'opacity:0.9',
        `background:linear-gradient(135deg, ${blobTop} 0%, ${blobBottom} 100%)`,
        'backdrop-filter:blur(8px)', '-webkit-backdrop-filter:blur(8px)',
        'box-shadow:inset 0 2px 5px rgba(255,255,255,0.5)',
        `transform:translate(${startX}px, ${startY}px) scale(1.1)`,
        'transition:transform 0.9s cubic-bezier(0.16,1,0.3,1), opacity 0.9s ease',
      ].join(';')
      goo.appendChild(drop)
      requestAnimationFrame(() => {
        drop.style.transform = 'translate(0px, 0px) scale(0.1)'
        drop.style.opacity = '0'
      })
      const timer = window.setTimeout(() => {
        drop.remove()
        dropTimers.delete(timer)
      }, 900)
      dropTimers.add(timer)
    }

    interactive.addEventListener('mousemove', onMove)
    interactive.addEventListener('mouseenter', onEnter)
    interactive.addEventListener('mouseleave', onLeave)
    interactive.addEventListener('mousedown', onDown)
    interactive.addEventListener('mouseup', onUp)

    return () => {
      cancelAnimationFrame(rafId)
      interactive.removeEventListener('mousemove', onMove)
      interactive.removeEventListener('mouseenter', onEnter)
      interactive.removeEventListener('mouseleave', onLeave)
      interactive.removeEventListener('mousedown', onDown)
      interactive.removeEventListener('mouseup', onUp)
      dropTimers.forEach((t) => window.clearTimeout(t))
      dropTimers.clear()
    }
  }, [blobGradient])

  const blobBase = {
    position: 'absolute',
    borderRadius: '9999px',
    background: blobGradient,
  }

  return (
    <Box
      sx={[
        {
          position: 'relative',
          width: 240,
          height: 240,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          '@keyframes flota-orb-morph-base': {
            '0%': { borderRadius: '62% 38% 43% 57% / 51% 45% 55% 49%' },
            '25%': { borderRadius: '53% 47% 35% 65% / 46% 56% 44% 54%' },
            '50%': { borderRadius: '41% 59% 60% 40% / 58% 38% 62% 42%' },
            '75%': { borderRadius: '57% 43% 48% 52% / 44% 58% 42% 56%' },
            '100%': { borderRadius: '62% 38% 43% 57% / 51% 45% 55% 49%' },
          },
          '@keyframes flota-orb-morph-attractor': {
            '0%, 100%': { borderRadius: '45% 55% 40% 60% / 50% 45% 55% 50%' },
            '50%': { borderRadius: '55% 45% 60% 40% / 45% 55% 45% 55%' },
          },
          '@keyframes flota-orb-orbit': {
            from: { transform: 'rotate(0deg)' },
            to: { transform: 'rotate(360deg)' },
          },
          '@keyframes flota-orb-shimmer': {
            '0%': { transform: 'translate(-30%, -30%) rotate(0deg)' },
            '100%': { transform: 'translate(-30%, -30%) rotate(360deg)' },
          },
          '@keyframes flota-orb-spin': {
            from: { transform: 'rotate(0deg)' },
            to: { transform: 'rotate(360deg)' },
          },
          '@keyframes flota-orb-spin-rev': {
            from: { transform: 'rotate(360deg)' },
            to: { transform: 'rotate(0deg)' },
          },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {/* gooey 粘性滤镜：扩宽滤镜作用域，避免被 bounding box 切断 */}
      <Box component="svg" sx={{ position: 'absolute', width: 0, height: 0 }} aria-hidden>
        <defs>
          <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9" result="goo" />
            <feBlend in="SourceGraphic" in2="goo" />
          </filter>
        </defs>
      </Box>

      <Box
        ref={interactiveRef}
        sx={{
          position: 'relative',
          width: 220,
          height: 220,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        <Box
          ref={gooeyRef}
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            filter: `url(#${filterId})`,
          }}
        >
          <Box
            ref={baseRef}
            sx={{
              ...blobBase,
              width: 112,
              height: 112,
              overflow: 'hidden',
              animation: 'flota-orb-morph-base 6s ease-in-out infinite',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              boxShadow: isDark
                ? `inset 0 4px 12px ${alpha('#ffffff', 0.2)}, inset 0 -4px 12px ${alpha('#a5bcd9', 0.1)}, 0 12px 32px ${alpha('#000000', 0.3)}`
                : `inset 0 4px 12px ${alpha('#ffffff', 0.6)}, inset 0 -4px 12px ${alpha('#a5bcd9', 0.2)}, 0 12px 32px ${alpha('#a5bcd9', 0.15)}`,
              transition: 'transform 0.5s',
            }}
          >
            <Box sx={{
              position: 'absolute', top: 0, left: 0, width: '200%', height: '200%',
              borderRadius: '9999px', pointerEvents: 'none',
              background: `linear-gradient(135deg, ${alpha('#ffffff', 0.15)}, transparent 50%, ${alpha('#ffffff', 0.25)})`,
              animation: 'flota-orb-shimmer 12s ease-in-out infinite',
            }} />
          </Box>

          <Box
            ref={attractorRef}
            sx={{
              ...blobBase,
              width: 40,
              height: 40,
              opacity: 0,
              transform: 'translate(0px, 0px) scale(0.6)',
              animation: 'flota-orb-morph-attractor 3s ease-in-out infinite',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              boxShadow: `inset 0 3px 8px ${alpha('#ffffff', 0.5)}`,
              transition: 'opacity 0.5s',
            }}
          />

          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              animation: 'flota-orb-orbit 16s linear infinite',
            }}
          >
            <Box
              ref={satelliteRef}
              sx={{
                ...blobBase,
                width: 24,
                height: 24,
                transform: 'translate(62px) scale(0.4)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                boxShadow: `inset 0 2px 6px ${alpha('#ffffff', 0.5)}`,
                transition: 'transform 0.8s cubic-bezier(0.16,1,0.3,1)',
              }}
            />
          </Box>

          <Box
            ref={ambientRef}
            sx={{
              position: 'absolute', width: 128, height: 128, borderRadius: '9999px',
              bgcolor: alpha('#ffffff', 0.2), filter: 'blur(20px)',
              transition: 'transform 0.2s',
            }}
          />
        </Box>

        <Box
          ref={foregroundRef}
          sx={{
            position: 'absolute', zIndex: 10, pointerEvents: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'transform 0.1s',
          }}
        >
          <Box sx={{
            position: 'absolute', width: 96, height: 96, borderRadius: '9999px',
            background: `linear-gradient(to top right, ${alpha('#ffffff', 0.1)}, transparent)`,
            filter: 'blur(1px)',
          }} />
        </Box>
      </Box>
    </Box>
  )
}

export default FlotaAIOrb
