// 刷新笔记数据时的结构共享：数据库读回来的内容没变，就沿用内存里原来的对象，
// 让依赖引用比较的订阅者（笔记列表、memo 过的行）不必重渲染。

const sameValue = (a, b) => {
  if (a === b) return true
  // 标签规范化后是数组，其余字段都是字符串 / 数字 / null
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => item === b[index])
  }
  return false
}

/** 两条笔记记录的每个字段都相同（字段集合也必须一致） */
export const sameNoteRecord = (a, b) => {
  if (!a || !b) return false
  const keys = Object.keys(b)
  if (keys.length !== Object.keys(a).length) return false
  return keys.every((key) => Object.prototype.hasOwnProperty.call(a, key) && sameValue(a[key], b[key]))
}

/**
 * 返回新列表，其中内容没变的笔记用原对象；顺序、数量和每条都没变时直接返回 prev。
 * 有任何差异（新增、删除、改动、排序变化）时返回的数组与 next 内容一致。
 */
export const reuseUnchangedNotes = (prev, next) => {
  if (!Array.isArray(prev) || prev.length === 0) return next
  const prevById = new Map(prev.map((note) => [note?.id, note]))
  let changed = prev.length !== next.length
  const merged = next.map((note, index) => {
    const old = prevById.get(note?.id)
    if (old && sameNoteRecord(old, note)) {
      if (prev[index] !== old) changed = true
      return old
    }
    changed = true
    return note
  })
  return changed ? merged : prev
}

/** 扁平对象（如 id → 数量）浅比较 */
export const shallowEqualRecord = (a, b) => {
  if (a === b) return true
  if (!a || !b) return false
  const keys = Object.keys(b)
  return keys.length === Object.keys(a).length && keys.every((key) => a[key] === b[key])
}
