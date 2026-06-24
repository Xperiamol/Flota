/**
 * 甘特图（Gantt）生成器
 * 解析 Mermaid gantt 子集：
 *   gantt
 *     title 项目计划
 *     dateFormat YYYY-MM-DD
 *     section 准备阶段
 *     需求评审 :a1, 2025-01-01, 3d
 *     原型设计 :a2, after a1, 5d
 *     section 开发阶段
 *     里程碑节点 :milestone, m1, after a2, 0d
 *     接口开发 :crit, b1, 2025-01-10, 7d
 */
import logger from '../logger'
import {
  DIAGRAM_THEME,
  beautifyElements,
  containsCJK,
  makeArrow,
  makeLine,
  makeRect,
  makeText,
  measureTextBlock,
  palette,
  wrapLabel,
} from './shared'

const ONE_DAY = 86400000

const parseDate = (str) => {
  if (!str) return null
  const m = String(str).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  const t = Date.parse(str)
  return Number.isNaN(t) ? null : new Date(t)
}

const parseDuration = (str) => {
  if (!str) return ONE_DAY
  const m = String(str).match(/^(\d+(?:\.\d+)?)\s*(d|w|h|m)?$/i)
  if (!m) return ONE_DAY
  const n = parseFloat(m[1])
  const unit = (m[2] || 'd').toLowerCase()
  if (unit === 'w') return n * 7 * ONE_DAY
  if (unit === 'h') return n * (ONE_DAY / 24)
  if (unit === 'm') return n * (ONE_DAY / 1440)
  return n * ONE_DAY
}

