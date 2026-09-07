// 从 file:// URL 提取本地文件路径
export const getLocalPathFromFileUrl = (fileUrl) => {
  try {
    const url = new URL(fileUrl)
    const path = decodeURIComponent(url.pathname)
    if (url.hostname) return `//${url.hostname}${path}`
    return /^\/[a-z]:\//i.test(path) ? path.slice(1) : path
  } catch (_) {
    return String(fileUrl).replace(/^file:\/\//i, '')
  }
}
