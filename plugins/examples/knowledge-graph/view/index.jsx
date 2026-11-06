// 知识图谱：把笔记之间的关联画成一张图，点一个节点看它连着什么，双击打开。
// 关联来自三处：[[双链]]、插入的笔记 / 画布链接、相同的标签——不写双链的笔记也能连起来。
// 视图由插件 surface "main:view" 注入主区域，通过 globalThis.__flotaHost__ 取宿主的 React / MUI / store 单例。
import { extractAppReferences, extractWikiTargets, parseNoteTags } from './linkGraph.js'

const host = globalThis.__flotaHost__
if (!host) throw new Error('Flota host not ready')

const { React, MaterialUI, MaterialIcons, MuiStyles, store, utils, components = {} } = host
const { useEffect, useMemo, useRef, useState, useCallback } = React
const {
  Box, Typography, IconButton, Tooltip, TextField, InputAdornment, Button, ButtonBase,
  Popover, FormControlLabel, Checkbox, Divider,
} = MaterialUI
const { useTheme, alpha } = MuiStyles
const { useStore } = store
const { stripMarkdownToPreviewText, glassSx, floatingGlassSx } = utils
const SegmentedControl = components.SegmentedControl

const Icons = {
  Search: MaterialIcons.Search,
  Filter: MaterialIcons.FilterListRounded || MaterialIcons.FilterList,
  ZoomIn: MaterialIcons.AddRounded || MaterialIcons.ZoomIn,
  ZoomOut: MaterialIcons.RemoveRounded || MaterialIcons.ZoomOut,
  Fit: MaterialIcons.FitScreenRounded || MaterialIcons.FitScreen || MaterialIcons.ZoomOutMap,
  Close: MaterialIcons.CloseRounded || MaterialIcons.Close,
  Open: MaterialIcons.OpenInNewRounded || MaterialIcons.Launch,
  Graph: MaterialIcons.HubRounded || MaterialIcons.Hub,
}

// ── 力导向布局参数 ──────────────────────────────────────────────
const REPULSION = 1600
const SPRING_K = 0.05
const SPRING_LEN = { wiki: 100, ref: 100, tag: 80 }
const CENTER_PULL = 0.01
const DAMPING = 0.85
const MAX_FRAMES = 300
const DRAG_FOLLOW = 0.42
const DRAG_RELAX_FRAMES = 100
const MIN_SCALE = 0.2
const MAX_SCALE = 5
// 节点不多时所有名字都显示；多了只显示连接最多的几个，放大后再显示全部
const LABEL_ALL_BELOW = 40
const LABEL_TOP = 14
const LABEL_ALL_SCALE = 1.4

const RELATION_LABEL = { wiki: '双链', ref: '引用', tag: '标签' }

const panelSx = (theme) => (glassSx
  ? glassSx(theme, 'popover', { radius: 'md' })
  : floatingGlassSx({ radius: '12px' }))

// ── 数据：笔记 → 节点和关联 ──────────────────────────────────────

const displayTitle = (note) => {
  if (!note) return '无标题'
  const title = String(note.title || '').trim()
  if (title && title !== '无标题' && title !== 'Untitled') return title
  if (note.note_type === 'whiteboard') return '未命名画布'
  try {
    const text = (stripMarkdownToPreviewText(note.content || '') || '').trim()
    if (text) {
      const chars = Array.from(text)
      return chars.slice(0, 12).join('') + (chars.length > 12 ? '…' : '')
    }
  } catch { /* 显示为无标题 */ }
  return '无标题'
}

const excerptOf = (note) => {
  if (!note || note.note_type === 'whiteboard') return ''
  try {
    const text = (stripMarkdownToPreviewText(note.content || '') || '').replace(/\s+/g, ' ').trim()
    return text.length > 140 ? `${text.slice(0, 140)}…` : text
  } catch { return '' }
}

const normalize = (value) => String(value || '').trim().toLowerCase()

const firstLineAlias = (note) => {
  const line = String(note?.content || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean)
  return line ? line.replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '').trim() : ''
}

