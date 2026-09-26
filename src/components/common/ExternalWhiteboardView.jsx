import { useMemo } from 'react'
import { Excalidraw, THEME } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'

// 外部 .excalidraw 文件：默认只读查看（可平移缩放），editable 时可直接编辑
const ExternalWhiteboardView = ({ whiteboard, isDark, editable = false, onChange, apiRef }) => {
  const initialData = useMemo(() => ({
    elements: whiteboard?.elements || [],
    appState: {
      viewBackgroundColor: whiteboard?.appState?.viewBackgroundColor || '#ffffff'
    },
    files: whiteboard?.files || {},
    scrollToContent: true
  }), [whiteboard])

  return (
    <Excalidraw
      initialData={initialData}
      excalidrawAPI={(api) => { if (apiRef) apiRef.current = api }}
      onChange={onChange}
      viewModeEnabled={!editable}
      zenModeEnabled={!editable}
      theme={isDark ? THEME.DARK : THEME.LIGHT}
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, clearCanvas: false, changeViewBackgroundColor: editable, toggleTheme: false } }}
    />
  )
}

export default ExternalWhiteboardView
