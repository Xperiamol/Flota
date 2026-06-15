// Knowledge Graph plugin view - 由插件 surface "main:view" 注入主区域
// 通过 globalThis.__flotaHost__ 取宿主 React/MUI/store/utils 单例，避免双 React 实例
import { extractWikiTargets } from './linkGraph.js'

const host = globalThis.__flotaHost__
if (!host) throw new Error('Flota host not ready')

const { React, MaterialUI, MaterialIcons, MuiStyles, store, utils } = host
const { useEffect, useMemo, useRef, useState, useCallback } = React
const { Box, Typography, IconButton, Tooltip, TextField, InputAdornment, Slider, Chip, ToggleButton, ToggleButtonGroup } = MaterialUI
const { useTheme } = MuiStyles
const RestartAltIcon = MaterialIcons.RestartAlt
const ZoomInIcon = MaterialIcons.ZoomIn
const ZoomOutIcon = MaterialIcons.ZoomOut
const CenterFocusStrongIcon = MaterialIcons.CenterFocusStrong
const SearchIcon = MaterialIcons.Search
const HubIcon = MaterialIcons.Hub
const CategoryIcon = MaterialIcons.Category
const { useStore } = store
const { stripMarkdownToPreviewText, floatingGlassSx } = utils

const REPULSION = 1200
const SPRING_K = 0.05
const SPRING_LEN = 110
const CENTER_PULL = 0.008
const DAMPING = 0.86
const MAX_FRAMES = 320
const DRAG_FOLLOW = 0.42
const DRAG_RELAX_FRAMES = 120
const MIN_SCALE = 0.18
const MAX_SCALE = 6
const NODE_BASE_R = 4
const NODE_DEG_R = 1.6
const NODE_MAX_R = 22
const GRAPH_PANEL_RADIUS = '14px'
const GRAPH_ITEM_RADIUS = '8px'

const degreeToHue = (deg) => {
  const t = Math.min(1, deg / 12)
  return 220 - t * 200
}

const deriveDisplayTitle = (note) => {
  if (!note) return '无标题'
  const t = note.title
  if (t && t !== '无标题' && t !== 'Untitled') return t
  if (note.note_type === 'whiteboard') return '画布笔记'
  if (note.content) {
    try {
      const clean = stripMarkdownToPreviewText(note.content) || ''
      const trimmed = clean.trim()
      if (trimmed) {
        const arr = Array.from(trimmed)
        return arr.slice(0, 9).join('') + (arr.length > 9 ? '…' : '')
      }
    } catch {}
  }
  return '无标题'
}

const normalizeTitle = (s) => String(s || '').trim().toLowerCase()

const addAlias = (aliasMap, alias, note, notesById) => {
  const key = normalizeTitle(alias)
  if (!key || key === '无标题' || key === 'untitled') return
  const existingId = aliasMap.get(key)
  if (!existingId) {
    aliasMap.set(key, note.id)
    return
  }
  const prev = notesById.get(existingId)
  const prevT = new Date(prev?.updated_at || prev?.created_at || 0)
  const curT = new Date(note.updated_at || note.created_at || 0)
  if (curT > prevT) aliasMap.set(key, note.id)
}

const firstContentAlias = (note) => {
  if (!note || typeof note.content !== 'string') return ''
  const line = note.content
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean)
  if (!line) return ''
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/^\[\[([^\]\n]+?)\]\]$/, '$1')
    .trim()
}

const getNoteAliases = (note) => {
  if (!note || note.note_type === 'whiteboard') return []
  const aliases = new Set()
  if (note.title) aliases.add(note.title)
  const firstLine = firstContentAlias(note)
  if (firstLine) aliases.add(firstLine)
  const display = deriveDisplayTitle(note).replace(/…$/, '')
  if (display && display !== '无标题' && display !== '画布笔记') aliases.add(display)
  return Array.from(aliases)
}