const buildGraph = (notes, { showTags, showGhosts }) => {
  const nodes = []
  const indexById = new Map()
  const aliasToIndex = new Map()
  const refToIndex = new Map()

  notes.forEach((note) => {
    if (!note?.id || note.is_deleted) return
    const index = nodes.length
    nodes.push({
      key: `note:${note.id}`,
      kind: note.note_type === 'whiteboard' ? 'whiteboard' : 'note',
      title: displayTitle(note),
      note,
    })
    indexById.set(String(note.id), index)
    refToIndex.set(String(note.id), index)
    if (note.sync_id) refToIndex.set(String(note.sync_id), index)
    {
      // 双链按标题解析，同名时取最近修改的那篇；笔记还认第一行，兼容没写标题的笔记
      ;[note.title, note.note_type === 'whiteboard' ? '' : firstLineAlias(note)].forEach((alias) => {
        const key = normalize(alias)
        if (!key || key === '无标题' || key === 'untitled') return
        const existing = aliasToIndex.get(key)
        const newer = !existing || new Date(note.updated_at || 0) > new Date(nodes[existing].note.updated_at || 0)
        if (newer) aliasToIndex.set(key, index)
      })
    }
  })

  const edges = []
  const edgeKeys = new Set()
  const addEdge = (a, b, kind) => {
    if (a === b || a == null || b == null) return
    const key = a < b ? `${a}-${b}` : `${b}-${a}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push({ a, b, kind })
  }

  const ghostIndex = new Map()
  const tagIndex = new Map()
  const noteCount = nodes.length
  for (let from = 0; from < noteCount; from += 1) {
    const { note } = nodes[from]
    if (note.note_type === 'whiteboard') continue
    const content = typeof note.content === 'string' ? note.content : ''
    extractWikiTargets(content).forEach((target) => {
      const key = normalize(target)
      let to = aliasToIndex.get(key)
      if (to == null) {
        if (!showGhosts) return
        to = ghostIndex.get(key)
        if (to == null) {
          to = nodes.length
          nodes.push({ key: `ghost:${key}`, kind: 'ghost', title: target })
          ghostIndex.set(key, to)
        }
      }
      addEdge(from, to, 'wiki')
    })
    extractAppReferences(content).forEach((reference) => addEdge(from, refToIndex.get(String(reference)), 'ref'))
    if (showTags) {
      parseNoteTags(note.tags).forEach((tag) => {
        const key = normalize(tag)
        let to = tagIndex.get(key)
        if (to == null) {
          to = nodes.length
          nodes.push({ key: `tag:${key}`, kind: 'tag', title: tag })
          tagIndex.set(key, to)
        }
        addEdge(from, to, 'tag')
      })
    }
  }

  const degree = new Array(nodes.length).fill(0)
  const adjacency = Array.from({ length: nodes.length }, () => new Map())
  edges.forEach(({ a, b, kind }) => {
    degree[a] += 1
    degree[b] += 1
    adjacency[a].set(b, kind)
    adjacency[b].set(a, kind)
  })
  return { nodes, edges, degree, adjacency }
}

/** 只保留一部分节点（局部图、隐藏孤立笔记），下标重新编号 */
const subgraph = (graph, keep) => {
  const remap = new Map()
  const nodes = []
  graph.nodes.forEach((node, index) => {
    if (!keep(index)) return
    remap.set(index, nodes.length)
    nodes.push(node)
  })
  const edges = graph.edges
    .filter(({ a, b }) => remap.has(a) && remap.has(b))
    .map(({ a, b, kind }) => ({ a: remap.get(a), b: remap.get(b), kind }))
  const degree = new Array(nodes.length).fill(0)
  const adjacency = Array.from({ length: nodes.length }, () => new Map())
  edges.forEach(({ a, b, kind }) => {
    degree[a] += 1
    degree[b] += 1
    adjacency[a].set(b, kind)
    adjacency[b].set(a, kind)
  })
  return { nodes, edges, degree, adjacency }
}

// ── 布局 ─────────────────────────────────────────────────────────

const initialLayout = (count, w, h, previous) => {
  const cx = w / 2
  const cy = h / 2
  const golden = Math.PI * (3 - Math.sqrt(5))
  const radius = Math.min(w, h) * 0.38
  return Array.from({ length: count }, (_, i) => {
    const kept = previous?.[i]
    if (kept) return { ...kept, vx: 0, vy: 0, fixed: false }
    const angle = i * golden
    const r = radius * Math.sqrt((i + 1) / count)
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, vx: 0, vy: 0, fixed: false }
  })
}

const stepLayout = (positions, edges, w, h) => {
  const n = positions.length
  if (!n) return
  const cx = w / 2
  const cy = h / 2
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const dx = positions[j].x - positions[i].x
      const dy = positions[j].y - positions[i].y
      const d2 = Math.max(0.01, dx * dx + dy * dy)
      const d = Math.sqrt(d2)
      const f = REPULSION / d2
      positions[i].vx -= (dx / d) * f
      positions[i].vy -= (dy / d) * f
      positions[j].vx += (dx / d) * f
      positions[j].vy += (dy / d) * f
    }
  }
  edges.forEach(({ a, b, kind }) => {
    const dx = positions[b].x - positions[a].x
    const dy = positions[b].y - positions[a].y
    const d = Math.sqrt(dx * dx + dy * dy) || 0.01
    const f = SPRING_K * (d - SPRING_LEN[kind])
    positions[a].vx += (dx / d) * f
    positions[a].vy += (dy / d) * f
    positions[b].vx -= (dx / d) * f
    positions[b].vy -= (dy / d) * f
  })
  positions.forEach((p) => {
    if (p.fixed) { p.vx = 0; p.vy = 0; return }
    p.vx = (p.vx + (cx - p.x) * CENTER_PULL) * DAMPING
    p.vy = (p.vy + (cy - p.y) * CENTER_PULL) * DAMPING
    p.x += p.vx
    p.y += p.vy
  })
}

const nodeRadius = (node, degree) => {
  if (node.kind === 'tag') return 3.5
  return Math.min(14, 4 + Math.sqrt(degree) * 2.2)
}

const relativeTime = (value) => {
  const time = new Date(value || 0).getTime()
  if (!time) return ''
  const minutes = Math.round((Date.now() - time) / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(time).toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' })
}

// ── 视图 ─────────────────────────────────────────────────────────

const GraphView = () => {
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const notes = useStore((s) => s.notes)
  const selectedNoteId = useStore((s) => s.selectedNoteId)
  const setSelectedNoteId = useStore((s) => s.setSelectedNoteId)
  const setCurrentView = useStore((s) => s.setCurrentView)
  const createNote = useStore((s) => s.createNote)
  const focusRequest = useStore((s) => s.graphFocusRequest)

  const [scope, setScope] = useState('all')
  const [showTags, setShowTags] = useState(true)
  const [showOrphans, setShowOrphans] = useState(true)
  const [showGhosts, setShowGhosts] = useState(true)
  const [filterAnchor, setFilterAnchor] = useState(null)
  const [search, setSearch] = useState('')
  const [activeKey, setActiveKey] = useState(null)
  const [hoverIndex, setHoverIndex] = useState(-1)
  const [dragIndex, setDragIndex] = useState(-1)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [transform, setTransform] = useState({ tx: 0, ty: 0, s: 1 })
  const [, redraw] = useState(0)

  const containerRef = useRef(null)
  const svgRef = useRef(null)
  const positionsRef = useRef([])
  const layoutKeysRef = useRef([])
  const rafRef = useRef(0)
  const framesRef = useRef(0)
  const dragRef = useRef(null)
  const transformRef = useRef(transform)
  transformRef.current = transform
  const userMovedRef = useRef(false)

  // 「在图谱中查看」：从笔记跳过来时只看这篇笔记周围
  useEffect(() => {
    if (!focusRequest?.noteId) return
    setScope('local')
    setActiveKey(`note:${focusRequest.noteId}`)
    useStore.setState({ graphFocusRequest: null })
  }, [focusRequest])

  const fullGraph = useMemo(() => buildGraph(notes, { showTags, showGhosts }), [notes, showTags, showGhosts])
  const currentNoteIndex = useMemo(
    () => fullGraph.nodes.findIndex((node) => node.key === `note:${selectedNoteId}`),
    [fullGraph, selectedNoteId],
  )

  const graph = useMemo(() => {
    if (scope === 'local') {
      const start = currentNoteIndex
      if (start < 0) return subgraph(fullGraph, () => false)
      // 当前笔记两步之内；经过标签只走一步，不然一个大标签会把整张图拉进来
      const keep = new Set([start])
      let frontier = [start]
      for (let depth = 0; depth < 2; depth += 1) {
        const next = []
        frontier.forEach((index) => fullGraph.adjacency[index].forEach((kind, neighbor) => {
          if (keep.has(neighbor)) return
          if (depth === 1 && (kind === 'tag' || fullGraph.nodes[index].kind === 'tag')) return
          keep.add(neighbor)
          next.push(neighbor)
        }))
        frontier = next
      }
      return subgraph(fullGraph, (index) => keep.has(index))
    }
    if (!showOrphans) return subgraph(fullGraph, (index) => fullGraph.degree[index] > 0)
    return fullGraph
  }, [fullGraph, scope, currentNoteIndex, showOrphans])

  const noteCount = graph.nodes.filter((node) => node.kind === 'note' || node.kind === 'whiteboard').length
  const linkCount = graph.edges.filter((edge) => edge.kind !== 'tag').length
  const tagCount = graph.nodes.filter((node) => node.kind === 'tag').length

  // ── 尺寸与布局 ──
  useEffect(() => {
    if (!containerRef.current) return undefined
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }))
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const fitToContent = useCallback(() => {
    const points = positionsRef.current
    if (!points.length || !size.w || !size.h) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    points.forEach((p) => {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    })
    const padX = 120
    const padY = 90
    const s = Math.max(MIN_SCALE, Math.min(2.2, (size.w - padX * 2) / Math.max(1, maxX - minX), (size.h - padY * 2) / Math.max(1, maxY - minY)))
    setTransform({ tx: size.w / 2 - ((minX + maxX) / 2) * s, ty: size.h / 2 - ((minY + maxY) / 2) * s, s })
  }, [size])
  const fitRef = useRef(fitToContent)
  fitRef.current = fitToContent

  const runLayout = useCallback((frames = MAX_FRAMES, { fit = true } = {}) => {
    cancelAnimationFrame(rafRef.current)
    framesRef.current = MAX_FRAMES - frames
    const tick = () => {
      stepLayout(positionsRef.current, graph.edges, size.w, size.h)
      framesRef.current += 1
      redraw((x) => (x + 1) % 1000)
      if (framesRef.current < MAX_FRAMES) rafRef.current = requestAnimationFrame(tick)
      else if (fit && !userMovedRef.current) fitRef.current()
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [graph, size])

  // 图变了：已有节点保留位置，新节点放到初始位置，再跑一轮
  useEffect(() => {
    if (!size.w || !size.h) return undefined
    const previous = new Map(layoutKeysRef.current.map((key, i) => [key, positionsRef.current[i]]))
    const kept = graph.nodes.map((node) => previous.get(node.key))
    const reused = kept.filter(Boolean).length
    positionsRef.current = initialLayout(graph.nodes.length, size.w, size.h, kept)
    layoutKeysRef.current = graph.nodes.map((node) => node.key)
    if (reused < graph.nodes.length * 0.6) userMovedRef.current = false
    runLayout(reused === graph.nodes.length ? 60 : MAX_FRAMES)
    return () => cancelAnimationFrame(rafRef.current)
  }, [graph, size.w, size.h, runLayout])

  // ── 选中、悬停、搜索 ──
  const activeIndex = useMemo(() => graph.nodes.findIndex((node) => node.key === activeKey), [graph, activeKey])
  const focusIndex = dragIndex >= 0 ? dragIndex : hoverIndex >= 0 ? hoverIndex : activeIndex
  const focusSet = useMemo(() => {
    if (focusIndex < 0) return null
    return new Set([focusIndex, ...graph.adjacency[focusIndex].keys()])
  }, [graph, focusIndex])

  const matches = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return null
    const set = new Set()
    graph.nodes.forEach((node, index) => { if (node.title.toLowerCase().includes(query)) set.add(index) })
    return set
  }, [graph, search])

  const topLabels = useMemo(() => {
    const ranked = graph.nodes.map((node, index) => index)
      .filter((index) => graph.nodes[index].kind !== 'tag')
      .sort((a, b) => graph.degree[b] - graph.degree[a])
    return new Set(ranked.slice(0, LABEL_TOP).filter((index) => graph.degree[index] > 0))
  }, [graph])

  const centerOn = useCallback((index, { scale } = {}) => {
    const p = positionsRef.current[index]
    if (!p) return
    const s = scale || Math.max(transformRef.current.s, 1)
    userMovedRef.current = true
    setTransform({ tx: size.w / 2 - p.x * s, ty: size.h / 2 - p.y * s, s })
  }, [size])

  // 搜索：只有一个结果时直接选中并移过去
  useEffect(() => {
    if (!matches || matches.size !== 1) return
    const [index] = matches
    setActiveKey(graph.nodes[index].key)
    centerOn(index)
  }, [matches]) // eslint-disable-line react-hooks/exhaustive-deps

  const openNode = async (node) => {
    if (!node) return
    if (node.kind === 'ghost') {
      try {
        const result = await createNote({ title: node.title, content: '' })
        const id = result?.data?.id ?? result?.id
        if (id != null) { setSelectedNoteId(id); setCurrentView('notes') }
      } catch { /* 宿主会提示 */ }
      return
    }
    if (node.note) {
      setSelectedNoteId(node.note.id)
      setCurrentView('notes')
    }
  }

  // ── 缩放、平移、拖动 ──
  useEffect(() => {
    const element = svgRef.current
    if (!element) return undefined
    const onWheel = (event) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const mx = event.clientX - rect.left
      const my = event.clientY - rect.top
      const current = transformRef.current
      const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, current.s * Math.exp(-event.deltaY * 0.0015)))
      if (s === current.s) return
      userMovedRef.current = true
      setTransform({ tx: mx - ((mx - current.tx) / current.s) * s, ty: my - ((my - current.ty) / current.s) * s, s })
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  })

  const zoomBy = (factor) => {
    const current = transformRef.current
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, current.s * factor))
    const cx = size.w / 2
    const cy = size.h / 2
    userMovedRef.current = true
    setTransform({ tx: cx - ((cx - current.tx) / current.s) * s, ty: cy - ((cy - current.ty) / current.s) * s, s })
  }

  const onBackgroundDown = (event) => {
    if (event.button !== 0) return
    dragRef.current = { mode: 'pan', x: event.clientX, y: event.clientY, tx: transformRef.current.tx, ty: transformRef.current.ty, moved: false }
  }
  const onNodeDown = (event, index) => {
    if (event.button !== 0) return
    event.stopPropagation()
    const p = positionsRef.current[index]
    if (!p) return
    dragRef.current = { mode: 'node', index, x: event.clientX, y: event.clientY, ox: p.x, oy: p.y, moved: false }
  }

  useEffect(() => {
    const onMove = (event) => {
      const drag = dragRef.current
      if (!drag) return
      const dx = event.clientX - drag.x
      const dy = event.clientY - drag.y
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return
      if (!drag.moved) {
        drag.moved = true
        if (drag.mode === 'node') {
          positionsRef.current[drag.index].fixed = true
          setDragIndex(drag.index)
          cancelAnimationFrame(rafRef.current)
          const follow = () => {
            const current = dragRef.current
            if (!current || current.mode !== 'node') return
            const p = positionsRef.current[current.index]
            if (p && current.tx != null) {
              p.x += (current.tx - p.x) * DRAG_FOLLOW
              p.y += (current.ty - p.y) * DRAG_FOLLOW
            }
            stepLayout(positionsRef.current, graph.edges, size.w, size.h)
            redraw((x) => (x + 1) % 1000)
            rafRef.current = requestAnimationFrame(follow)
          }
          rafRef.current = requestAnimationFrame(follow)
        }
      }
      if (drag.mode === 'pan') {
        userMovedRef.current = true
        setTransform((t) => ({ ...t, tx: drag.tx + dx, ty: drag.ty + dy }))
      } else {
        const s = transformRef.current.s || 1
        drag.tx = drag.ox + dx / s
        drag.ty = drag.oy + dy / s
      }
    }
    const onUp = () => {
      const drag = dragRef.current
      dragRef.current = null
      if (!drag) return
      if (drag.mode === 'pan') {
        if (!drag.moved) setActiveKey(null)
        return
      }
      if (!drag.moved) {
        const node = graph.nodes[drag.index]
        setActiveKey((current) => (current === node?.key ? null : node?.key))
        return
      }
      const p = positionsRef.current[drag.index]
      if (p) p.fixed = false
      setDragIndex(-1)
      runLayout(DRAG_RELAX_FRAMES, { fit: false })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [graph, size.w, size.h, runLayout])

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') setActiveKey(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── 颜色：安静的灰，选中和它的邻居用主题色 ──
  const primary = theme.palette.primary.main
  const ink = theme.palette.text.primary
  const colors = {
    note: alpha(ink, dark ? 0.62 : 0.5),
    whiteboard: alpha(ink, dark ? 0.62 : 0.5),
    tag: alpha(ink, dark ? 0.4 : 0.32),
    ghost: alpha(ink, 0.25),
    edge: alpha(ink, dark ? 0.16 : 0.13),
    tagEdge: alpha(ink, dark ? 0.08 : 0.07),
    label: theme.palette.text.secondary,
    paper: theme.palette.background.paper,
  }

  const dimmed = (index) => {
    if (matches) return !matches.has(index)
    if (focusSet) return !focusSet.has(index)
    return false
  }
  const labelShown = (index) => {
    if (focusSet?.has(index) || matches?.has(index) || index === currentNoteIndex) return !dimmed(index) || index === focusIndex
    if (graph.nodes[index].kind === 'tag') return transform.s >= LABEL_ALL_SCALE
    if (graph.nodes.length <= LABEL_ALL_BELOW || transform.s >= LABEL_ALL_SCALE) return true
    return topLabels.has(index)
  }

  const positions = positionsRef.current
  const ready = positions.length === graph.nodes.length
  const active = activeIndex >= 0 ? graph.nodes[activeIndex] : null
  const iconButtonSx = { width: 32, height: 32, borderRadius: '8px', color: 'text.secondary', '&:hover': { color: 'text.primary' } }

  const emptyMessage = scope === 'local'
    ? (currentNoteIndex < 0 ? { title: '先打开一篇笔记', body: '「当前笔记」只显示正在看的这篇笔记和它周围的内容。' } : null)
    : noteCount === 0 ? { title: '还没有笔记', body: '写下第一篇笔记后，这里会显示它们之间的关联。' } : null
  const noRelations = !emptyMessage && graph.edges.length === 0

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* 顶部：标题和统计 / 范围、搜索、筛选 */}
      <Box sx={{ position: 'absolute', top: 12, left: 16, right: 16, zIndex: 2, display: 'flex', alignItems: 'center', gap: 1.5, pointerEvents: 'none' }}>
        <Box sx={{ minWidth: 0, pointerEvents: 'auto' }}>
          <Typography sx={{ fontSize: 15, fontWeight: 650, lineHeight: 1.3 }}>图谱</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap' }}>
            {noteCount} 篇笔记 · {linkCount} 条链接{showTags && tagCount ? ` · ${tagCount} 个标签` : ''}
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pointerEvents: 'auto' }}>
          {SegmentedControl ? (
            <SegmentedControl
              ariaLabel="图谱范围"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'all', label: '全部' },
                { value: 'local', label: '当前笔记', disabled: currentNoteIndex < 0, tooltip: currentNoteIndex < 0 ? '先打开一篇笔记' : '只看当前笔记周围' },
              ]}
            />
          ) : null}
          <TextField
            size="small"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索"
            sx={{ width: 180, '& .MuiOutlinedInput-root': { height: 32, fontSize: 13 } }}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><Icons.Search sx={{ fontSize: 16, color: 'text.disabled' }} /></InputAdornment> } }}
          />
          <Tooltip title="显示内容">
            <IconButton size="small" aria-label="显示内容" onClick={(event) => setFilterAnchor(event.currentTarget)} sx={iconButtonSx}>
              <Icons.Filter fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Popover
        open={Boolean(filterAnchor)}
        anchorEl={filterAnchor}
        onClose={() => setFilterAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: 0.75, p: 1, width: 240 } } }}
      >
        {[
          [showTags, setShowTags, '标签', '有相同标签的笔记连在一起'],
          [showOrphans, setShowOrphans, '没有关联的笔记', '关掉后只看连起来的部分'],
          [showGhosts, setShowGhosts, '还没创建的笔记', '双链指向、但还不存在的笔记'],
        ].map(([checked, set, label, hint]) => (
          <FormControlLabel
            key={label}
            sx={{ display: 'flex', alignItems: 'flex-start', m: 0, px: 0.5, py: 0.25 }}
            control={<Checkbox size="small" checked={checked} onChange={(event) => set(event.target.checked)} sx={{ mt: -0.25 }} />}
            label={(
              <Box sx={{ pt: 0.5 }}>
                <Typography sx={{ fontSize: 13 }}>{label}</Typography>
                <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>{hint}</Typography>
              </Box>
            )}
          />
        ))}
      </Popover>

      {/* 画布 */}
      <Box ref={containerRef} sx={{ position: 'absolute', inset: 0 }}>
        {ready && !emptyMessage && (
          <svg
            ref={svgRef}
            width={size.w}
            height={size.h}
            role="img"
            aria-label="笔记关联图"
            style={{ display: 'block', cursor: dragRef.current?.mode === 'pan' ? 'grabbing' : 'default', userSelect: 'none' }}
            onMouseDown={onBackgroundDown}
          >
            <g transform={`translate(${transform.tx}, ${transform.ty}) scale(${transform.s})`}>
              {graph.edges.map(({ a, b, kind }, i) => {
                const pa = positions[a]
                const pb = positions[b]
                if (!pa || !pb) return null
                const lit = focusIndex >= 0 && (a === focusIndex || b === focusIndex)
                const faded = (focusSet && !lit) || (matches && !(matches.has(a) && matches.has(b)))
                return (
                  <line
                    key={i}
                    x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                    stroke={lit ? primary : kind === 'tag' ? colors.tagEdge : colors.edge}
                    strokeOpacity={lit ? 0.7 : faded ? 0.35 : 1}
                    strokeWidth={(lit ? 1.4 : 1) / transform.s}
                    strokeDasharray={graph.nodes[a].kind === 'ghost' || graph.nodes[b].kind === 'ghost' ? `${3 / transform.s} ${3 / transform.s}` : undefined}
                  />
                )
              })}
              {graph.nodes.map((node, index) => {
                const p = positions[index]
                if (!p) return null
                const r = nodeRadius(node, graph.degree[index])
                const isActive = index === activeIndex
                const isCurrent = index === currentNoteIndex
                const lit = focusSet?.has(index) || matches?.has(index)
                const fade = dimmed(index)
                const fill = isActive || index === focusIndex ? primary
                  : lit && focusIndex >= 0 ? alpha(primary, 0.55)
                    : colors[node.kind]
                const opacity = fade ? 0.22 : 1
                const fontSize = 11.5 / Math.max(transform.s, 0.6)
                return (
                  <g
                    key={node.key}
                    transform={`translate(${p.x}, ${p.y})`}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => { if (!dragRef.current) setHoverIndex(index) }}
                    onMouseLeave={() => { if (!dragRef.current) setHoverIndex(-1) }}
                    onMouseDown={(event) => onNodeDown(event, index)}
                    onDoubleClick={() => openNode(node)}
                  >
                    {/* 点击范围比圆点大一些，小点也好点 */}
                    <circle r={Math.max(r, 8) / Math.min(1, transform.s)} fill="transparent" />
                    {node.kind === 'whiteboard' ? (
                      <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={r * 0.35} fill={fill} opacity={opacity} />
                    ) : node.kind === 'tag' || node.kind === 'ghost' ? (
                      <circle r={r} fill={colors.paper} stroke={fill} strokeWidth={1.4 / transform.s}
                        strokeDasharray={node.kind === 'ghost' ? `${2 / transform.s} ${2 / transform.s}` : undefined} opacity={opacity} />
                    ) : (
                      <circle r={r} fill={fill} opacity={opacity} />
                    )}
                    {/* 当前打开的笔记：外面一圈细环 */}
                    {isCurrent && <circle r={r + 3 / transform.s} fill="none" stroke={primary} strokeWidth={1.2 / transform.s} opacity={opacity} />}
                    {labelShown(index) && (
                      <text
                        y={r + fontSize + 2 / transform.s}
                        textAnchor="middle"
                        fontSize={fontSize}
                        fontWeight={isActive || index === focusIndex ? 600 : 400}
                        fill={isActive || index === focusIndex ? ink : colors.label}
                        opacity={fade ? 0.4 : 1}
                        style={{ pointerEvents: 'none', paintOrder: 'stroke', stroke: theme.palette.background.paper, strokeWidth: 3 / transform.s, strokeLinejoin: 'round' }}
                      >
                        {node.kind === 'tag' ? `#${node.title}` : node.title}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          </svg>
        )}

        {(emptyMessage || noRelations) && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <Box sx={(t) => ({ ...panelSx(t), maxWidth: 360, px: 2.5, py: 2, textAlign: 'center', pointerEvents: 'auto' })}>
              <Icons.Graph sx={{ fontSize: 28, color: 'text.disabled', mb: 0.5 }} />
              <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.5 }}>{emptyMessage?.title || '笔记之间还没有关联'}</Typography>
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary', lineHeight: 1.6 }}>
                {emptyMessage?.body || '在笔记里写 [[笔记名]]、插入另一篇笔记的链接，或者给笔记加上相同的标签，它们就会在这里连起来。'}
              </Typography>
            </Box>
          </Box>
        )}
      </Box>

      {/* 选中节点的详情 */}
      {active && (
        <DetailPanel
          node={active}
          index={activeIndex}
          graph={graph}
          onClose={() => setActiveKey(null)}
          onOpen={() => openNode(active)}
          onSelect={(index) => { setActiveKey(graph.nodes[index].key); centerOn(index) }}
        />
      )}

      {/* 右下：缩放 */}
      <Box sx={(t) => ({ ...panelSx(t), position: 'absolute', right: 16, bottom: 16, zIndex: 2, display: 'flex', flexDirection: 'column', p: 0.5, gap: 0.25 })}>
        <Tooltip title="放大" placement="left"><IconButton size="small" aria-label="放大" onClick={() => zoomBy(1.25)} sx={iconButtonSx}><Icons.ZoomIn fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="缩小" placement="left"><IconButton size="small" aria-label="缩小" onClick={() => zoomBy(1 / 1.25)} sx={iconButtonSx}><Icons.ZoomOut fontSize="small" /></IconButton></Tooltip>
        <Divider sx={{ mx: 0.5 }} />
        <Tooltip title="显示全部" placement="left"><IconButton size="small" aria-label="显示全部" onClick={() => { userMovedRef.current = false; fitToContent() }} sx={iconButtonSx}><Icons.Fit fontSize="small" /></IconButton></Tooltip>
      </Box>

      {/* 左下：操作提示 */}
      <Typography sx={{ position: 'absolute', left: 16, bottom: 14, zIndex: 1, fontSize: 11.5, color: 'text.disabled', pointerEvents: 'none' }}>
        单击查看关联 · 双击打开 · 拖动整理 · 滚轮缩放
      </Typography>
    </Box>
  )
}

