import { collectProblems, probeWidget } from '../../components/widgets/WidgetProbeHost'

const MAX_FIX_ROUNDS = 3

const newRequestId = () => `gen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`

/**
 * 生成或修改组件：AI 编写 → 在沙箱里预跑 → 有报错或白屏就把问题交回 AI 修复（最多 3 轮）→ 保存。
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
    const problems = collectProblems(await probeWidget(draftId))
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
