/**
 * 分层图布局（Sugiyama-lite）
 *
 * composer 原本是「盒子排版引擎」：只会把节点按容器树摆整齐，画连线时再事后拉箭头，
 * 所以遇到「多节点 + 多连线」的关系图（ER / 流程 / 依赖图）必然交叉缠绕。
 *
 * 本模块补上缺失的核心：图布局算法。给定「节点 + 有向边」，按依赖关系分层、
 * 同层用重心法错峰减少交叉，输出每个节点的坐标。这是自研引擎能画关系图的地基。
 *
 * 跨层连线（源/目标相隔 ≥2 层）会在中间每一层插入「虚拟节点」(dummy)。虚拟节点和真实
 * 节点一起参与同层排序与去重叠，于是会在真实节点之间挤出一条专属「走线通道」。连线沿
 * 这些通道的中心正交折返，因此绝不会穿过中间层的节点本体（这是连线穿节点 bug 的根治）。
 *
 * 入参：
 *   nodes: [{ id, w, h }]
 *   edges: [{ from, to }]（用 id 引用）
 *   opts:  { direction?: 'TB'|'LR', layerGap?, nodeGap?, laneWidth? }
 * 出参：
 *   { pos: Map<id, {x,y}>, width, height, routes }
 *     routes 与入参 edges 等长一一对应；跨多层的边给出 [{x,y}...] 折线（图局部坐标），
 *     其余（同层 / 相邻层）为 null，交由调用方按端口默认走线。
 */

