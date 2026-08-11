import { useRef, useCallback, useEffect } from 'react'

/**
 * 防抖保存 Hook
 * 优化性能，避免频繁的 IPC 调用和 SQLite 写入
 * 
 * @param {Function} saveCallback - 保存函数
 * @param {number} delay - 防抖延迟（毫秒）
 * @returns {Function} debouncedSave - 防抖后的保存函数
 */
export const useDebouncedSave = (saveCallback, delay = 2000) => {
  const timeoutRef = useRef(null)
  const pendingSaveRef = useRef(false)
  const isSavingRef = useRef(false)
  const activeSaveRef = useRef(null)
  const changeVersionRef = useRef(0)
  
  // 取消待处理的保存
  const cancelSave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    pendingSaveRef.current = false
  }, [])

  // 串行执行保存，并且只在保存的是最新版本时清除 pending。
  // 保存期间发生的新输入会增加版本号，随后必须再保存一次。
  const executeSave = useCallback(async () => {
    const previousSave = activeSaveRef.current || Promise.resolve()
    const savePromise = previousSave
      .catch(() => undefined)
      .then(async () => {
        const savingVersion = changeVersionRef.current
        isSavingRef.current = true
        await saveCallback()
        if (changeVersionRef.current === savingVersion) {
          pendingSaveRef.current = false
        }
      })
    activeSaveRef.current = savePromise

    try {
      await savePromise
    } finally {
      if (activeSaveRef.current === savePromise) {
        activeSaveRef.current = null
        isSavingRef.current = false
      }
    }
  }, [saveCallback])

  // 立即保存（用于切换笔记或关闭应用）
  const saveNow = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    // 即使已有保存正在进行，也要在其完成后再写入一次最新快照。
    pendingSaveRef.current = true
    await executeSave()
  }, [executeSave])
  
  // 防抖保存
  const debouncedSave = useCallback(() => {
    changeVersionRef.current += 1
    pendingSaveRef.current = true
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    
    timeoutRef.current = setTimeout(async () => {
      timeoutRef.current = null
      if (pendingSaveRef.current) {
        try {
          await executeSave()
        } catch (error) {
          console.error('自动保存失败:', error)
        }
      }
    }, delay)
  }, [executeSave, delay])
  
  // 组件卸载时清理
  useEffect(() => {
    return () => {
      cancelSave()
    }
  }, [cancelSave])


  return {
    debouncedSave,
    saveNow,
    cancelSave,
    hasPendingSave: () => pendingSaveRef.current,
    isSaving: () => isSavingRef.current
  }
}
