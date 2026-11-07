// 设置「AI 画布可使用 SVG」：默认开启；关闭后 AI 生成与局部修改都不产出 SVG（用户自己手动插入不受影响）。
export const isAiCanvasSvgAllowed = async () => {
  try {
    const res = await window.electronAPI?.ai?.getConfig?.()
    return res?.data?.canvasSvgEnabled !== false
  } catch {
    return true
  }
}