const buildGraph = (notes) => {
  const notesById = new Map(notes.filter(Boolean).map((n) => [n.id, n]))
  const aliasToId = new Map()
  notes.forEach((n) => {
    if (!n || !n.id || n.note_type === 'whiteboard') return
    getNoteAliases(n).forEach((alias) => addAlias(aliasToId, alias, n, notesById))
  })

  const validNodes = []
  notes.forEach((n) => {
    if (!n || !n.id) return
    const aliases = getNoteAliases(n)
    if (n.title && n.note_type !== 'whiteboard') {
      const winner = aliasToId.get(normalizeTitle(n.title))
      if (winner !== n.id) return
    }
    validNodes.push({
      id: n.id,
      title: deriveDisplayTitle(n),
      realTitle: n.title || '',
      aliases,
      isWhiteboard: n.note_type === 'whiteboard',
      hasTitle: !!n.title,
      isGhost: false,
      updatedAt: n.updated_at || n.created_at || 0,
    })
  })

  const idToIndex = new Map()
  validNodes.forEach((n, i) => idToIndex.set(n.id, i))

  const ghostByKey = new Map()
  const ensureGhost = (key, displayTitle) => {
    let idx = ghostByKey.get(key)
    if (idx != null) return idx
    idx = validNodes.length
    validNodes.push({
      id: `__ghost__:${key}`,
      title: displayTitle || key,
      realTitle: '',
      isWhiteboard: false,
      hasTitle: false,
      isGhost: true,
      updatedAt: 0,
    })
    ghostByKey.set(key, idx)
    return idx
  }

  const edgeSet = new Set()
  const edges = []
  notes.forEach((n) => {
    if (!n || !n.id) return
    if (n.note_type === 'whiteboard') return
    const fromA = idToIndex.get(n.id)
    if (fromA == null) return
    const text = typeof n.content === 'string' ? n.content : ''
    if (!text) return
    const targets = extractWikiTargets(text)
    if (targets.length === 0) return
    const seenInThisNote = new Set()
    targets.forEach((rawTarget) => {
      const targetKey = normalizeTitle(rawTarget)
      if (seenInThisNote.has(targetKey)) return
      seenInThisNote.add(targetKey)
      let toIndex
      const realToId = aliasToId.get(targetKey)
      if (realToId != null && realToId !== n.id && idToIndex.has(realToId)) {
        toIndex = idToIndex.get(realToId)
      } else if (realToId === n.id) {
        return
      } else {
        toIndex = ensureGhost(targetKey, rawTarget)
      }
      if (toIndex === fromA) return
      const lo = Math.min(fromA, toIndex)
      const hi = Math.max(fromA, toIndex)
      const key = `${lo}-${hi}`
      if (edgeSet.has(key)) return
      edgeSet.add(key)
      edges.push([fromA, toIndex])
    })
  })

  const degree = new Array(validNodes.length).fill(0)
  const adj = Array.from({ length: validNodes.length }, () => new Set())
  edges.forEach(([a, b]) => {
    degree[a]++
    degree[b]++
    adj[a].add(b)
    adj[b].add(a)
  })

  return { nodes: validNodes, edges, degree, adj }
}

const initialLayout = (n, w, h) => {
  const cx = w / 2, cy = h / 2
  const golden = Math.PI * (3 - Math.sqrt(5))
  const r = Math.min(w, h) * 0.4
  return Array.from({ length: n }, (_, i) => {
    const a = i * golden
    const rr = r * Math.sqrt((i + 1) / n)
    return { x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr, vx: 0, vy: 0, fixed: false }
  })
}

const stepForceLayout = (nodes, edges, w, h) => {
  const n = nodes.length
  if (n === 0) return
  const cx = w / 2, cy = h / 2
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = nodes[j].x - nodes[i].x
      const dy = nodes[j].y - nodes[i].y
      let d2 = dx * dx + dy * dy
      if (d2 < 0.01) d2 = 0.01
      const d = Math.sqrt(d2)
      const f = REPULSION / d2
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      nodes[i].vx -= fx
      nodes[i].vy -= fy
      nodes[j].vx += fx
      nodes[j].vy += fy
    }
  }
  edges.forEach(([a, b]) => {
    const dx = nodes[b].x - nodes[a].x
    const dy = nodes[b].y - nodes[a].y
    const d = Math.sqrt(dx * dx + dy * dy) || 0.01
    const diff = d - SPRING_LEN
    const f = SPRING_K * diff
    const fx = (dx / d) * f
    const fy = (dy / d) * f
    nodes[a].vx += fx
    nodes[a].vy += fy
    nodes[b].vx -= fx
    nodes[b].vy -= fy
  })
  for (let i = 0; i < n; i++) {
    if (nodes[i].fixed) {
      nodes[i].vx = 0
      nodes[i].vy = 0
      continue
    }
    nodes[i].vx += (cx - nodes[i].x) * CENTER_PULL
    nodes[i].vy += (cy - nodes[i].y) * CENTER_PULL
    nodes[i].vx *= DAMPING
    nodes[i].vy *= DAMPING
    nodes[i].x += nodes[i].vx
    nodes[i].y += nodes[i].vy
  }
}

