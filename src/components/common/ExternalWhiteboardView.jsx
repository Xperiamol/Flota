import { useMemo } from 'react'
import { Excalidraw, THEME } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'

// 外部 .excalidraw 文件的只读查看（可平移缩放，不可编辑）
const ExternalWhiteboardView = ({ whiteboard, isDark }) => {
  const initialData = useMemo(() => ({
    elements: whiteboard?.elements || [],
    appState: {
      viewBackgroundColor: whiteboard?.appState?.viewBackgroundColor || '#ffffff',
      viewModeEnabled: true
    },
    files: whiteboard?.files || {},
    scrollToContent: true
  }), [whiteboard])

  return (
    <Excalidraw
      initialData={initialData}
      viewModeEnabled
      zenModeEnabled
      theme={isDark ? THEME.DARK : THEME.LIGHT}
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, clearCanvas: false, changeViewBackgroundColor: false, toggleTheme: false } }}
    />
  )
}

export default ExternalWhiteboardView
