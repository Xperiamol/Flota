// 从 file:// URL 提取本地文件路径
export const getLocalPathFromFileUrl = (fileUrl) => {
  try {
    return decodeURIComponent(String(fileUrl).replace(/^file:\/\//i, ''))
  } catch (_) {
    return String(fileUrl).replace(/^file:\/\//i, '')
  }
}
