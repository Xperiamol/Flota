// 组件草稿预跑：按清单声明的每个尺寸、浅色深色各运行一次，收集报错、白屏、溢出等问题。
// 对话智能体提交组件代码时和确认保存前都会用到（代码由智能体自己写，问题原样交还给它修）。
import { collectProblems, probeWidget } from '../../components/widgets/WidgetProbeHost'

const SIZE_LABELS = { full: '组件主页（full）', medium: '笔记 / 小窗（medium）', compact: '首页卡片（compact）' }

/** 按组件声明的每个尺寸各预跑一次（首页卡片等小尺寸布局也要能跑通），问题标上出错的尺寸 */
export const probeAllSizes = async (draftId, sizes, signal) => {
  const declared = Object.keys(SIZE_LABELS).filter((size) => sizes?.includes(size))
  const targets = (declared.length ? declared : ['full']).flatMap(size => ['light', 'dark'].map(theme => ({ size, theme, width: size === 'full' ? (theme === 'light' ? 960 : 600) : size === 'compact' ? 320 : 480 })))
  const results = []
  for (const target of targets) {
    if (signal?.aborted) break
    results.push(await probeWidget(draftId, target.size, signal, target))
  }
  // 同一个错误在多个尺寸都出现时合并成一条
  const merged = new Map()
  results.forEach((probe, index) => collectProblems(probe).forEach((problem) => {
    const key = `${problem.message}\n${problem.stack || ''}`
    if (!merged.has(key)) merged.set(key, { problem, sizes: [] })
    merged.get(key).sizes.push(targets[index])
  }))
  return [...merged.values()].map(({ problem, sizes: hit }) => (targets.length > 1
    ? { ...problem, message: `[${hit.map(({ size, theme, width }) => `${SIZE_LABELS[size]} ${theme === 'dark' ? '深色' : '浅色'} ${width}px`).join('、')}] ${problem.message}` }
    : problem))
}
