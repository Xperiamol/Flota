// 外部文件打开的渲染层入口：菜单「打开文件…」、命令面板等都走这里。
// 选中的文件由主进程各自打开一个独立窗口（ExternalFileWindow）。

export const showOpenExternalFileDialog = async () => {
  const result = await window.electronAPI?.externalFiles?.showOpenDialog?.()
  return result?.success ? result.data || [] : []
}