const formatDate = (d) => {
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const parseGantt = (code) => {
  const lines = code.split('\n').map((l) => l.trim()).filter(Boolean)
  const result = { title: '', sections: [], tasks: [] }
  let currentSection = '默认'
  for (const line of lines) {
    if (/^gantt\b/i.test(line)) continue
    if (/^title\s+/i.test(line)) {
      result.title = line.replace(/^title\s+/i, '').trim()
      continue
    }
    if (/^dateformat\b/i.test(line) || /^axisformat\b/i.test(line) || /^excludes\b/i.test(line)) continue
    const sm = line.match(/^section\s+(.+)$/i)
    if (sm) {
      currentSection = sm[1].trim()
      result.sections.push(currentSection)
      continue
    }
    const cm = line.match(/^([^:]+):\s*(.+)$/)
    if (cm) {
      const name = cm[1].trim()
      const parts = cm[2].split(',').map((s) => s.trim()).filter(Boolean)
      const flags = []
      let id = null
      let startSpec = null
      let durationSpec = null
      for (const part of parts) {
        if (/^(crit|active|done|milestone)$/i.test(part)) flags.push(part.toLowerCase())
        else if (/^[a-z][\w-]*$/i.test(part) && id == null) id = part
        else if (startSpec == null) startSpec = part
        else if (durationSpec == null) durationSpec = part
      }
      result.tasks.push({
        section: currentSection,
        name,
        id,
        startSpec,
        durationSpec,
        isCritical: flags.includes('crit'),
        isMilestone: flags.includes('milestone'),
        isDone: flags.includes('done'),
      })
    }
  }
  return result
}

const resolveSchedule = (parsed) => {
  const taskMap = new Map()
  const order = []
  let earliest = null
  let latest = null

  for (const task of parsed.tasks) {
    let start
    let dependsOn = null
    if (task.startSpec && /^after\s+/i.test(task.startSpec)) {
      const after = task.startSpec.replace(/^after\s+/i, '').trim().split(/\s+/)[0]
      dependsOn = after
      const depTask = taskMap.get(after)
      start = depTask ? new Date(depTask.end.getTime()) : (earliest || new Date(Date.UTC(2025, 0, 1)))
    } else {
      const d = parseDate(task.startSpec)
      start = d || (earliest ? new Date(earliest) : new Date(Date.UTC(2025, 0, 1)))
    }
    const duration = task.isMilestone ? 0 : parseDuration(task.durationSpec) || ONE_DAY
    const end = new Date(start.getTime() + duration)
    const resolved = { ...task, start, end, dependsOn }
    if (task.id) taskMap.set(task.id, resolved)
    order.push(resolved)
    if (!earliest || start < earliest) earliest = start
    if (!latest || end > latest) latest = end
  }
  return { tasks: order, earliest: earliest || new Date(), latest: latest || new Date() }
}

/**
 * @deprecated 已被 composer 通用合成引擎取代（src/utils/diagrams/composer）。
 * 仅作为旧路径兜底保留，勿在新代码引用。
 */
export const renderGantt = (mermaidCode, { offsetX = 100, offsetY = 100 } = {}) => {
  const parsed = parseGantt(mermaidCode)
  const { tasks, earliest, latest } = resolveSchedule(parsed)

  const totalDays = Math.max(1, Math.ceil((latest - earliest) / ONE_DAY))
  const DAY_W = totalDays > 60 ? 14 : totalDays > 30 ? 22 : 32
  const ROW_H = 36
  const ROW_GAP = 8
  const LABEL_W = 200
  const HEADER_H = 64
  const SECTION_LABEL_W = 100

  const elements = []
  const chartLeft = offsetX + LABEL_W
  const chartTop = offsetY + HEADER_H

  // 标题
  if (parsed.title) {
    const titleMetrics = measureTextBlock(parsed.title, 20)
    elements.push(makeText({
      x: offsetX,
      y: offsetY,
      text: parsed.title,
      fontSize: 20,
      color: DIAGRAM_THEME.text,
      align: 'left',
      verticalAlign: 'top',
      metrics: titleMetrics,
    }))
  }

  // 时间轴：日期刻度
  const tickEvery = totalDays > 60 ? 7 : totalDays > 14 ? 3 : 1
  for (let d = 0; d <= totalDays; d += tickEvery) {
    const x = chartLeft + d * DAY_W
    const date = new Date(earliest.getTime() + d * ONE_DAY)
    elements.push(makeLine({
      x,
      y: chartTop - 12,
      points: [[0, 0], [0, tasks.length * (ROW_H + ROW_GAP) + 12]],
      stroke: '#e2e8f0',
      strokeWidth: 1,
      dashed: d % (tickEvery * 2) !== 0,
    }))
    const label = formatDate(date)
    const m = measureTextBlock(label, 11)
    elements.push(makeText({
      x: x - m.width / 2,
      y: chartTop - 30,
      text: label,
      fontSize: 11,
      color: DIAGRAM_THEME.textSecondary,
      metrics: m,
    }))
  }

  // 主基线
  elements.push(makeLine({
    x: chartLeft,
    y: chartTop - 4,
    points: [[0, 0], [totalDays * DAY_W, 0]],
    stroke: DIAGRAM_THEME.line,
    strokeWidth: 1.5,
  }))

  // 任务行
  const idToCenter = new Map()
  const sectionColors = new Map()
  let sectionIndex = 0
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]
    const rowY = chartTop + i * (ROW_H + ROW_GAP)
    const startDays = Math.round((task.start - earliest) / ONE_DAY)
    const durDays = Math.max(0, Math.round((task.end - task.start) / ONE_DAY))
    const barX = chartLeft + startDays * DAY_W
    const barW = task.isMilestone ? ROW_H : Math.max(DAY_W * 0.6, durDays * DAY_W)

    if (!sectionColors.has(task.section)) {
      sectionColors.set(task.section, palette(sectionIndex++))
    }
    const baseColor = sectionColors.get(task.section)
    const barColor = task.isCritical
      ? DIAGRAM_THEME.semantics.danger
      : task.isDone
        ? DIAGRAM_THEME.semantics.success
        : task.isMilestone
          ? DIAGRAM_THEME.semantics.warning
          : baseColor

    // 行底纹
    if (i % 2 === 0) {
      elements.push(makeRect({
        x: chartLeft,
        y: rowY - 2,
        width: totalDays * DAY_W,
        height: ROW_H,
        bg: '#f8fafc',
        stroke: '#f1f5f9',
        strokeWidth: 0.5,
        rounded: false,
      }))
    }

    // 任务名
    const labelText = wrapLabel(task.name, containsCJK(task.name) ? 9 : 22)
    const labelMetrics = measureTextBlock(labelText, 13)
    elements.push(makeText({
      x: offsetX + SECTION_LABEL_W,
      y: rowY + ROW_H / 2 - labelMetrics.height / 2,
      text: labelText,
      fontSize: 13,
      color: DIAGRAM_THEME.text,
      align: 'left',
      metrics: labelMetrics,
    }))
    // section 标签
    if (i === 0 || tasks[i - 1].section !== task.section) {
      const sm = measureTextBlock(task.section, 12)
      elements.push(makeText({
        x: offsetX,
        y: rowY + ROW_H / 2 - sm.height / 2,
        text: task.section,
        fontSize: 12,
        color: baseColor.stroke,
        align: 'left',
        metrics: sm,
      }))
    }

    // 任务条
    if (task.isMilestone) {
      // 菱形里程碑
      const cx = barX
      const cy = rowY + ROW_H / 2
      const r = ROW_H * 0.35
      elements.push({
        ...makeRect({
          x: cx - r,
          y: cy - r,
          width: r * 2,
          height: r * 2,
          bg: barColor.bg,
          stroke: barColor.stroke,
          strokeWidth: 2,
          rounded: false,
        }),
        type: 'diamond',
        roundness: null,
      })
    } else {
      elements.push(makeRect({
        x: barX,
        y: rowY + 4,
        width: barW,
        height: ROW_H - 8,
        bg: barColor.bg,
        stroke: barColor.stroke,
        strokeWidth: task.isCritical ? 2 : 1.5,
      }))
    }
    if (task.id) idToCenter.set(task.id, { x: barX + barW, y: rowY + ROW_H / 2, leftX: barX })
  }

  // 依赖箭头
  for (const task of tasks) {
    if (!task.dependsOn || !task.id) continue
    const fromAnchor = idToCenter.get(task.dependsOn)
    const toAnchor = idToCenter.get(task.id)
    if (!fromAnchor || !toAnchor) continue
    const dx = toAnchor.leftX - fromAnchor.x
    const dy = toAnchor.y - fromAnchor.y
    elements.push(makeArrow({
      x: fromAnchor.x,
      y: fromAnchor.y,
      points: [[0, 0], [Math.max(8, dx / 2), 0], [Math.max(8, dx / 2), dy], [dx, dy]],
      stroke: DIAGRAM_THEME.textSecondary,
      strokeWidth: 1.5,
      dashed: true,
    }))
  }

  logger.log('[gantt] 任务:', tasks.length, '元素:', elements.length)
  return beautifyElements(elements)
}
