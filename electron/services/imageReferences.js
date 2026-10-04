/**
 * 图片引用判断：清理"无人引用的图片"前，先从笔记正文里收集所有出现过的图片文件名。
 *
 * 不按 Markdown 语法精确解析：`![](<images/a.png>)`、`![](images/a.png "标题")`、`\(` 转义、
 * `%20` 编码、HTML <img>、画布 JSON 的 fileMap 写法各不相同，任何一种没认出来都会把正在用的图片删掉。
 * Flota 保存的图片名是"时间戳_随机串.扩展名"，在正文里出现即视为被引用——宁可少删，不可误删。
 */
const IMAGE_NAME_RE = /[^\s"'()<>[\]{}|\\/,;:*?]+\.(?:png|jpe?g|gif|bmp|webp|svg|avif|heic|ico|tiff?)/gi

const safeDecode = (value) => {
  try { return decodeURIComponent(value) } catch { return value }
}

/**
 * @param {Iterable<string>} contents - 笔记正文（应包含回收站里的笔记，恢复后图片还要用）
 * @returns {{ names: Set<string>, text: string }} 出现过的图片文件名（小写）+ 全部正文（供含空格等的文件名兜底查找）
 */
function collectReferencedImageNames(contents) {
  const names = new Set()
  const texts = []
  for (const raw of contents) {
    if (!raw || typeof raw !== 'string') continue
    // 去掉 Markdown 转义的反斜杠（`\_`、`\(`），并把 %20 等编码还原后再找
    const text = raw.replace(/\\/g, '')
    for (const variant of [text, safeDecode(text)]) {
      texts.push(variant.toLowerCase())
      for (const match of variant.matchAll(IMAGE_NAME_RE)) names.add(match[0].toLowerCase())
    }
  }
  return { names, text: texts.join('\n') }
}

/** 文件名（不含目录）是否在正文里出现过 */
function isImageReferenced(fileName, index) {
  const name = String(fileName).toLowerCase()
  if (index.names.has(name)) return true
  // 文件名里有空格、括号等（导入的图片常见）时按原样在正文里找
  return /[^a-z0-9._-]/.test(name) && index.text.includes(name)
}

module.exports = { collectReferencedImageNames, isImageReferenced }
