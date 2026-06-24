/**
 * 鱼骨图 / 石川图（Fishbone / Ishikawa）生成器
 * Mermaid 没有原生 fishbone，定义自有 DSL：
 *   fishbone
 *   problem: 项目延期
 *   bone: 人员
 *     - 招聘困难
 *     - 培训不足
 *   bone: 流程
 *     - 评审环节冗长
 *     - 缺少自动化
 *   bone: 工具
 *     - 构建不稳定
 *   bone: 外部
 *     - 第三方接口变更
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

const parseFishbone = (code) => {
  const lines = code.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim())
  const result = { problem: '问题', bones: [] }
  let currentBone = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^fishbone\b/i.test(trimmed)) continue
    const pm = trimmed.match(/^problem\s*[:：]\s*(.+)$/i)
    if (pm) {
      result.problem = pm[1].trim()
      continue
    }
    const bm = trimmed.match(/^bone\s*[:：]\s*(.+)$/i)
    if (bm) {
      currentBone = { label: bm[1].trim(), causes: [] }
      result.bones.push(currentBone)
      continue
    }
    const cm = trimmed.match(/^[-*•]\s*(.+)$/)
    if (cm && currentBone) {
      currentBone.causes.push(cm[1].trim())
    }
  }
  return result
}

/**
 * @deprecated 已被 composer 通用合成引擎取代（src/utils/diagrams/composer）。
 * 仅作为旧路径兜底保留，勿在新代码引用。
 */
export const renderFishbone = (code, { offsetX = 100, offsetY = 100 } = {}) => {
  const { problem, bones } = parseFishbone(code)
  const elements = []

  const SPINE_LEFT = offsetX + 80
  const SPINE_LEN = Math.max(720, bones.length * 180 + 120)
  const SPINE_RIGHT = SPINE_LEFT + SPINE_LEN
  const CENTER_Y = offsetY + 240

  // 头部（问题方框）
  const problemWrap = wrapLabel(problem, containsCJK(problem) ? 9 : 18)
  const problemMetrics = measureTextBlock(problemWrap, 16)
  const headW = Math.max(160, problemMetrics.width + 32)
  const headH = Math.max(60, problemMetrics.height + 24)
  const headColor = DIAGRAM_THEME.semantics.danger
  elements.push(makeRect({
    x: SPINE_RIGHT,
    y: CENTER_Y - headH / 2,
    width: headW,
    height: headH,
    bg: headColor.bg,
    stroke: headColor.stroke,
    strokeWidth: 2.5,
  }))
  elements.push(makeText({
    x: SPINE_RIGHT + headW / 2 - problemMetrics.width / 2,
    y: CENTER_Y - problemMetrics.height / 2,
    text: problemWrap,
    fontSize: 16,
    color: DIAGRAM_THEME.text,
    metrics: problemMetrics,
  }))

  // 主骨（脊椎）— 带箭头指向问题
  elements.push(makeArrow({
    x: SPINE_LEFT,
    y: CENTER_Y,
    points: [[0, 0], [SPINE_RIGHT - SPINE_LEFT, 0]],
    stroke: DIAGRAM_THEME.text,
    strokeWidth: 3,
  }))

  // 主因（大骨）：上下交替分布
  const half = Math.ceil(bones.length / 2)
  const upper = bones.slice(0, half)
  const lower = bones.slice(half)
  const sectionStep = SPINE_LEN / (Math.max(upper.length, lower.length) + 1)

  const placeBone = (bone, index, side, total, colorIdx) => {
    const x = SPINE_LEFT + sectionStep * (index + 1)
    const reach = 160
    const dy = side === 'up' ? -reach : reach
    const endX = x - reach * 0.55
    const endY = CENTER_Y + dy
    const color = palette(colorIdx)

    // 大骨斜线
    elements.push(makeLine({
      x,
      y: CENTER_Y,
      points: [[0, 0], [endX - x, dy]],
      stroke: color.stroke,
      strokeWidth: 2.5,
    }))

    // 大骨标签
    const wrap = wrapLabel(bone.label, containsCJK(bone.label) ? 8 : 14)
    const m = measureTextBlock(wrap, 14)
    const labelW = m.width + 24
    const labelH = m.height + 14
    elements.push(makeRect({
      x: endX - labelW / 2,
      y: endY - labelH / 2,
      width: labelW,
      height: labelH,
      bg: color.bg,
      stroke: color.stroke,
      strokeWidth: 2,
    }))
    elements.push(makeText({
      x: endX - m.width / 2,
      y: endY - m.height / 2,
      text: wrap,
      fontSize: 14,
      color: DIAGRAM_THEME.text,
      metrics: m,
    }))

    // 子因（小骨）— 沿着大骨上分布
    const causes = bone.causes || []
    const span = causes.length
    for (let i = 0; i < span; i++) {
      const t = (i + 1) / (span + 1)
      const px = x + (endX - x) * t
      const py = CENTER_Y + dy * t
      const causeReach = 70
      const cx = px - causeReach
      const cy = py
      elements.push(makeLine({
        x: px,
        y: py,
        points: [[0, 0], [cx - px, 0]],
        stroke: color.stroke,
        strokeWidth: 1.5,
      }))
      const cause = causes[i]
      const cw = wrapLabel(cause, containsCJK(cause) ? 7 : 14)
      const cm = measureTextBlock(cw, 12)
      elements.push(makeText({
        x: cx - cm.width - 6,
        y: cy - cm.height / 2,
        text: cw,
        fontSize: 12,
        color: DIAGRAM_THEME.textSecondary,
        align: 'left',
        metrics: cm,
      }))
    }
  }

  upper.forEach((bone, idx) => placeBone(bone, idx, 'up', upper.length, idx))
  lower.forEach((bone, idx) => placeBone(bone, idx, 'down', lower.length, upper.length + idx))

  logger.log('[fishbone] 主骨:', bones.length, '元素:', elements.length)
  return beautifyElements(elements)
}