/** 右侧详情：这是什么、写了什么、连着谁 */
const DetailPanel = ({ node, index, graph, onClose, onOpen, onSelect }) => {
  const neighbors = [...graph.adjacency[index].entries()]
    .map(([neighbor, kind]) => ({ neighbor, kind, node: graph.nodes[neighbor] }))
    .sort((a, b) => (a.kind === 'tag') - (b.kind === 'tag') || graph.degree[b.neighbor] - graph.degree[a.neighbor])
  const note = node.note
  const tags = note ? parseNoteTags(note.tags) : []
  const meta = node.kind === 'tag' ? `标签 · ${neighbors.length} 篇笔记`
    : node.kind === 'ghost' ? '还没有创建的笔记'
      : `${node.kind === 'whiteboard' ? '画布' : '笔记'} · ${relativeTime(note?.updated_at || note?.created_at)}更新`
  const excerpt = excerptOf(note)
  const openLabel = node.kind === 'ghost' ? '创建这篇笔记' : node.kind === 'tag' ? null : '打开'

  return (
    <Box sx={(t) => ({ ...panelSx(t), position: 'absolute', top: 64, right: 16, bottom: 148, zIndex: 3, width: 300, display: 'flex', flexDirection: 'column', overflow: 'hidden' })}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, p: 1.75, pb: 1.25 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 650, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{node.kind === 'tag' ? `#${node.title}` : node.title}</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>{meta}</Typography>
        </Box>
        <IconButton size="small" aria-label="关闭" onClick={onClose} sx={{ mt: -0.5, mr: -0.75, color: 'text.secondary' }}><Icons.Close fontSize="small" /></IconButton>
      </Box>

      {(excerpt || tags.length > 0) && (
        <Box sx={{ px: 1.75, pb: 1.25 }}>
          {excerpt && (
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary', lineHeight: 1.65, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {excerpt}
            </Typography>
          )}
          {tags.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: excerpt ? 1 : 0 }}>
              {tags.slice(0, 6).map((tag) => (
                <Typography key={tag} component="span" sx={{ fontSize: 11.5, color: 'text.secondary', px: 0.75, py: 0.125, borderRadius: '6px', bgcolor: 'action.hover' }}>#{tag}</Typography>
              ))}
            </Box>
          )}
        </Box>
      )}

      <Divider />
      <Typography sx={{ px: 1.75, pt: 1.25, pb: 0.5, fontSize: 12, fontWeight: 600, color: 'text.secondary' }}>
        关联 {neighbors.length}
      </Typography>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 0.75, pb: 0.75 }}>
        {neighbors.length === 0 && (
          <Typography sx={{ px: 1, py: 1, fontSize: 12.5, color: 'text.disabled' }}>还没有和其他内容连起来</Typography>
        )}
        {neighbors.map(({ neighbor, kind, node: other }) => (
          <ButtonBase
            key={other.key}
            onClick={() => onSelect(neighbor)}
            sx={{ width: '100%', display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.75, borderRadius: '8px', textAlign: 'left', '&:hover': { bgcolor: 'action.hover' } }}
          >
            <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 13 }}>{other.kind === 'tag' ? `#${other.title}` : other.title}</Typography>
            <Typography sx={{ flexShrink: 0, fontSize: 11, color: 'text.disabled' }}>{other.kind === 'ghost' ? '未创建' : RELATION_LABEL[kind]}</Typography>
          </ButtonBase>
        ))}
      </Box>

      {openLabel && (
        <Box sx={{ p: 1.25, borderTop: 1, borderColor: 'divider' }}>
          <Button fullWidth variant="contained" disableElevation size="small" startIcon={node.kind === 'ghost' ? null : <Icons.Open sx={{ fontSize: 16 }} />} onClick={onOpen}>
            {openLabel}
          </Button>
        </Box>
      )}
    </Box>
  )
}

export default GraphView
