import { collectProblems, probeWidget } from '../../components/widgets/WidgetProbeHost'

const MAX_FIX_ROUNDS = 3

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
export async function runWidgetGeneration({ instruction, widgetId, instanceId, instanceName, referenceImages = [], task, initialDraftId = null, initialErrors = null, onProgress = () => {} }) {
  let draftId = initialDraftId
  let errors = initialErrors
  let round = 0
  const check = () => task?.throwIfCancelled()
  try {
    for (;;) {
      check()
      const stage = errors ? 'fixing' : 'writing'
      onProgress({ stage, round, chars: 0 })
      const requestId = newRequestId()
      const off = window.electronAPI.widgets.onGenerateProgress((progress) => {
        if (progress?.requestId === requestId) onProgress({ stage, round, chars: progress.chars || 0 })
      })
      let result
      let rejectAbort
      const aborted = new Promise((_, reject) => { rejectAbort = reject })
      const cancel = () => {
        Promise.resolve(window.electronAPI.widgets.cancelGenerate(requestId)).catch(() => {})
        rejectAbort(Object.assign(new Error('已停止生成'), { name: 'AbortError' }))
      }
      task?.signal.addEventListener('abort', cancel, { once: true })
      try {
        const generating = window.electronAPI.widgets.generate(requestId, {
          instruction,
          referenceImages,
          widgetId,
          instanceId,
          errors: errors || [],
          draftId,
        })
        // IPC 可能晚于停止返回：仍清理迟到的草稿。
        generating.then(late => {
          if (task?.signal.aborted && late?.data?.draftId) window.electronAPI.widgets.discardDraft(late.data.draftId).catch(() => {})
        }, () => {})
        result = await Promise.race([generating, aborted])
        check()
      } finally {
        off?.()
        task?.signal.removeEventListener('abort', cancel)
      }
      if (!result?.success) {
        throw new Error(result?.error || '生成失败')
      }
      draftId = result.data.draftId

      onProgress({ stage: 'testing', round })
      const problems = await probeAllSizes(draftId, result.data.sizes, task?.signal)
      check()
      if (!problems.length) break
      if (round >= MAX_FIX_ROUNDS || problems.some(problem => problem.fatal)) {
        throw Object.assign(new Error(`预览检查仍未通过，原组件未修改：${problems.map(item => item.message).slice(0, 3).join('；')}`), { problems })
      }
      round += 1
      errors = problems
    }

    check()
    task?.beginCommit()
    onProgress({ stage: 'saving', round })
    const saved = await window.electronAPI.widgets.saveDraft(draftId, {
      instanceName,
      versionNote: widgetId ? `AI 修改：${instruction.slice(0, 40)}` : 'AI 生成',
    })
    if (!saved?.success) throw new Error(saved?.error || '保存失败')
    return { ...saved.data, fixedRounds: round, remainingProblems: [] }
  } catch (error) {
    if (task?.signal.aborted && draftId) {
      await window.electronAPI.widgets.discardDraft(draftId).catch(() => {})
    }
    // 失败草稿保留供诊断，TTL 清理；绝不成为正式版本。
    if (draftId && !task?.signal.aborted) error.draftId = draftId
    throw error
  }
}