const fuzzyMatch = (q, s) => {
  if (!q) return false
  const ql = q.toLowerCase()
  const sl = s.toLowerCase()
  if (sl.includes(ql)) return true
  let qi = 0
  for (let i = 0; i < sl.length && qi < ql.length; i++) {
    if (sl[i] === ql[qi]) qi++
  }
  return qi === ql.length
}

const GraphView = () => {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const notes = useStore((s) => s.notes)
  const selectedNoteId = useStore((s) => s.selectedNoteId)
  const setSelectedNoteId = useStore((s) => s.setSelectedNoteId)
  const setCurrentView = useStore((s) => s.setCurrentView)
  const createNote = useStore((s) => s.createNote)

  const containerRef = useRef(null)
  const svgRef = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hoverIdx, setHoverIdx] = useState(-1)
  const [pinIdx, setPinIdx] = useState(-1)
  const [dragIdx, setDragIdx] = useState(-1)
  const [pulseIdx, setPulseIdx] = useState(-1)
  const [, force] = useState(0)
  const positionsRef = useRef([])
  const rafRef = useRef(0)
  const dragRafRef = useRef(0)
  const framesRef = useRef(0)
  const pulseTimerRef = useRef(0)

  const [transform, setTransform] = useState({ tx: 0, ty: 0, s: 1 })
  const transformRef = useRef(transform)
  transformRef.current = transform

  const dragRef = useRef(null)

  const [search, setSearch] = useState('')
  const [hideOrphans, setHideOrphans] = useState(false)
  const [showGhosts, setShowGhosts] = useState(true)
  const [labelDensity, setLabelDensity] = useState(2)
  const [focusMode, setFocusMode] = useState('all')

  const fullGraph = useMemo(() => buildGraph(notes), [notes])

  const graph = useMemo(() => {
    let allowed = null
    if (focusMode === 'neighbors' && selectedNoteId) {
      const startIdx = fullGraph.nodes.findIndex((n) => n.id === selectedNoteId)
      if (startIdx >= 0) {
        const set = new Set([startIdx])
        let frontier = [startIdx]
        for (let depth = 0; depth < 2; depth++) {
          const next = []
          frontier.forEach((u) => {
            fullGraph.adj[u].forEach((v) => {
              if (!set.has(v)) { set.add(v); next.push(v) }
            })
          })
          frontier = next
          if (frontier.length === 0) break
        }
        allowed = set
      }
    }
    if (hideOrphans || allowed || !showGhosts) {
      const keep = new Set()
      fullGraph.nodes.forEach((n, i) => {
        if (allowed && !allowed.has(i)) return
        if (hideOrphans && fullGraph.degree[i] === 0) return
        if (!showGhosts && n.isGhost) return
        keep.add(i)
      })
      const oldToNew = new Map()
      const nodes = []
      let k = 0
      fullGraph.nodes.forEach((n, i) => {
        if (!keep.has(i)) return
        oldToNew.set(i, k++)
        nodes.push(n)
      })
      const edges = []
      fullGraph.edges.forEach(([a, b]) => {
        if (keep.has(a) && keep.has(b)) edges.push([oldToNew.get(a), oldToNew.get(b)])
      })
      const degree = new Array(nodes.length).fill(0)
      const adj = Array.from({ length: nodes.length }, () => new Set())
      edges.forEach(([a, b]) => {
        degree[a]++; degree[b]++
        adj[a].add(b); adj[b].add(a)
      })
      return { nodes, edges, degree, adj }
    }
    return fullGraph
  }, [fullGraph, hideOrphans, focusMode, selectedNoteId, showGhosts])

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setSize({ w: r.width, h: r.height })
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const restart = useCallback(() => {
    if (size.w === 0 || size.h === 0) return
    positionsRef.current = initialLayout(graph.nodes.length, size.w, size.h)
    framesRef.current = 0
    setTransform({ tx: 0, ty: 0, s: 1 })
    cancelAnimationFrame(rafRef.current)
    cancelAnimationFrame(dragRafRef.current)
    dragRafRef.current = 0
    const tick = () => {
      stepForceLayout(positionsRef.current, graph.edges, size.w, size.h)
      framesRef.current += 1
      force((x) => (x + 1) % 1000)
      if (framesRef.current < MAX_FRAMES) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [graph, size])

  useEffect(() => {
    restart()
    return () => {
      cancelAnimationFrame(rafRef.current)
      cancelAnimationFrame(dragRafRef.current)
    }
  }, [restart])

  useEffect(() => () => clearTimeout(pulseTimerRef.current), [])

  const selectedIdx = useMemo(() => {
    if (!selectedNoteId) return -1
    return graph.nodes.findIndex((n) => n.id === selectedNoteId)
  }, [graph, selectedNoteId])

  const matchedSet = useMemo(() => {
    const set = new Set()
    if (!search.trim()) return set
    graph.nodes.forEach((n, i) => {
      const pool = [n.title, n.realTitle, ...(n.aliases || [])].filter(Boolean)
      if (pool.some((s) => fuzzyMatch(search.trim(), s))) set.add(i)
    })
    return set
  }, [graph, search])

  const focusIdx = dragIdx >= 0 ? dragIdx : hoverIdx >= 0 ? hoverIdx : pinIdx >= 0 ? pinIdx : selectedIdx
  const focusNeighbors = useMemo(() => {
    if (focusIdx < 0) return null
    const set = new Set([focusIdx])
    graph.adj[focusIdx]?.forEach((v) => set.add(v))
    return set
  }, [focusIdx, graph])

  const handleNodeClick = (idx) => {
    clearTimeout(pulseTimerRef.current)
    setPulseIdx(idx)
    pulseTimerRef.current = setTimeout(() => setPulseIdx(-1), 520)
    setPinIdx((cur) => (cur === idx ? -1 : idx))
  }
  const handleNodeDblClick = async (idx) => {
    const node = graph.nodes[idx]
    if (!node) return
    if (node.isGhost) {
      try {
        const r = await createNote({ title: node.title, content: '' })
        if (r?.success && r.data?.id) {
          setSelectedNoteId(r.data.id)
          setCurrentView('notes')
        }
      } catch {}
      return
    }
    setSelectedNoteId(node.id)
    setCurrentView('notes')
  }

  const handleWheel = useCallback((e) => {
    if (!svgRef.current) return
    e.preventDefault()
    const rect = svgRef.current.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const cur = transformRef.current
    const factor = Math.exp(-e.deltaY * 0.0015)
    const nextS = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cur.s * factor))
    if (nextS === cur.s) return
    const worldX = (mx - cur.tx) / cur.s
    const worldY = (my - cur.ty) / cur.s
    setTransform({ tx: mx - worldX * nextS, ty: my - worldY * nextS, s: nextS })
  }, [])

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e) => handleWheel(e)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [handleWheel])

  const startDragSimulation = useCallback(() => {
    if (dragRafRef.current || size.w === 0 || size.h === 0) return
    cancelAnimationFrame(rafRef.current)
    const tick = () => {
      const drag = dragRef.current
      if (!drag || drag.mode !== 'node') {
        dragRafRef.current = 0
        return
      }
      const pos = positionsRef.current[drag.idx]
      if (pos) {
        const targetX = drag.targetX ?? pos.x
        const targetY = drag.targetY ?? pos.y
        pos.x += (targetX - pos.x) * DRAG_FOLLOW
        pos.y += (targetY - pos.y) * DRAG_FOLLOW
        pos.vx = 0
        pos.vy = 0
      }
      stepForceLayout(positionsRef.current, graph.edges, size.w, size.h)
      force((x) => (x + 1) % 1000)
      dragRafRef.current = requestAnimationFrame(tick)
    }
    dragRafRef.current = requestAnimationFrame(tick)
  }, [graph.edges, size.w, size.h])

  const handleMouseDownBg = (e) => {
    if (e.button !== 0) return
    setPinIdx(-1)
    setDragIdx(-1)
    dragRef.current = {
      mode: 'pan',
      startX: e.clientX,
      startY: e.clientY,
      origTx: transformRef.current.tx,
      origTy: transformRef.current.ty,
      didMove: false,
    }
  }
  const handleMouseDownNode = (e, idx) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const pos = positionsRef.current[idx]
    if (!pos) return
    pos.fixed = true
    setDragIdx(idx)
    setHoverIdx(idx)
    dragRef.current = {
      mode: 'node',
      idx,
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
      targetX: pos.x,
      targetY: pos.y,
      didMove: false,
    }
    startDragSimulation()
  }

  useEffect(() => {
    const onMove = (e) => {
      const drag = dragRef.current
      if (!drag) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.didMove = true
      if (drag.mode === 'pan') {
        setTransform((t) => ({ ...t, tx: drag.origTx + dx, ty: drag.origTy + dy }))
      } else if (drag.mode === 'node') {
        const s = transformRef.current.s || 1
        drag.targetX = drag.origX + dx / s
        drag.targetY = drag.origY + dy / s
      }
    }
    const onUp = () => {
      const drag = dragRef.current
      if (!drag) return
      if (drag.mode === 'node') {
        const pos = positionsRef.current[drag.idx]
        cancelAnimationFrame(dragRafRef.current)
        dragRafRef.current = 0
        if (pos) {
          pos.x = drag.targetX ?? pos.x
          pos.y = drag.targetY ?? pos.y
          pos.fixed = false
        }
        setDragIdx(-1)
        setHoverIdx(-1)
        cancelAnimationFrame(rafRef.current)
        framesRef.current = Math.max(0, MAX_FRAMES - DRAG_RELAX_FRAMES)
        const tick = () => {
          stepForceLayout(positionsRef.current, graph.edges, size.w, size.h)
          framesRef.current += 1
          force((x) => (x + 1) % 1000)
          if (framesRef.current < MAX_FRAMES) {
            rafRef.current = requestAnimationFrame(tick)
          }
        }
        rafRef.current = requestAnimationFrame(tick)
        if (!drag.didMove) handleNodeClick(drag.idx)
      }
      dragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      cancelAnimationFrame(dragRafRef.current)
      dragRafRef.current = 0
      setDragIdx(-1)
    }
  }, [graph.edges, size.w, size.h])

  const zoomBy = (factor) => {
    const cur = transformRef.current
    const cx = size.w / 2
    const cy = size.h / 2
    const nextS = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cur.s * factor))
    if (nextS === cur.s) return
    const worldX = (cx - cur.tx) / cur.s
    const worldY = (cy - cur.ty) / cur.s
    setTransform({ tx: cx - worldX * nextS, ty: cy - worldY * nextS, s: nextS })
  }

  const centerOn = useCallback((idx) => {
    if (idx < 0) return
    const pos = positionsRef.current[idx]
    if (!pos) return
    const s = transformRef.current.s
    setTransform({ tx: size.w / 2 - pos.x * s, ty: size.h / 2 - pos.y * s, s })
  }, [size])

  const firstMatchIdx = useMemo(() => {
    if (matchedSet.size === 0) return -1
    return Array.from(matchedSet)[0]
  }, [matchedSet])
  useEffect(() => {
    if (firstMatchIdx >= 0) centerOn(firstMatchIdx)
  }, [firstMatchIdx])

  const palette = theme.palette
  const linkBase = isDark ? 'rgba(148,163,184,0.34)' : 'rgba(51,65,85,0.28)'
  const linkHi = palette.primary.main
  const linkGhost = isDark ? 'rgba(148,163,184,0.24)' : 'rgba(100,116,139,0.24)'
  const labelColor = palette.text.secondary
  const labelStrong = palette.text.primary
  const dimAlpha = 0.18
  const realNodeCount = graph.nodes.filter((n) => !n.isGhost).length
  const ghostNodeCount = graph.nodes.length - realNodeCount
  const noTitleCount = graph.nodes.filter((n) => !n.isGhost && !n.hasTitle).length
  const iconButtonSx = {
    width: 32,
    height: 32,
    ...floatingGlassSx({ radius: GRAPH_PANEL_RADIUS, shadow: 'default' }),
    transition: 'transform 160ms ease, border-color 160ms ease, background-color 160ms ease',
    '&:hover': {
      transform: 'translateY(-1px)',
      borderColor: 'primary.main',
    },
  }

  const positions = positionsRef.current

  const computeNodeR = (deg) => Math.min(NODE_MAX_R, NODE_BASE_R + deg * NODE_DEG_R)
  const labelVisible = (idx) => {
    if (focusIdx >= 0 && focusNeighbors?.has(idx)) return true
    if (matchedSet.has(idx)) return true
    if (idx === pinIdx || idx === selectedIdx) return true
    if (idx === hoverIdx) return true
    if (labelDensity === 0) return false
    if (labelDensity === 3) return true
    if (labelDensity === 2) return graph.degree[idx] >= 1
    return graph.degree[idx] >= 3
  }

  const getNodeAlpha = (idx) => {
    if (matchedSet.size > 0) return matchedSet.has(idx) ? 1 : dimAlpha
    if (focusIdx >= 0) return focusNeighbors?.has(idx) ? 1 : dimAlpha
    return 1
  }
  const getEdgeAlpha = (a, b) => {
    if (matchedSet.size > 0) {
      return matchedSet.has(a) && matchedSet.has(b) ? 0.9 : dimAlpha * 0.6
    }
    if (focusIdx >= 0) {
      const inSel = focusNeighbors?.has(a) && focusNeighbors?.has(b) && (a === focusIdx || b === focusIdx)
      return inSel ? 1 : dimAlpha * 0.6
    }
    return 0.55
  }
  const getEdgeStroke = (a, b) => {
    if (focusIdx >= 0 && (a === focusIdx || b === focusIdx)) return linkHi
    if (graph.nodes[a]?.isGhost || graph.nodes[b]?.isGhost) return linkGhost
    return linkBase
  }
  const getEdgeDash = (a, b) => (graph.nodes[a]?.isGhost || graph.nodes[b]?.isGhost ? '4 4' : undefined)
  const getNodeFill = (idx) => {
    const node = graph.nodes[idx]
    if (node?.isGhost) {
      return isDark ? 'hsl(220, 10%, 45%)' : 'hsl(220, 12%, 70%)'
    }
    if (node?.isWhiteboard) {
      return isDark ? 'hsl(170, 55%, 55%)' : 'hsl(170, 50%, 45%)'
    }
    const deg = graph.degree[idx]
    const hue = degreeToHue(deg)
    const sat = isDark ? '70%' : '65%'
    const lit = isDark ? '60%' : '50%'
    return `hsl(${hue}, ${sat}, ${lit})`
  }
  const getNodeStrokeDash = (idx) => {
    const node = graph.nodes[idx]
    if (node?.isGhost) return '3 3'
    return node?.hasTitle ? null : '2 2'
  }

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', bgcolor: 'background.default' }}>
      <Box sx={{ position: 'absolute', top: 12, left: 16, zIndex: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <HubIcon sx={{ color: 'primary.main', fontSize: 18 }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          知识图谱
        </Typography>
        <Chip size="small" label={`${realNodeCount} 笔记`} sx={{ height: 22, fontSize: 11 }} />
        <Chip size="small" label={`${graph.edges.length} 链接`} sx={{ height: 22, fontSize: 11 }} />
        {ghostNodeCount > 0 && (
          <Chip
            size="small"
            label={`${ghostNodeCount} 未解析`}
            sx={{ height: 22, fontSize: 11, bgcolor: 'transparent', border: `1px dashed ${theme.palette.divider}` }}
          />
        )}
        {noTitleCount > 0 && (
          <Chip
            size="small"
            label={`${noTitleCount} 未命名`}
            sx={{ height: 22, fontSize: 11, bgcolor: 'transparent', color: 'text.secondary' }}
          />
        )}
        {hoverIdx >= 0 && graph.nodes[hoverIdx] && (
          <Chip
            size="small"
            color="primary"
            variant="outlined"
            label={`${graph.nodes[hoverIdx].title} · 度 ${graph.degree[hoverIdx]}`}
            sx={{ height: 22, fontSize: 11, maxWidth: 320 }}
          />
        )}
      </Box>

      <Box sx={{ position: 'absolute', top: 8, right: 12, zIndex: 2, display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <TextField
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索节点…"
          sx={{
            width: 200,
            '& .MuiOutlinedInput-root': {
              ...floatingGlassSx({ radius: GRAPH_PANEL_RADIUS, shadow: 'default' }),
              fontSize: 13,
              height: 32,
              '& fieldset': { border: 'none' },
            },
          }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                </InputAdornment>
              ),
            },
          }}
        />
        <Tooltip title="放大">
          <IconButton size="small" onClick={() => zoomBy(1.2)} sx={iconButtonSx}>
            <ZoomInIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="缩小">
          <IconButton size="small" onClick={() => zoomBy(1 / 1.2)} sx={iconButtonSx}>
            <ZoomOutIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={selectedIdx >= 0 ? '居中当前笔记' : '当前未选中笔记'}>
          <span>
            <IconButton size="small" onClick={() => centerOn(selectedIdx)} disabled={selectedIdx < 0} sx={iconButtonSx}>
              <CenterFocusStrongIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="重新布局">
          <IconButton size="small" onClick={restart} sx={iconButtonSx}>
            <RestartAltIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Box
        sx={{
          position: 'absolute',
          left: 16,
          bottom: 16,
          zIndex: 2,
          p: 1.25,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          width: 240,
          ...floatingGlassSx({ radius: GRAPH_PANEL_RADIUS, shadow: 'menu' }),
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary' }}>
            视图
          </Typography>
          <ToggleButtonGroup
            size="small"
            value={focusMode}
            exclusive
            onChange={(_, v) => v && setFocusMode(v)}
            sx={{ '& .MuiToggleButton-root': { px: 1, py: 0.25, fontSize: 11, borderRadius: GRAPH_ITEM_RADIUS, textTransform: 'none' } }}
          >
            <ToggleButton value="all">全部</ToggleButton>
            <ToggleButton value="neighbors" disabled={selectedIdx < 0}>邻居</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>隐藏孤立节点</Typography>
          <ToggleButton
            size="small"
            value="check"
            selected={hideOrphans}
            onChange={() => setHideOrphans((v) => !v)}
            sx={{ px: 1, py: 0.25, fontSize: 11, borderRadius: GRAPH_ITEM_RADIUS, textTransform: 'none' }}
          >
            {hideOrphans ? '已隐藏' : '显示'}
          </ToggleButton>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>显示未解析节点</Typography>
          <ToggleButton
            size="small"
            value="check"
            selected={showGhosts}
            onChange={() => setShowGhosts((v) => !v)}
            sx={{ px: 1, py: 0.25, fontSize: 11, borderRadius: GRAPH_ITEM_RADIUS, textTransform: 'none' }}
          >
            {showGhosts ? '显示' : '隐藏'}
          </ToggleButton>
        </Box>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.25 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>标签密度</Typography>
            <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 11 }}>
              {['仅 hover', '度数 ≥ 3', '度数 ≥ 1', '全部'][labelDensity]}
            </Typography>
          </Box>
          <Slider
            size="small"
            min={0}
            max={3}
            step={1}
            value={labelDensity}
            onChange={(_, v) => setLabelDensity(v)}
            marks
            sx={{ py: 0.5 }}
          />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25, color: 'text.disabled' }}>
          <CategoryIcon sx={{ fontSize: 13 }} />
          <Typography variant="caption" sx={{ fontSize: 10.5 }}>
            点击锚定 · 双击跳转/新建 · 拖拽节点 · 滚轮缩放
          </Typography>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75, pt: 0.25 }}>
          {[
            ['实节点', 'solid', isDark ? 'hsl(220, 70%, 60%)' : 'hsl(220, 65%, 50%)'],
            ['未命名', '2 2', isDark ? 'hsl(260, 70%, 60%)' : 'hsl(260, 65%, 50%)'],
            ['未解析', '3 3', isDark ? 'hsl(220, 10%, 45%)' : 'hsl(220, 12%, 70%)'],
            ['白板', 'solid', isDark ? 'hsl(170, 55%, 55%)' : 'hsl(170, 50%, 45%)'],
          ].map(([label, dash, color]) => (
            <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
              <Box
                component="span"
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: color,
                  border: '1px solid',
                  borderColor: 'background.paper',
                  outline: dash === 'solid' ? 'none' : `1px dashed ${theme.palette.text.disabled}`,
                }}
              />
              <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 10.5 }}>
                {label}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      <Box ref={containerRef} sx={{ position: 'absolute', inset: 0 }}>
        {graph.nodes.length === 0 ? (
          <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary' }}>
            <Typography variant="body2">
              {focusMode === 'neighbors'
                ? '当前笔记没有邻居，切换到"全部"看看'
                : hideOrphans
                  ? '没有任何带链接的笔记，写两条 [[xxx]] 试试'
                  : '还没有任何笔记，写两条 [[xxx]] 试试'}
            </Typography>
          </Box>
        ) : positions.length === graph.nodes.length ? (
          <>
            {graph.edges.length === 0 && (
              <Box
                sx={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  zIndex: 1,
                  px: 2,
                  py: 1.25,
                  textAlign: 'center',
                  ...floatingGlassSx({ radius: GRAPH_PANEL_RADIUS, shadow: 'default' }),
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.25 }}>
                  还没有检测到图谱连接
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  在笔记中写入 [[笔记名]] 后，这里会显示引用边；未创建的目标会显示为虚线幽灵节点。
                </Typography>
              </Box>
            )}
            <svg
              ref={svgRef}
              width={size.w}
              height={size.h}
              style={{
                display: 'block',
                cursor: dragRef.current?.mode === 'pan' ? 'grabbing' : 'grab',
                userSelect: 'none',
              }}
              onMouseDown={handleMouseDownBg}
            >
              <defs>
                <radialGradient id="node-glow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor={palette.primary.main} stopOpacity="0.45" />
                  <stop offset="100%" stopColor={palette.primary.main} stopOpacity="0" />
                </radialGradient>
              </defs>
              <g transform={`translate(${transform.tx}, ${transform.ty}) scale(${transform.s})`}>
                <g>
                  {graph.edges.map(([a, b], i) => {
                    const pa = positions[a]
                    const pb = positions[b]
                    if (!pa || !pb) return null
                    const stroke = getEdgeStroke(a, b)
                    const op = getEdgeAlpha(a, b)
                    const w = (focusIdx >= 0 && (a === focusIdx || b === focusIdx)) ? 1.8 : 1.15
                    return (
                      <line
                        key={i}
                        x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                        stroke={stroke}
                        strokeOpacity={op}
                        strokeWidth={w / transform.s}
                        strokeLinecap="round"
                        strokeDasharray={getEdgeDash(a, b)}
                      />
                    )
                  })}
                </g>
                <g>
                  {graph.nodes.map((node, idx) => {
                    const p = positions[idx]
                    if (!p) return null
                    const r = computeNodeR(graph.degree[idx])
                    const fill = getNodeFill(idx)
                    const a = getNodeAlpha(idx)
                    const isHi = idx === dragIdx || idx === hoverIdx || idx === pinIdx || idx === selectedIdx || matchedSet.has(idx)
                    return (
                      <g
                        key={node.id}
                        transform={`translate(${p.x}, ${p.y})`}
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={() => {
                          const drag = dragRef.current
                          if (drag?.mode === 'node' && drag.idx !== idx) return
                          setHoverIdx(idx)
                        }}
                        onMouseLeave={() => {
                          const drag = dragRef.current
                          if (drag?.mode === 'node') return
                          setHoverIdx(-1)
                        }}
                        onMouseDown={(e) => handleMouseDownNode(e, idx)}
                        onDoubleClick={() => handleNodeDblClick(idx)}
                      >
                        {isHi && (
                          <circle
                            r={r * 2.4}
                            fill="url(#node-glow)"
                            opacity={a}
                          />
                        )}
                        {pulseIdx === idx && (
                          <circle
                            r={r * 1.1}
                            fill="none"
                            stroke={palette.primary.main}
                            strokeWidth={2 / transform.s}
                            opacity={0.48}
                          >
                            <animate attributeName="r" from={r * 1.1} to={r * 3.3} dur="520ms" fill="freeze" />
                            <animate attributeName="opacity" from="0.48" to="0" dur="520ms" fill="freeze" />
                          </circle>
                        )}
                        <circle
                          r={r}
                          fill={fill}
                          stroke={idx === selectedIdx ? palette.primary.main : palette.background.paper}
                          strokeWidth={(idx === selectedIdx ? 2.5 : 1.5) / transform.s}
                          strokeDasharray={getNodeStrokeDash(idx) || undefined}
                          opacity={a}
                        />
                        {labelVisible(idx) && (
                          <text
                            x={r + 5}
                            y={4}
                            fontSize={(isHi ? 12 : 11) / transform.s}
                            fontWeight={isHi ? 700 : 500}
                            fill={isHi ? labelStrong : labelColor}
                            opacity={a}
                            style={{ pointerEvents: 'none', userSelect: 'none' }}
                          >
                            {node.title}
                          </text>
                        )}
                      </g>
                    )
                  })}
                </g>
              </g>
            </svg>
          </>
        ) : null}
      </Box>
    </Box>
  )
}

export default GraphView
