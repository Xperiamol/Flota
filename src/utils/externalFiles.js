// 外部文件打开的渲染层入口：菜单「打开文件…」、命令面板等都走这里，
// 最终由 ExternalFileViewer 监听 OPEN_EVENT 负责读取和展示。

export const EXTERNAL_FILE_OPEN_EVENT = 'flota:open-external-file'

export const requestOpenExternalFile = (filePath) => {
  if (!filePath) return
  window.dispatchEvent(new CustomEvent(EXTERNAL_FILE_OPEN_EVENT, { detail: { path: filePath } }))
}

export const showOpenExternalFileDialog = async () => {
  const result = await window.electronAPI?.externalFiles?.showOpenDialog?.()
  const paths = result?.success ? result.data || [] : []
  // 多选时依次打开，查看器保留最后一个；其余逐个排队
  paths.forEach(requestOpenExternalFile)
  return paths
}
