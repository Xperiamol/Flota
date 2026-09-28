import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * 界面偏好（只影响本机显示，不需要主进程知道）：设置 → 编辑器 / 笔记与文件 / 待办。
 * 主进程需要的偏好（关闭窗口行为、可打开的文件类型）存在设置表里。
 */
export const EDITOR_FONT_SIZES = { small: '0.9375rem', standard: '1rem', large: '1.125rem' }
export const EDITOR_READABLE_WIDTH = '760px'

export const usePrefsStore = create(
  persist(
    (set) => ({
      editorFontSize: 'standard', // small | standard | large
      editorWidth: 'full', // full | readable
      noteListPreview: true, // 笔记列表显示正文预览
      noteListTime: 'relative', // relative（3 分钟前）| absolute（9月28日 14:05）
      todoDefaultView: 'quadrant', // quadrant | focus
      todoShowCompleted: false, // 待办页默认显示已完成
      todoSortBy: 'priority', // priority | dueDate | createdAt
      todoDefaultDue: 'none', // 新建待办默认截止：none | today
      externalFileMode: 'preview', // 外部文件打开后默认 preview | edit
      autoCheckUpdates: true, // 启动时自动检查更新
      setPref: (key, value) => set({ [key]: value }),
    }),
    { name: 'Flota-prefs', version: 1 }
  )
)

/** 把编辑器排版偏好写成 CSS 变量：所见即所得和 Markdown 源码编辑都读取它们 */
export function useApplyEditorPrefs() {
  const fontSize = usePrefsStore((state) => state.editorFontSize)
  const width = usePrefsStore((state) => state.editorWidth)
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--flota-editor-font-size', EDITOR_FONT_SIZES[fontSize] || EDITOR_FONT_SIZES.standard)
    root.style.setProperty('--flota-editor-max-width', width === 'readable' ? EDITOR_READABLE_WIDTH : 'none')
  }, [fontSize, width])
  // 其他窗口改了偏好（localStorage）时同步过来
  useEffect(() => {
    const onStorage = (event) => { if (event.key === 'Flota-prefs') usePrefsStore.persist.rehydrate() }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
}