export const layoutGraph = (nodes, edges, opts = {}) => {
  const dir = opts.direction === 'LR' ? 'LR' : 'TB'
  const layerGap = opts.layerGap ?? 72
  const nodeGap = opts.nodeGap ?? 40
  const laneW = opts.laneWidth ?? 18

  const n = nodes.length
  if (!n) return { pos: new Map(), width: 0, height: 0, routes: [] }

  // 尺寸兜底：上游若给了非数值（NaN/undefined/字符串），分层与坐标累加会整片产出 NaN。
  // 这里统一钳为有限非负数，保证布局结果始终可渲染。
  const fin = (v) => (Number.isFinite(v) ? Math.max(0, v) : 0)
  nodes = nodes.map((nd) => ({ ...nd, w: fin(nd.w), h: fin(nd.h) }))

  const idIndex = new Map()
  nodes.forEach((nd, i) => idIndex.set(String(nd.id), i))

  // 1) 规整边（保留在 edges 中的原始下标，供 routes 一一对应）
  const elist = []
  ;(edges || []).forEach((e, ei) => {
    const a = idIndex.get(String(e.from))
    const b = idIndex.get(String(e.to))
    if (a == null || b == null || a === b) return
    elist.push([a, b, ei])
  })

  // 2) 去环：DFS 标记回边（仅在分层时忽略，画线仍保留）
  const adj = Array.from({ length: n }, () => [])
  for (const [a, b] of elist) adj[a].push(b)
  const color = new Array(n).fill(0) // 0 未访问 / 1 在递归栈 / 2 完成
  const back = new Set()
  const stack = []
  for (let s = 0; s < n; s++) {
    if (color[s] !== 0) continue
    stack.push([s, 0])
    color[s] = 1
    while (stack.length) {
      const top = stack[stack.length - 1]
      const [u, ptr] = top
      if (ptr < adj[u].length) {
        top[1]++
        const v = adj[u][ptr]
        if (color[v] === 1) back.add(`${u}->${v}`)
        else if (color[v] === 0) { color[v] = 1; stack.push([v, 0]) }
      } else {
        color[u] = 2
        stack.pop()
      }
    }
  }
  const dag = elist.filter(([a, b]) => !back.has(`${a}->${b}`))

  // 3) 最长路径分层
  const dadj = Array.from({ length: n }, () => [])
  const indeg = new Array(n).fill(0)
  for (const [a, b] of dag) { dadj[a].push(b); indeg[b]++ }
  const layer = new Array(n).fill(0)
  const indeg2 = indeg.slice()
  const queue = []
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i)
  let head = 0
  while (head < queue.length) {
    const u = queue[head++]
    for (const v of dadj[u]) {
      if (layer[u] + 1 > layer[v]) layer[v] = layer[u] + 1
      if (--indeg2[v] === 0) queue.push(v)
    }
  }

  // 4) 扩展节点集 = 真实节点 + 虚拟节点（为跨层边在中间每层补占位）
  //    尺寸数组 W/H 与层号 nodeLayer 都按「真实在前、虚拟在后」排布。
  const W = nodes.map((nd) => nd.w)
  const H = nodes.map((nd) => nd.h)
  const nodeLayer = layer.slice()
  const isDummy = (i) => i >= n
  const addDummy = (lay) => {
    const id = W.length
    // 虚拟节点只在交叉轴占一条窄道（laneW），主轴尺寸为 0（不撑高所在层）
    W.push(dir === 'TB' ? laneW : 0)
    H.push(dir === 'TB' ? 0 : laneW)
    nodeLayer.push(lay)
    return id
  }

  // 每条边的「链」：from → (中间各层 dummy) → to。
  // 同层边（la===lb）保持默认走线（null）；其余（含相邻层）都建链，让连线全程只在
  // 「层间空隙」做横向折返、只在 dummy 预留的窄道做纵向穿层，从根上不碰任何节点本体。
  const chains = new Array((edges || []).length).fill(null)
  const orderEdges = [] // 仅用于同层排序：始终存 [低层节点, 高层节点]
  for (const [a, b, ei] of elist) {
    const la = nodeLayer[a]
    const lb = nodeLayer[b]
    if (la === lb) continue                 // 同层兄弟边，默认走线
    const step = lb > la ? 1 : -1
    const chain = [a]
    for (let L = la + step; L !== lb; L += step) chain.push(addDummy(L))
    chain.push(b)
    chains[ei] = chain
    for (let k = 0; k < chain.length - 1; k++) {
      const u = chain[k]
      const v = chain[k + 1]
      orderEdges.push(nodeLayer[u] < nodeLayer[v] ? [u, v] : [v, u])
    }
  }

  const N = W.length
  const mainSize = (i) => (dir === 'TB' ? H[i] : W[i])
  const crossSize = (i) => (dir === 'TB' ? W[i] : H[i])

  const maxLayer = Math.max(0, ...nodeLayer)
  const layers = Array.from({ length: maxLayer + 1 }, () => [])
  for (let i = 0; i < N; i++) layers[nodeLayer[i]].push(i)

  // 5) 同层排序：重心法减少交叉（含 dummy）
  const up = Array.from({ length: N }, () => [])
  const down = Array.from({ length: N }, () => [])
  for (const [lo, hi] of orderEdges) { down[lo].push(hi); up[hi].push(lo) }

  const order = layers.map((arr) => arr.slice())
  const posInLayer = new Array(N).fill(0)
  const reindex = () => order.forEach((arr) => arr.forEach((v, idx) => { posInLayer[v] = idx }))
  reindex()
  const bary = (v, neigh) => {
    if (!neigh.length) return posInLayer[v]
    let s = 0
    for (const w of neigh) s += posInLayer[w]
    return s / neigh.length
  }
  for (let iter = 0; iter < 4; iter++) {
    for (let L = 1; L <= maxLayer; L++) {
      order[L].sort((p, q) => bary(p, up[p]) - bary(q, up[q]))
      reindex()
    }
    for (let L = maxLayer - 1; L >= 0; L--) {
      order[L].sort((p, q) => bary(p, down[p]) - bary(q, down[q]))
      reindex()
    }
  }

  // 6) 交叉轴坐标：重心对齐 + 同层去重叠（左→右单调推开）
  const cross = new Array(N).fill(0) // 节点中心在交叉轴上的坐标
  for (const arr of order) {
    let c = 0
    for (const v of arr) {
      cross[v] = c + crossSize(v) / 2
      c += crossSize(v) + nodeGap
    }
  }
  const align = (neighOf) => {
    for (let L = 0; L <= maxLayer; L++) {
      const arr = order[L]
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i]
        const ns = neighOf(v)
        let target = cross[v]
        if (ns.length) {
          let s = 0
          for (const w of ns) s += cross[w]
          target = s / ns.length
        }
        if (i > 0) {
          const prev = arr[i - 1]
          const minC = cross[prev] + crossSize(prev) / 2 + nodeGap + crossSize(v) / 2
          if (target < minC) target = minC
        }
        cross[v] = target
      }
    }
  }
  for (let iter = 0; iter < 3; iter++) {
    align((v) => up[v])
    align((v) => down[v])
  }

  // 7) 主轴坐标：层间累加（每层取该层最大主轴尺寸）
  const layerMain = new Array(maxLayer + 1).fill(0)
  const layerExtent = new Array(maxLayer + 1).fill(0)
  let m = 0
  for (let L = 0; L <= maxLayer; L++) {
    let maxS = 0
    for (const v of layers[L]) maxS = Math.max(maxS, mainSize(v))
    layerMain[L] = m
    layerExtent[L] = maxS
    m += maxS + layerGap
  }

  // 归一化交叉轴到 >= 0（仅按真实节点取基准，保证与 pos 对齐）
  let minCross = Infinity
  for (let i = 0; i < n; i++) minCross = Math.min(minCross, cross[i] - crossSize(i) / 2)
  if (!isFinite(minCross)) minCross = 0

  // 真实节点坐标
  const pos = new Map()
  let width = 0
  let height = 0
  for (let i = 0; i < n; i++) {
    const cc = cross[i] - crossSize(i) / 2 - minCross
    const mm = layerMain[layer[i]]
    const x = dir === 'TB' ? cc : mm
    const y = dir === 'TB' ? mm : cc
    pos.set(String(nodes[i].id), { x, y })
    width = Math.max(width, x + nodes[i].w)
    height = Math.max(height, y + nodes[i].h)
  }

  // 8) 折线路由：沿链上相邻节点正交折返。
  //    纵向穿层只走 dummy 预留的窄道、横向折返只走「层间空隙」，因此全程不碰任何节点本体。
  //    为避免同一节点的多条边在边缘中点叠成一条粗线，这里把出/入端口沿节点交叉轴边宽扇形铺开。
  const crossCenterN = (i) => cross[i] - minCross
  const crossHalf = (i) => crossSize(i) / 2
  const mainTopOf = (i) => (isDummy(i) ? layerMain[nodeLayer[i]] + layerExtent[nodeLayer[i]] / 2 : layerMain[nodeLayer[i]])
  const mainBotOf = (i) => (isDummy(i) ? mainTopOf(i) : layerMain[nodeLayer[i]] + mainSize(i))
  const toXY = (c, mn) => (dir === 'TB' ? { x: c, y: mn } : { x: mn, y: c })

  // 端口分配：每个真实节点把「从它出发 / 到它结束」的链端按相邻节点交叉位置排序，
  // 沿其边宽 70% 均匀铺开，得到每条链在该端点的交叉坐标。
  const exitInfo = new Map()
  const enterInfo = new Map()
  for (let ei = 0; ei < chains.length; ei++) {
    const chain = chains[ei]
    if (!chain) continue
    const src = chain[0], nb1 = chain[1]
    const tgt = chain[chain.length - 1], nb2 = chain[chain.length - 2]
    if (!exitInfo.has(src)) exitInfo.set(src, [])
    exitInfo.get(src).push({ ei, nb: crossCenterN(nb1) })
    if (!enterInfo.has(tgt)) enterInfo.set(tgt, [])
    enterInfo.get(tgt).push({ ei, nb: crossCenterN(nb2) })
  }
  const portOf = new Map()
  const assignPorts = (info, tag) => {
    for (const [ni, list] of info) {
      list.sort((p, q) => p.nb - q.nb)
      const c = crossCenterN(ni)
      const span = crossHalf(ni) * 1.4
      const mm = list.length
      list.forEach((it, idx) => {
        const t = mm <= 1 ? 0 : (idx / (mm - 1) - 0.5)
        portOf.set(`${it.ei}|${tag}`, c + t * span)
      })
    }
  }
  assignPorts(exitInfo, 'exit')
  assignPorts(enterInfo, 'enter')

  const routes = new Array((edges || []).length).fill(null)
  for (let ei = 0; ei < chains.length; ei++) {
    const chain = chains[ei]
    if (!chain) continue
    const crossAt = (k) => {
      if (k === 0) return portOf.get(`${ei}|exit`) ?? crossCenterN(chain[k])
      if (k === chain.length - 1) return portOf.get(`${ei}|enter`) ?? crossCenterN(chain[k])
      return crossCenterN(chain[k])
    }
    const flat = []
    const push = (c, mn) => {
      const pt = toXY(c, mn)
      const last = flat[flat.length - 1]
      if (!last || Math.abs(last.x - pt.x) > 0.5 || Math.abs(last.y - pt.y) > 0.5) flat.push(pt)
    }
    for (let k = 0; k < chain.length - 1; k++) {
      const A = chain[k], B = chain[k + 1]
      const aC = crossAt(k), bC = crossAt(k + 1)
      const aMid = (mainTopOf(A) + mainBotOf(A)) / 2
      const bMid = (mainTopOf(B) + mainBotOf(B)) / 2
      let aExit, bEnter
      if (aMid <= bMid) { aExit = mainBotOf(A); bEnter = mainTopOf(B) }
      else { aExit = mainTopOf(A); bEnter = mainBotOf(B) }
      const mid = (aExit + bEnter) / 2
      push(aC, aExit); push(aC, mid); push(bC, mid); push(bC, bEnter)
    }
    routes[ei] = flat
  }

  return { pos, width, height, routes }
}
