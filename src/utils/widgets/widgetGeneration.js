import { collectProblems, probeWidget } from '../../components/widgets/WidgetProbeHost'

const MAX_FIX_ROUNDS = 3

const SIZE_LABELS = { full: '组件主页（full）', medium: '笔记 / 小窗（medium）', compact: '首页卡片（compact）' }

/** 按组件声明的每个尺寸各预跑一次（首页卡片等小尺寸布局也要能跑通），问题标上出错的尺寸 */
const probeAllSizes = async (draftId, sizes) => {
  const declared = Object.keys(SIZE_LABELS).filter((size) => sizes?.includes(size))
  const targets = declared.length ? declared : ['full']
  const results = await Promise.all(targets.map((size) => probeWidget(draftId, size)))
  // 同一个错误在多个尺寸都出现时合并成一条
  const merged = new Map()
  results.forEach((probe, index) => collectProblems(probe).forEach((problem) => {
    const key = `${problem.message}\n${problem.stack || ''}`
    if (!merged.has(key)) merged.set(key, { problem, sizes: [] })
    merged.get(key).sizes.push(targets[index])
  }))
  return [...merged.values()].map(({ problem, sizes: hit }) => (targets.length > 1
    ? { ...problem, message: `[${hit.map((size) => SIZE_LABELS[size]).join('、')}] ${problem.message}` }
    : problem))
}

const newRequestId = () => `gen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`

/**
 * 生成或修改组件：AI 编写 → 在沙箱里按每个声明的尺寸预跑 → 有报错或白屏就把问题交回 AI 修复（最多 3 轮）→ 保存。
 * @param {object} params
 * @param {string} params.instruction
 * @param {string} [params.widgetId] 修改哪个组件；不传为新建
 * @param {string} [params.instanceId] 修改时用哪个实例的数据副本预览
 * @param {string} [params.instanceName] 新建时第一个实例的名称
 * @param {(progress: object) => void} [params.onProgress]
 */
export async function runWidgetGeneration({ instruction, widgetId, instanceId, instanceName, onProgress = () => {} }) {
  let draftId = null
  let errors = null
  let round = 0
  let remaining = []

  for (;;) {
    const stage = errors ? 'fixing' : 'writing'
    onProgress({ stage, round, chars: 0 })
    const requestId = newRequestId()
    const off = window.electronAPI.widgets.onGenerateProgress((progress) => {
      if (progress?.requestId === requestId) onProgress({ stage, round, chars: progress.chars || 0 })
    })
    let result
    try {
      result = await window.electronAPI.widgets.generate(requestId, {
        instruction: errors ? '' : instruction,
        widgetId,
        instanceId,
        errors: errors || [],
        draftId,
      })
    } finally {
      off?.()
    }
    if (!result?.success) {
      if (draftId) window.electronAPI.widgets.discardDraft(draftId)
      throw new Error(result?.error || '生成失败')
    }
    draftId = result.data.draftId

    onProgress({ stage: 'testing', round })
    const problems = await probeAllSizes(draftId, result.data.sizes)
    if (!problems.length) break
    if (round >= MAX_FIX_ROUNDS) {
      remaining = problems
      break
    }
    round += 1
    errors = problems
  }

  onProgress({ stage: 'saving', round })
  const saved = await window.electronAPI.widgets.saveDraft(draftId, {
    instanceName,
    versionNote: widgetId ? `AI 修改：${instruction.slice(0, 40)}` : 'AI 生成',
  })
  if (!saved?.success) throw new Error(saved?.error || '保存失败')
  return { ...saved.data, fixedRounds: round, remainingProblems: remaining }
}
