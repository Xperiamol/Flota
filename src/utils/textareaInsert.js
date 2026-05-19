/**
 * 在 textarea 中以"可被浏览器原生 Undo 栈识别"的方式插入文本。
 *
 * 设计目标：
 * - 把 NoteEditor 中重复出现的"focus → setSelectionRange → execCommand('insertText') → 失败回退"
 *   这一段插入逻辑收敛到一个 helper，避免后续四五处地方各写各的、行为不一致。
 * - 保留对调用方的回调控制：execCommand 失败时由调用方决定如何把内容写回到 React state。
 *
 * 注意：
 * - 该 helper 只负责"对 textarea 这个 DOM 节点的修改"，不直接调用 setState；
 *   失败回退时通过 onFallback(nextValue) 把"应当成为的新内容"交回去。
 * - 调用方在成功插入后通常应当继续做：标记未保存、debouncedSave、设置光标位置等。
 *
 * @param {HTMLTextAreaElement} textarea  目标 textarea 节点
 * @param {string} text                    要插入的文本
 * @param {Object} [options]
 * @param {() => string} [options.getValue]
 *     失败回退时用于读取当前 React state 中的字符串（不是 textarea.value）。
 *     当 textarea 的 value 与 state 不同步时建议提供，避免回退时丢字。
 * @param {(nextValue: string) => void} [options.onFallback]
 *     execCommand 失败时由调用方把新内容写回 state。
 * @returns {{ start: number, end: number, success: boolean, nextValue: string }}
 */
export const insertIntoTextarea = (textarea, text, options = {}) => {
  if (!textarea) {
    return { start: 0, end: 0, success: false, nextValue: '' }
  }

  const { getValue, onFallback } = options
  const insertText = String(text ?? '')
  const start = textarea.selectionStart ?? 0
  const end = textarea.selectionEnd ?? start
  const baseValue = typeof getValue === 'function' ? String(getValue() ?? '') : textarea.value

  textarea.focus()
  textarea.setSelectionRange(start, end)

  let success = false
  try {
    success = document.execCommand('insertText', false, insertText)
  } catch (_) {
    success = false
  }

  let nextValue
  if (success) {
    nextValue = textarea.value
  } else {
    nextValue = baseValue.substring(0, start) + insertText + baseValue.substring(end)
    if (typeof onFallback === 'function') {
      onFallback(nextValue)
    }
  }

  return { start, end, success, nextValue }
}

/**
 * 与 insertIntoTextarea 配套：插入完成后，把光标定位到插入文本之后。
 * 单独抽出来避免每个调用方重复 setTimeout 包装。
 */
export const placeCursorAfterInsert = (textarea, start, insertedLength) => {
  if (!textarea) return
  setTimeout(() => {
    const pos = start + insertedLength
    textarea.selectionStart = textarea.selectionEnd = pos
    textarea.focus()
  }, 0)
}
