import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, Portal, ButtonBase } from '@mui/material'
import ArticleIcon from '@mui/icons-material/Article'
import AddIcon from '@mui/icons-material/Add'
import { floatingGlassSx } from '../../utils/floatingGlassSx'

const MAX_ITEMS = 8

// 简易模糊匹配：每个字符按顺序出现且权重根据连续命中和起始位置计算
const fuzzyScore = (q, title) => {
  if (!q) return 1 // 空 query 时所有标题以原序展示，保留全部
  const tl = title.toLowerCase()
  const ql = q.toLowerCase()
  if (tl.includes(ql)) {
    const idx = tl.indexOf(ql)
    return 1000 - idx
  }
  let ti = 0, qi = 0, score = 0, prevHit = -2
  while (ti < tl.length && qi < ql.length) {
    if (tl[ti] === ql[qi]) {
      score += (ti === prevHit + 1 ? 5 : 1)
      prevHit = ti
      qi++
    }
    ti++
  }
  if (qi < ql.length) return 0
  return score
}

const WikiLinkSuggestionPopup = ({ state, allTitles, onSelect, onClose }) => {
  const [activeIdx, setActiveIdx] = useState(0)
  const listRef = useRef(null)

  const items = useMemo(() => {
    const q = (state?.query || '').trim()
    const ql = q.toLowerCase()
    const scored = []
    for (const t of allTitles) {
      const s = fuzzyScore(q, t)
      if (s > 0) scored.push({ title: t, score: s })
    }
    scored.sort((a, b) => b.score - a.score)
    const out = scored.slice(0, MAX_ITEMS)
    const hasExact = scored.some((x) => x.title.toLowerCase() === ql)
    if (q && !hasExact) {
      out.push({ title: q, score: -1, isCreate: true })
    }
    return out
  }, [state?.query, allTitles])

  useEffect(() => {
    setActiveIdx(0)
  }, [state?.query])

  useEffect(() => {
    if (!state?.open) return
    const onKey = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx((i) => (i + 1) % Math.max(1, items.length))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((i) => (i - 1 + items.length) % Math.max(1, items.length))
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (items.length === 0) return
        e.preventDefault()
        e.stopPropagation()
        const it = items[Math.min(activeIdx, items.length - 1)]
        onSelect(it.title)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [state?.open, items, activeIdx, onSelect, onClose])

  if (!state?.open || !state.clientRect) return null

  // 估算 popup 高度（每项 ~36px + padding）做边界翻折
  const ITEM_H = 36
  const PADDING = 12
  const estHeight = Math.min(360, items.length * ITEM_H + PADDING)
  const POPUP_W = 320
  const margin = 8

  // 检查是否与右键菜单矩形重叠，重叠则向右/向上避让
  let top = state.clientRect.bottom + 4
  let left = state.clientRect.left
  // 下边缘越界 → 反向到上方
  if (top + estHeight > window.innerHeight - margin) {
    const above = state.clientRect.top - 4 - estHeight
    if (above >= margin) top = above
    else top = Math.max(margin, window.innerHeight - estHeight - margin)
  }
  if (left + POPUP_W > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - POPUP_W - margin)
  }
  // 与编辑器右键菜单避让
  try {
    const ctx = document.querySelector('[data-editor-context-menu]')
    if (ctx) {
      const r = ctx.getBoundingClientRect()
      const overlap = !(left + POPUP_W < r.left || left > r.right || top + estHeight < r.top || top > r.bottom)
      if (overlap) {
        // 优先放到右键菜单右侧
        if (r.right + margin + POPUP_W <= window.innerWidth - margin) {
          left = r.right + margin
        } else if (r.left - margin - POPUP_W >= margin) {
          left = r.left - margin - POPUP_W
        } else {
          // 都放不下就放到右键菜单上方
          top = Math.max(margin, r.top - margin - estHeight)
        }
      }
    }
  } catch {}

  return (
    <Portal>
      <Box
        ref={listRef}
        data-wiki-suggestion-popup
        sx={{
          position: 'fixed',
          top,
          left,
          zIndex: 2200,
          minWidth: 260,
          width: POPUP_W,
          maxWidth: 360,
          overflow: 'hidden',
          p: 0.55,
          ...floatingGlassSx({ radius: '14px', shadow: 'menu' }),
        }}
        onMouseDown={(e) => e.preventDefault()}
      >
        {items.length === 0 ? (
          <Box sx={{ px: 1.25, py: 0.85 }}>
            <Typography variant="caption" color="text.secondary">
              没有匹配的笔记
            </Typography>
          </Box>
        ) : (
          items.map((it, idx) => {
            const active = idx === activeIdx
            const isCreate = !!it.isCreate
            return (
              <ButtonBase
                key={`${isCreate ? 'create:' : ''}${it.title}`}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => onSelect(it.title)}
                focusRipple
                TouchRippleProps={{ style: { color: isCreate ? 'rgba(59,130,246,0.45)' : 'rgba(120,120,128,0.35)' } }}
                sx={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  gap: 1,
                  px: 1.25,
                  py: 0.8,
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  textAlign: 'left',
                  color: isCreate ? 'primary.main' : 'text.primary',
                  bgcolor: active
                    ? (isCreate ? 'rgba(59,130,246,0.10)' : 'action.hover')
                    : 'transparent',
                  transition: 'background-color 120ms cubic-bezier(0.32, 0.72, 0, 1)',
                  '&:hover': {
                    bgcolor: isCreate ? 'rgba(59,130,246,0.14)' : 'action.hover',
                  },
                }}
              >
                {isCreate ? (
                  <AddIcon sx={{ fontSize: 16, color: 'primary.main' }} />
                ) : (
                  <ArticleIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                )}
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography
                    noWrap
                    sx={{ fontSize: 13, fontWeight: 600 }}
                  >
                    {isCreate ? `新建笔记 “${it.title}”` : it.title}
                  </Typography>
                </Box>
              </ButtonBase>
            )
          })
        )}
      </Box>
    </Portal>
  )
}

export default WikiLinkSuggestionPopup
