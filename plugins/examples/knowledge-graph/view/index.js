import { extractAppReferences, extractWikiTargets, parseNoteTags } from "./linkGraph.js";
const host = globalThis.__flotaHost__;
if (!host) throw new Error("Flota host not ready");
const { React, MaterialUI, MaterialIcons, MuiStyles, store, utils, components = {} } = host;
const { useEffect, useMemo, useRef, useState, useCallback } = React;
const {
  Box,
  Typography,
  IconButton,
  Tooltip,
  TextField,
  InputAdornment,
  Button,
  ButtonBase,
  Popover,
  FormControlLabel,
  Checkbox,
  Divider
} = MaterialUI;
const { useTheme, alpha } = MuiStyles;
const { useStore } = store;
const { stripMarkdownToPreviewText, glassSx, floatingGlassSx } = utils;
const SegmentedControl = components.SegmentedControl;
const Icons = {
  Search: MaterialIcons.Search,
  Filter: MaterialIcons.FilterListRounded || MaterialIcons.FilterList,
  ZoomIn: MaterialIcons.AddRounded || MaterialIcons.ZoomIn,
  ZoomOut: MaterialIcons.RemoveRounded || MaterialIcons.ZoomOut,
  Fit: MaterialIcons.FitScreenRounded || MaterialIcons.FitScreen || MaterialIcons.ZoomOutMap,
  Close: MaterialIcons.CloseRounded || MaterialIcons.Close,
  Open: MaterialIcons.OpenInNewRounded || MaterialIcons.Launch,
  Graph: MaterialIcons.HubRounded || MaterialIcons.Hub
};
const REPULSION = 1600;
const SPRING_K = 0.05;
const SPRING_LEN = { wiki: 100, ref: 100, tag: 80 };
const CENTER_PULL = 0.01;
const DAMPING = 0.85;
const MAX_FRAMES = 300;
const DRAG_FOLLOW = 0.42;
const DRAG_RELAX_FRAMES = 100;
const MIN_SCALE = 0.2;
const MAX_SCALE = 5;
const LABEL_ALL_BELOW = 40;
const LABEL_TOP = 14;
const LABEL_ALL_SCALE = 1.4;
const RELATION_LABEL = { wiki: "\u53CC\u94FE", ref: "\u5F15\u7528", tag: "\u6807\u7B7E" };
const panelSx = (theme) => glassSx ? glassSx(theme, "popover", { radius: "md" }) : floatingGlassSx({ radius: "12px" });
const displayTitle = (note) => {
  if (!note) return "\u65E0\u6807\u9898";
  const title = String(note.title || "").trim();
  if (title && title !== "\u65E0\u6807\u9898" && title !== "Untitled") return title;
  if (note.note_type === "whiteboard") return "\u672A\u547D\u540D\u753B\u5E03";
  try {
    const text = (stripMarkdownToPreviewText(note.content || "") || "").trim();
    if (text) {
      const chars = Array.from(text);
      return chars.slice(0, 12).join("") + (chars.length > 12 ? "\u2026" : "");
    }
  } catch {
  }
  return "\u65E0\u6807\u9898";
};
const excerptOf = (note) => {
  if (!note || note.note_type === "whiteboard") return "";
  try {
    const text = (stripMarkdownToPreviewText(note.content || "") || "").replace(/\s+/g, " ").trim();
    return text.length > 140 ? `${text.slice(0, 140)}\u2026` : text;
  } catch {
    return "";
  }
};
const normalize = (value) => String(value || "").trim().toLowerCase();
const firstLineAlias = (note) => {
  const line = String(note?.content || "").split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  return line ? line.replace(/^#{1,6}\s+/, "").replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "").trim() : "";
};
const buildGraph = (notes, { showTags, showGhosts }) => {
  const nodes = [];
  const indexById = /* @__PURE__ */ new Map();
  const aliasToIndex = /* @__PURE__ */ new Map();
  const refToIndex = /* @__PURE__ */ new Map();
  notes.forEach((note) => {
    if (!note?.id || note.is_deleted) return;
    const index = nodes.length;
    nodes.push({
      key: `note:${note.id}`,
      kind: note.note_type === "whiteboard" ? "whiteboard" : "note",
      title: displayTitle(note),
      note
    });
    indexById.set(String(note.id), index);
    refToIndex.set(String(note.id), index);
    if (note.sync_id) refToIndex.set(String(note.sync_id), index);
    {
      ;
      [note.title, note.note_type === "whiteboard" ? "" : firstLineAlias(note)].forEach((alias) => {
        const key = normalize(alias);
        if (!key || key === "\u65E0\u6807\u9898" || key === "untitled") return;
        const existing = aliasToIndex.get(key);
        const newer = !existing || new Date(note.updated_at || 0) > new Date(nodes[existing].note.updated_at || 0);
        if (newer) aliasToIndex.set(key, index);
      });
    }
  });
  const edges = [];
  const edgeKeys = /* @__PURE__ */ new Set();
  const addEdge = (a, b, kind) => {
    if (a === b || a == null || b == null) return;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ a, b, kind });
  };
  const ghostIndex = /* @__PURE__ */ new Map();
  const tagIndex = /* @__PURE__ */ new Map();
  const noteCount = nodes.length;
  for (let from = 0; from < noteCount; from += 1) {
    const { note } = nodes[from];
    if (note.note_type === "whiteboard") continue;
    const content = typeof note.content === "string" ? note.content : "";
    extractWikiTargets(content).forEach((target) => {
      const key = normalize(target);
      let to = aliasToIndex.get(key);
      if (to == null) {
        if (!showGhosts) return;
        to = ghostIndex.get(key);
        if (to == null) {
          to = nodes.length;
          nodes.push({ key: `ghost:${key}`, kind: "ghost", title: target });
          ghostIndex.set(key, to);
        }
      }
      addEdge(from, to, "wiki");
    });
    extractAppReferences(content).forEach((reference) => addEdge(from, refToIndex.get(String(reference)), "ref"));
    if (showTags) {
      parseNoteTags(note.tags).forEach((tag) => {
        const key = normalize(tag);
        let to = tagIndex.get(key);
        if (to == null) {
          to = nodes.length;
          nodes.push({ key: `tag:${key}`, kind: "tag", title: tag });
          tagIndex.set(key, to);
        }
        addEdge(from, to, "tag");
      });
    }
  }
  const degree = new Array(nodes.length).fill(0);
  const adjacency = Array.from({ length: nodes.length }, () => /* @__PURE__ */ new Map());
  edges.forEach(({ a, b, kind }) => {
    degree[a] += 1;
    degree[b] += 1;
    adjacency[a].set(b, kind);
    adjacency[b].set(a, kind);
  });
  return { nodes, edges, degree, adjacency };
};
const subgraph = (graph, keep) => {
  const remap = /* @__PURE__ */ new Map();
  const nodes = [];
  graph.nodes.forEach((node, index) => {
    if (!keep(index)) return;
    remap.set(index, nodes.length);
    nodes.push(node);
  });
  const edges = graph.edges.filter(({ a, b }) => remap.has(a) && remap.has(b)).map(({ a, b, kind }) => ({ a: remap.get(a), b: remap.get(b), kind }));
  const degree = new Array(nodes.length).fill(0);
  const adjacency = Array.from({ length: nodes.length }, () => /* @__PURE__ */ new Map());
  edges.forEach(({ a, b, kind }) => {
    degree[a] += 1;
    degree[b] += 1;
    adjacency[a].set(b, kind);
    adjacency[b].set(a, kind);
  });
  return { nodes, edges, degree, adjacency };
};
const initialLayout = (count, w, h, previous) => {
  const cx = w / 2;
  const cy = h / 2;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const radius = Math.min(w, h) * 0.38;
  return Array.from({ length: count }, (_, i) => {
    const kept = previous?.[i];
    if (kept) return { ...kept, vx: 0, vy: 0, fixed: false };
    const angle = i * golden;
    const r = radius * Math.sqrt((i + 1) / count);
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, vx: 0, vy: 0, fixed: false };
  });
};
const stepLayout = (positions, edges, w, h) => {
  const n = positions.length;
  if (!n) return;
  const cx = w / 2;
  const cy = h / 2;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const dx = positions[j].x - positions[i].x;
      const dy = positions[j].y - positions[i].y;
      const d2 = Math.max(0.01, dx * dx + dy * dy);
      const d = Math.sqrt(d2);
      const f = REPULSION / d2;
      positions[i].vx -= dx / d * f;
      positions[i].vy -= dy / d * f;
      positions[j].vx += dx / d * f;
      positions[j].vy += dy / d * f;
    }
  }
  edges.forEach(({ a, b, kind }) => {
    const dx = positions[b].x - positions[a].x;
    const dy = positions[b].y - positions[a].y;
    const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const f = SPRING_K * (d - SPRING_LEN[kind]);
    positions[a].vx += dx / d * f;
    positions[a].vy += dy / d * f;
    positions[b].vx -= dx / d * f;
    positions[b].vy -= dy / d * f;
  });
  positions.forEach((p) => {
    if (p.fixed) {
      p.vx = 0;
      p.vy = 0;
      return;
    }
    p.vx = (p.vx + (cx - p.x) * CENTER_PULL) * DAMPING;
    p.vy = (p.vy + (cy - p.y) * CENTER_PULL) * DAMPING;
    p.x += p.vx;
    p.y += p.vy;
  });
};
const nodeRadius = (node, degree) => {
  if (node.kind === "tag") return 3.5;
  return Math.min(14, 4 + Math.sqrt(degree) * 2.2);
};
const relativeTime = (value) => {
  const time = new Date(value || 0).getTime();
  if (!time) return "";
  const minutes = Math.round((Date.now() - time) / 6e4);
  if (minutes < 1) return "\u521A\u521A";
  if (minutes < 60) return `${minutes} \u5206\u949F\u524D`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} \u5C0F\u65F6\u524D`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} \u5929\u524D`;
  return new Date(time).toLocaleDateString("zh-CN", { year: "numeric", month: "numeric", day: "numeric" });
};
const GraphView = () => {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  const notes = useStore((s) => s.notes);
  const selectedNoteId = useStore((s) => s.selectedNoteId);
  const setSelectedNoteId = useStore((s) => s.setSelectedNoteId);
  const setCurrentView = useStore((s) => s.setCurrentView);
  const createNote = useStore((s) => s.createNote);
  const focusRequest = useStore((s) => s.graphFocusRequest);
  const [scope, setScope] = useState("all");
  const [showTags, setShowTags] = useState(true);
  const [showOrphans, setShowOrphans] = useState(true);
  const [showGhosts, setShowGhosts] = useState(true);
  const [filterAnchor, setFilterAnchor] = useState(null);
  const [search, setSearch] = useState("");
  const [activeKey, setActiveKey] = useState(null);
  const [hoverIndex, setHoverIndex] = useState(-1);
  const [dragIndex, setDragIndex] = useState(-1);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [transform, setTransform] = useState({ tx: 0, ty: 0, s: 1 });
  const [, redraw] = useState(0);
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const positionsRef = useRef([]);
  const layoutKeysRef = useRef([]);
  const rafRef = useRef(0);
  const framesRef = useRef(0);
  const dragRef = useRef(null);
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const userMovedRef = useRef(false);
  useEffect(() => {
    if (!focusRequest?.noteId) return;
    setScope("local");
    setActiveKey(`note:${focusRequest.noteId}`);
    useStore.setState({ graphFocusRequest: null });
  }, [focusRequest]);
  const fullGraph = useMemo(() => buildGraph(notes, { showTags, showGhosts }), [notes, showTags, showGhosts]);
  const currentNoteIndex = useMemo(
    () => fullGraph.nodes.findIndex((node) => node.key === `note:${selectedNoteId}`),
    [fullGraph, selectedNoteId]
  );
  const graph = useMemo(() => {
    if (scope === "local") {
      const start = currentNoteIndex;
      if (start < 0) return subgraph(fullGraph, () => false);
      const keep = /* @__PURE__ */ new Set([start]);
      let frontier = [start];
      for (let depth = 0; depth < 2; depth += 1) {
        const next = [];
        frontier.forEach((index) => fullGraph.adjacency[index].forEach((kind, neighbor) => {
          if (keep.has(neighbor)) return;
          if (depth === 1 && (kind === "tag" || fullGraph.nodes[index].kind === "tag")) return;
          keep.add(neighbor);
          next.push(neighbor);
        }));
        frontier = next;
      }
      return subgraph(fullGraph, (index) => keep.has(index));
    }
    if (!showOrphans) return subgraph(fullGraph, (index) => fullGraph.degree[index] > 0);
    return fullGraph;
  }, [fullGraph, scope, currentNoteIndex, showOrphans]);
  const noteCount = graph.nodes.filter((node) => node.kind === "note" || node.kind === "whiteboard").length;
  const linkCount = graph.edges.filter((edge) => edge.kind !== "tag").length;
  const tagCount = graph.nodes.filter((node) => node.kind === "tag").length;
  useEffect(() => {
    if (!containerRef.current) return void 0;
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);
  const fitToContent = useCallback(() => {
    const points = positionsRef.current;
    if (!points.length || !size.w || !size.h) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    points.forEach((p) => {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    });
    const padX = 120;
    const padY = 90;
    const s = Math.max(MIN_SCALE, Math.min(2.2, (size.w - padX * 2) / Math.max(1, maxX - minX), (size.h - padY * 2) / Math.max(1, maxY - minY)));
    setTransform({ tx: size.w / 2 - (minX + maxX) / 2 * s, ty: size.h / 2 - (minY + maxY) / 2 * s, s });
  }, [size]);
  const fitRef = useRef(fitToContent);
  fitRef.current = fitToContent;
  const runLayout = useCallback((frames = MAX_FRAMES, { fit = true } = {}) => {
    cancelAnimationFrame(rafRef.current);
    framesRef.current = MAX_FRAMES - frames;
    const tick = () => {
      stepLayout(positionsRef.current, graph.edges, size.w, size.h);
      framesRef.current += 1;
      redraw((x) => (x + 1) % 1e3);
      if (framesRef.current < MAX_FRAMES) rafRef.current = requestAnimationFrame(tick);
      else if (fit && !userMovedRef.current) fitRef.current();
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [graph, size]);
  useEffect(() => {
    if (!size.w || !size.h) return void 0;
    const previous = new Map(layoutKeysRef.current.map((key, i) => [key, positionsRef.current[i]]));
    const kept = graph.nodes.map((node) => previous.get(node.key));
    const reused = kept.filter(Boolean).length;
    positionsRef.current = initialLayout(graph.nodes.length, size.w, size.h, kept);
    layoutKeysRef.current = graph.nodes.map((node) => node.key);
    if (reused < graph.nodes.length * 0.6) userMovedRef.current = false;
    runLayout(reused === graph.nodes.length ? 60 : MAX_FRAMES);
    return () => cancelAnimationFrame(rafRef.current);
  }, [graph, size.w, size.h, runLayout]);
  const activeIndex = useMemo(() => graph.nodes.findIndex((node) => node.key === activeKey), [graph, activeKey]);
  const focusIndex = dragIndex >= 0 ? dragIndex : hoverIndex >= 0 ? hoverIndex : activeIndex;
  const focusSet = useMemo(() => {
    if (focusIndex < 0) return null;
    return /* @__PURE__ */ new Set([focusIndex, ...graph.adjacency[focusIndex].keys()]);
  }, [graph, focusIndex]);
  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return null;
    const set = /* @__PURE__ */ new Set();
    graph.nodes.forEach((node, index) => {
      if (node.title.toLowerCase().includes(query)) set.add(index);
    });
    return set;
  }, [graph, search]);
  const topLabels = useMemo(() => {
    const ranked = graph.nodes.map((node, index) => index).filter((index) => graph.nodes[index].kind !== "tag").sort((a, b) => graph.degree[b] - graph.degree[a]);
    return new Set(ranked.slice(0, LABEL_TOP).filter((index) => graph.degree[index] > 0));
  }, [graph]);
  const centerOn = useCallback((index, { scale } = {}) => {
    const p = positionsRef.current[index];
    if (!p) return;
    const s = scale || Math.max(transformRef.current.s, 1);
    userMovedRef.current = true;
    setTransform({ tx: size.w / 2 - p.x * s, ty: size.h / 2 - p.y * s, s });
  }, [size]);
  useEffect(() => {
    if (!matches || matches.size !== 1) return;
    const [index] = matches;
    setActiveKey(graph.nodes[index].key);
    centerOn(index);
  }, [matches]);
  const openNode = async (node) => {
    if (!node) return;
    if (node.kind === "ghost") {
      try {
        const result = await createNote({ title: node.title, content: "" });
        const id = result?.data?.id ?? result?.id;
        if (id != null) {
          setSelectedNoteId(id);
          setCurrentView("notes");
        }
      } catch {
      }
      return;
    }
    if (node.note) {
      setSelectedNoteId(node.note.id);
      setCurrentView("notes");
    }
  };
  useEffect(() => {
    const element = svgRef.current;
    if (!element) return void 0;
    const onWheel = (event) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      const current = transformRef.current;
      const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, current.s * Math.exp(-event.deltaY * 15e-4)));
      if (s === current.s) return;
      userMovedRef.current = true;
      setTransform({ tx: mx - (mx - current.tx) / current.s * s, ty: my - (my - current.ty) / current.s * s, s });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  });
  const zoomBy = (factor) => {
    const current = transformRef.current;
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, current.s * factor));
    const cx = size.w / 2;
    const cy = size.h / 2;
    userMovedRef.current = true;
    setTransform({ tx: cx - (cx - current.tx) / current.s * s, ty: cy - (cy - current.ty) / current.s * s, s });
  };
  const onBackgroundDown = (event) => {
    if (event.button !== 0) return;
    dragRef.current = { mode: "pan", x: event.clientX, y: event.clientY, tx: transformRef.current.tx, ty: transformRef.current.ty, moved: false };
  };
  const onNodeDown = (event, index) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const p = positionsRef.current[index];
    if (!p) return;
    dragRef.current = { mode: "node", index, x: event.clientX, y: event.clientY, ox: p.x, oy: p.y, moved: false };
  };
  useEffect(() => {
    const onMove = (event) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      if (!drag.moved) {
        drag.moved = true;
        if (drag.mode === "node") {
          positionsRef.current[drag.index].fixed = true;
          setDragIndex(drag.index);
          cancelAnimationFrame(rafRef.current);
          const follow = () => {
            const current = dragRef.current;
            if (!current || current.mode !== "node") return;
            const p = positionsRef.current[current.index];
            if (p && current.tx != null) {
              p.x += (current.tx - p.x) * DRAG_FOLLOW;
              p.y += (current.ty - p.y) * DRAG_FOLLOW;
            }
            stepLayout(positionsRef.current, graph.edges, size.w, size.h);
            redraw((x) => (x + 1) % 1e3);
            rafRef.current = requestAnimationFrame(follow);
          };
          rafRef.current = requestAnimationFrame(follow);
        }
      }
      if (drag.mode === "pan") {
        userMovedRef.current = true;
        setTransform((t) => ({ ...t, tx: drag.tx + dx, ty: drag.ty + dy }));
      } else {
        const s = transformRef.current.s || 1;
        drag.tx = drag.ox + dx / s;
        drag.ty = drag.oy + dy / s;
      }
    };
    const onUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      if (drag.mode === "pan") {
        if (!drag.moved) setActiveKey(null);
        return;
      }
      if (!drag.moved) {
        const node = graph.nodes[drag.index];
        setActiveKey((current) => current === node?.key ? null : node?.key);
        return;
      }
      const p = positionsRef.current[drag.index];
      if (p) p.fixed = false;
      setDragIndex(-1);
      runLayout(DRAG_RELAX_FRAMES, { fit: false });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [graph, size.w, size.h, runLayout]);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") setActiveKey(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const primary = theme.palette.primary.main;
  const ink = theme.palette.text.primary;
  const colors = {
    note: alpha(ink, dark ? 0.62 : 0.5),
    whiteboard: alpha(ink, dark ? 0.62 : 0.5),
    tag: alpha(ink, dark ? 0.4 : 0.32),
    ghost: alpha(ink, 0.25),
    edge: alpha(ink, dark ? 0.16 : 0.13),
    tagEdge: alpha(ink, dark ? 0.08 : 0.07),
    label: theme.palette.text.secondary,
    paper: theme.palette.background.paper
  };
  const dimmed = (index) => {
    if (matches) return !matches.has(index);
    if (focusSet) return !focusSet.has(index);
    return false;
  };
  const labelShown = (index) => {
    if (focusSet?.has(index) || matches?.has(index) || index === currentNoteIndex) return !dimmed(index) || index === focusIndex;
    if (graph.nodes[index].kind === "tag") return transform.s >= LABEL_ALL_SCALE;
    if (graph.nodes.length <= LABEL_ALL_BELOW || transform.s >= LABEL_ALL_SCALE) return true;
    return topLabels.has(index);
  };
  const positions = positionsRef.current;
  const ready = positions.length === graph.nodes.length;
  const active = activeIndex >= 0 ? graph.nodes[activeIndex] : null;
  const iconButtonSx = { width: 32, height: 32, borderRadius: "8px", color: "text.secondary", "&:hover": { color: "text.primary" } };
  const emptyMessage = scope === "local" ? currentNoteIndex < 0 ? { title: "\u5148\u6253\u5F00\u4E00\u7BC7\u7B14\u8BB0", body: "\u300C\u5F53\u524D\u7B14\u8BB0\u300D\u53EA\u663E\u793A\u6B63\u5728\u770B\u7684\u8FD9\u7BC7\u7B14\u8BB0\u548C\u5B83\u5468\u56F4\u7684\u5185\u5BB9\u3002" } : null : noteCount === 0 ? { title: "\u8FD8\u6CA1\u6709\u7B14\u8BB0", body: "\u5199\u4E0B\u7B2C\u4E00\u7BC7\u7B14\u8BB0\u540E\uFF0C\u8FD9\u91CC\u4F1A\u663E\u793A\u5B83\u4EEC\u4E4B\u95F4\u7684\u5173\u8054\u3002" } : null;
  const noRelations = !emptyMessage && graph.edges.length === 0;
  return /* @__PURE__ */ React.createElement(Box, { sx: { position: "relative", width: "100%", height: "100%", overflow: "hidden" } }, /* @__PURE__ */ React.createElement(Box, { sx: { position: "absolute", top: 12, left: 16, right: 16, zIndex: 2, display: "flex", alignItems: "center", gap: 1.5, pointerEvents: "none" } }, /* @__PURE__ */ React.createElement(Box, { sx: { minWidth: 0, pointerEvents: "auto" } }, /* @__PURE__ */ React.createElement(Typography, { sx: { fontSize: 15, fontWeight: 650, lineHeight: 1.3 } }, "\u56FE\u8C31"), /* @__PURE__ */ React.createElement(Typography, { sx: { fontSize: 12, color: "text.secondary", whiteSpace: "nowrap" } }, noteCount, " \u7BC7\u7B14\u8BB0 \xB7 ", linkCount, " \u6761\u94FE\u63A5", showTags && tagCount ? ` \xB7 ${tagCount} \u4E2A\u6807\u7B7E` : "")), /* @__PURE__ */ React.createElement(Box, { sx: { flex: 1 } }), /* @__PURE__ */ React.createElement(Box, { sx: { display: "flex", alignItems: "center", gap: 1, pointerEvents: "auto" } }, SegmentedControl ? /* @__PURE__ */ React.createElement(
    SegmentedControl,
    {
      ariaLabel: "\u56FE\u8C31\u8303\u56F4",
      value: scope,
      onChange: setScope,
      options: [
        { value: "all", label: "\u5168\u90E8" },
        { value: "local", label: "\u5F53\u524D\u7B14\u8BB0", disabled: currentNoteIndex < 0, tooltip: currentNoteIndex < 0 ? "\u5148\u6253\u5F00\u4E00\u7BC7\u7B14\u8BB0" : "\u53EA\u770B\u5F53\u524D\u7B14\u8BB0\u5468\u56F4" }
      ]
    }
  ) : null, /* @__PURE__ */ React.createElement(
    TextField,
    {
      size: "small",
      value: search,
      onChange: (event) => setSearch(event.target.value),
      placeholder: "\u641C\u7D22",
      sx: { width: 180, "& .MuiOutlinedInput-root": { height: 32, fontSize: 13 } },
      slotProps: { input: { startAdornment: /* @__PURE__ */ React.createElement(InputAdornment, { position: "start" }, /* @__PURE__ */ React.createElement(Icons.Search, { sx: { fontSize: 16, color: "text.disabled" } })) } }
    }
  ), /* @__PURE__ */ React.createElement(Tooltip, { title: "\u663E\u793A\u5185\u5BB9" }, /* @__PURE__ */ React.createElement(IconButton, { size: "small", "aria-label": "\u663E\u793A\u5185\u5BB9", onClick: (event) => setFilterAnchor(event.currentTarget), sx: iconButtonSx }, /* @__PURE__ */ React.createElement(Icons.Filter, { fontSize: "small" }))))), /* @__PURE__ */ React.createElement(
    Popover,
    {
      open: Boolean(filterAnchor),
      anchorEl: filterAnchor,
      onClose: () => setFilterAnchor(null),
      anchorOrigin: { vertical: "bottom", horizontal: "right" },
      transformOrigin: { vertical: "top", horizontal: "right" },
      slotProps: { paper: { sx: { mt: 0.75, p: 1, width: 240 } } }
    },
    [
      [showTags, setShowTags, "\u6807\u7B7E", "\u6709\u76F8\u540C\u6807\u7B7E\u7684\u7B14\u8BB0\u8FDE\u5728\u4E00\u8D77"],
      [showOrphans, setShowOrphans, "\u6CA1\u6709\u5173\u8054\u7684\u7B14\u8BB0", "\u5173\u6389\u540E\u53EA\u770B\u8FDE\u8D77\u6765\u7684\u90E8\u5206"],
      [showGhosts, setShowGhosts, "\u8FD8\u6CA1\u521B\u5EFA\u7684\u7B14\u8BB0", "\u53CC\u94FE\u6307\u5411\u3001\u4F46\u8FD8\u4E0D\u5B58\u5728\u7684\u7B14\u8BB0"]
    ].map(([checked, set, label, hint]) => /* @__PURE__ */ React.createElement(
      FormControlLabel,
      {
        key: label,
        sx: { display: "flex", alignItems: "flex-start", m: 0, px: 0.5, py: 0.25 },
        control: /* @__PURE__ */ React.createElement(Checkbox, { size: "small", checked, onChange: (event) => set(event.target.checked), sx: { mt: -0.25 } }),
        label: /* @__PURE__ */ React.createElement(Box, { sx: { pt: 0.5 } }, /* @__PURE__ */ React.createElement(Typography, { sx: { fontSize: 13 } }, label), /* @__PURE__ */ React.createElement(Typography, { sx: { fontSize: 11.5, color: "text.secondary" } }, hint))
      }
    ))
  ), /* @__PURE__ */ React.createElement(Box, { ref: containerRef, sx: { position: "absolute", inset: 0 } }, ready && !emptyMessage && /* @__PURE__ */ React.createElement(
    "svg",
    {
      ref: svgRef,
      width: size.w,
      height: size.h,
      role: "img",
      "aria-label": "\u7B14\u8BB0\u5173\u8054\u56FE",
      style: { display: "block", cursor: dragRef.current?.mode === "pan" ? "grabbing" : "default", userSelect: "none" },
      onMouseDown: onBackgroundDown
    },
    /* @__PURE__ */ React.createElement("g", { transform: `translate(${transform.tx}, ${transform.ty}) scale(${transform.s})` }, graph.edges.map(({ a, b, kind }, i) => {
      const pa = positions[a];
      const pb = positions[b];
      if (!pa || !pb) return null;
      const lit = focusIndex >= 0 && (a === focusIndex || b === focusIndex);
      const faded = focusSet && !lit || matches && !(matches.has(a) && matches.has(b));
      return /* @__PURE__ */ React.createElement(
        "line",
        {
          key: i,
          x1: pa.x,
          y1: pa.y,
          x2: pb.x,
          y2: pb.y,
          stroke: lit ? primary : kind === "tag" ? colors.tagEdge : colors.edge,
          strokeOpacity: lit ? 0.7 : faded ? 0.35 : 1,
          strokeWidth: (lit ? 1.4 : 1) / transform.s,
          strokeDasharray: graph.nodes[a].kind === "ghost" || graph.nodes[b].kind === "ghost" ? `${3 / transform.s} ${3 / transform.s}` : void 0
        }
      );
    }), graph.nodes.map((node, index) => {
      const p = positions[index];
      if (!p) return null;
      const r = nodeRadius(node, graph.degree[index]);
      const isActive = index === activeIndex;
      const isCurrent = index === currentNoteIndex;
      const lit = focusSet?.has(index) || matches?.has(index);
      const fade = dimmed(index);
      const fill = isActive || index === focusIndex ? primary : lit && focusIndex >= 0 ? alpha(primary, 0.55) : colors[node.kind];
      const opacity = fade ? 0.22 : 1;
      const fontSize = 11.5 / Math.max(transform.s, 0.6);
      return /* @__PURE__ */ React.createElement(
        "g",
        {
          key: node.key,
          transform: `translate(${p.x}, ${p.y})`,
          style: { cursor: "pointer" },
          onMouseEnter: () => {
            if (!dragRef.current) setHoverIndex(index);
          },
          onMouseLeave: () => {
            if (!dragRef.current) setHoverIndex(-1);
          },
          onMouseDown: (event) => onNodeDown(event, index),
          onDoubleClick: () => openNode(node)
        },
        /* @__PURE__ */ React.createElement("circle", { r: Math.max(r, 8) / Math.min(1, transform.s), fill: "transparent" }),
        node.kind === "whiteboard" ? /* @__PURE__ */ React.createElement("rect", { x: -r, y: -r, width: r * 2, height: r * 2, rx: r * 0.35, fill, opacity }) : node.kind === "tag" || node.kind === "ghost" ? /* @__PURE__ */ React.createElement(
          "circle",
          {
            r,
            fill: colors.paper,
            stroke: fill,
            strokeWidth: 1.4 / transform.s,
            strokeDasharray: node.kind === "ghost" ? `${2 / transform.s} ${2 / transform.s}` : void 0,
            opacity
          }
        ) : /* @__PURE__ */ React.createElement("circle", { r, fill, opacity }),
        isCurrent && /* @__PURE__ */ React.createElement("circle", { r: r + 3 / transform.s, fill: "none", stroke: primary, strokeWidth: 1.2 / transform.s, opacity }),
        labelShown(index) && /* @__PURE__ */ React.createElement(
          "text",
          {
            y: r + fontSize + 2 / transform.s,
            textAnchor: "middle",
            fontSize,
            fontWeight: isActive || index === focusIndex ? 600 : 400,
            fill: isActive || index === focusIndex ? ink : colors.label,
            opacity: fade ? 0.4 : 1,
            style: { pointerEvents: "none", paintOrder: "stroke", stroke: theme.palette.background.paper, strokeWidth: 3 / transform.s, strokeLinejoin: "round" }
          },
          node.kind === "tag" ? `#${node.title}` : node.title
        )
      );
    }))
  ), (emptyMessage || noRelations) && /* @__PURE__ */ React.createElement(Box, { sx: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" } }, /* @__PURE__ */ React.createElement(Box, { sx: (t) => ({ ...panelSx(t), maxWidth: 360, px: 2.5, py: 2, textAlign: "center", pointerEvents: "auto" }) }, /* @__PURE__ */ React.createElement(Icons.Graph, { sx: { fontSize: 28, color: "text.disabled", mb: 0.5 } }), /* @__PURE__ */ React.createElement(Typography, { sx: { fontSize: 14, fontWeight: 600, mb: 0.5 } }, emptyMessage?.title || "\u7B14\u8BB0\u4E4B\u95F4\u8FD8\u6CA1\u6709\u5173\u8054"), /* @__PURE__ */ React.createElement(Typography, { sx: { fontSize: 12.5, color: "text.secondary", lineHeight: 1.6 } }, emptyMessage?.body || "\u5728\u7B14\u8BB0\u91CC\u5199 [[\u7B14\u8BB0\u540D]]\u3001\u63D2\u5165\u53E6\u4E00\u7BC7\u7B14\u8BB0\u7684\u94FE\u63A5\uFF0C\u6216\u8005\u7ED9\u7B14\u8BB0\u52A0\u4E0A\u76F8\u540C\u7684\u6807\u7B7E\uFF0C\u5B83\u4EEC\u5C31\u4F1A\u5728\u8FD9\u91CC\u8FDE\u8D77\u6765\u3002")))), active && /* @__PURE__ */ React.createElement(
    DetailPanel,
    {
      node: active,
      index: activeIndex,
      graph,
      onClose: () => setActiveKey(null),
      onOpen: () => openNode(active),
      onSelect: (index) => {
        setActiveKey(graph.nodes[index].key);
        centerOn(index);
      }
    }
  ), /* @__PURE__ */ React.createElement(Box, { sx: (t) => ({ ...panelSx(t), position: "absolute", right: 16, bottom: 16, zIndex: 2, display: "flex", flexDirection: "column", p: 0.5, gap: 0.25 }) }, /* @__PURE__ */ React.createElement(Tooltip, { title: "\u653E\u5927", placement: "left" }, /* @__PURE__ */ React.createElement(IconButton, { size: "small", "aria-label": "\u653E\u5927", onClick: () => zoomBy(1.25), sx: iconButtonSx }, /* @__PURE__ */ React.createElement(Icons.ZoomIn, { fontSize: "small" }))), /* @__PURE__ */ React.createElement(Tooltip, { title: "\u7F29\u5C0F", placement: "left" }, /* @__PURE__ */ React.createElement(IconButton, { size: "small", "aria-label": "\u7F29\u5C0F", onClick: () => zoomBy(1 / 1.25), sx: iconButtonSx }, /* @__PURE__ */ React.createElement(Icons.ZoomOut, { fontSize: "small" }))), /* @__PURE__ */ React.createElement(Divider, { sx: { mx: 0.5 } }), /* @__PURE__ */ React.createElement(Tooltip, { title: "\u663E\u793A\u5168\u90E8", placement: "left" }, /* @__PURE__ */ React.createElement(IconButton, { size: "small", "aria-label": "\u663E\u793A\u5168\u90E8", onClick: () => {
    userMovedRef.current = false;
    fitToContent();
  }, sx: iconButtonSx }, /* @__PURE__ */ React.createElement(Icons.Fit, { fontSize: "small" })))), /* @__PURE__ */ React.createElement(Typography, { sx: { position: "absolute", left: 16, bottom: 14, zIndex: 1, fontSize: 11.5, color: "text.disabled", pointerEvents: "none" } }, "\u5355\u51FB\u67E5\u770B\u5173\u8054 \xB7 \u53CC\u51FB\u6253\u5F00 \xB7 \u62D6\u52A8\u6574\u7406 \xB7 \u6EDA\u8F6E\u7F29\u653E"));
};
const DetailPanel = ({ node, index, graph, onClose, onOpen, onSelect }) => {
  const neighbors = [...graph.adjacency[index].entries()].map(([neighbor, kind]) => ({ neighbor, kind, node: graph.nodes[neighbor] })).sort((a, b) => (a.kind === "tag") - (b.kind === "tag") || graph.degree[b.neighbor] - graph.degree[a.neighbor]);
  const note = node.note;
  const tags = note ? parseNoteTags(note.tags) : [];
  const meta = node.kind === "tag" ? `\u6807\u7B7E \xB7 ${neighbors.length} \u7BC7\u7B14\u8BB0` : node.kind === "ghost" ? "\u8FD8\u6CA1\u6709\u521B\u5EFA\u7684\u7B14\u8BB0" : `${node.kind === "whiteboard" ? "\u753B\u5E03" : "\u7B14\u8BB0"} \xB7 ${relativeTime(note?.updated_at || note?.created_at)}\u66F4\u65B0`;
  const excerpt = excerptOf(note);
  const openLabel = node.kind === "ghost" ? "\u521B\u5EFA\u8FD9\u7BC7\u7B14\u8BB0" : node.kind === "tag" ? null : "\u6253\u5F00";
  return /* @__PURE__ */ React.createElement(Box, { sx: (t) => ({ ...panelSx(t), position: "absolute", top: 64, right: 16, bottom: 148, zIndex: 3, width: 300, display: "flex", flexDirection: "column", overflow: "hidden" }) }, /* @__PURE__ */ React.createElement(Box, { sx: { display: "flex", alignItems: "flex-start", gap: 1, p: 1.75, pb: 1.25 } }, /* @__PURE__ */ React.createElement(Box, { sx: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement(Typography, { sx: { fontSize: 15, fontWeight: 650, lineHeight: 1.35, overflowWrap: "anywhere" } }, node.kind === "tag" ? `#${node.title}` : node.title), /* @__PURE__ */ React.createElement(Typography, { sx: { fontSize: 12, color: "text.secondary", mt: 0.25 } }, meta)), /* @__PURE__ */ React.createElement(IconButton, { size: "small", "aria-label": "\u5173\u95ED", onClick: onClose, sx: { mt: -0.5, mr: -0.75, color: "text.secondary" } }, /* @__PURE__ */ React.createElement(Icons.Close, { fontSize: "small" }))), (excerpt || tags.length > 0) && /* @__PURE__ */ React.createElement(Box, { sx: { px: 1.75, pb: 1.25 } }, excerpt && /* @__PURE__ */ React.createElement(Typography, { sx: { fontSize: 12.5, color: "text.secondary", lineHeight: 1.65, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" } }, excerpt), tags.length > 0 && /* @__PURE__ */ React.createElement(Box, { sx: { display: "flex", flexWrap: "wrap", gap: 0.5, mt: excerpt ? 1 : 0 } }, tags.slice(0, 6).map((tag) => /* @__PURE__ */ React.createElement(Typography, { key: tag, component: "span", sx: { fontSize: 11.5, color: "text.secondary", px: 0.75, py: 0.125, borderRadius: "6px", bgcolor: "action.hover" } }, "#", tag)))), /* @__PURE__ */ React.createElement(Divider, null), /* @__PURE__ */ React.createElement(Typography, { sx: { px: 1.75, pt: 1.25, pb: 0.5, fontSize: 12, fontWeight: 600, color: "text.secondary" } }, "\u5173\u8054 ", neighbors.length), /* @__PURE__ */ React.createElement(Box, { sx: { flex: 1, minHeight: 0, overflowY: "auto", px: 0.75, pb: 0.75 } }, neighbors.length === 0 && /* @__PURE__ */ React.createElement(Typography, { sx: { px: 1, py: 1, fontSize: 12.5, color: "text.disabled" } }, "\u8FD8\u6CA1\u6709\u548C\u5176\u4ED6\u5185\u5BB9\u8FDE\u8D77\u6765"), neighbors.map(({ neighbor, kind, node: other }) => /* @__PURE__ */ React.createElement(
    ButtonBase,
    {
      key: other.key,
      onClick: () => onSelect(neighbor),
      sx: { width: "100%", display: "flex", alignItems: "center", gap: 1, px: 1, py: 0.75, borderRadius: "8px", textAlign: "left", "&:hover": { bgcolor: "action.hover" } }
    },
    /* @__PURE__ */ React.createElement(Typography, { noWrap: true, sx: { flex: 1, minWidth: 0, fontSize: 13 } }, other.kind === "tag" ? `#${other.title}` : other.title),
    /* @__PURE__ */ React.createElement(Typography, { sx: { flexShrink: 0, fontSize: 11, color: "text.disabled" } }, other.kind === "ghost" ? "\u672A\u521B\u5EFA" : RELATION_LABEL[kind])
  ))), openLabel && /* @__PURE__ */ React.createElement(Box, { sx: { p: 1.25, borderTop: 1, borderColor: "divider" } }, /* @__PURE__ */ React.createElement(Button, { fullWidth: true, variant: "contained", disableElevation: true, size: "small", startIcon: node.kind === "ghost" ? null : /* @__PURE__ */ React.createElement(Icons.Open, { sx: { fontSize: 16 } }), onClick: onOpen }, openLabel)));
};
var index_default = GraphView;
export {
  index_default as default
};
