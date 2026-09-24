const AUDIO_MARKDOWN_PATTERN = /!\[[^\]]*\]\((audio\/[^)]+|app:\/\/audio\/[^)]+|[^)]+\.(?:m4a|mp3|wav|ogg|aac|opus|flac|webm)(?:\?[^)]*)?)\)/gi

export const isPlaceholderOnlyPreview = (text = '') => ['【语音】', '【图片】'].includes(String(text || '').trim())

/**
 * 去掉块级 Markdown 语法，只留可读文字（列表预览、时间轴卡片、拖拽预览共用）。
 * 代码块必须最先整体替换：否则里面的 `-`、`#`、`|` 会被后面的行规则打散。
 */
export const stripMarkdownBlocks = (content = '') => String(content || '')
  .replace(/\r\n?/g, '\n')
  .replace(/```[\s\S]*?(?:```|$)/g, '\n【代码】\n')
  .replace(/~~~[\s\S]*?(?:~~~|$)/g, '\n【代码】\n')
  .replace(/\$\$[\s\S]*?\$\$/g, '\n【公式】\n')
  // 表格：删掉 |---|---| 分隔行，内容行的竖线换成空格
  .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/gm, '')
  .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_, row) => row.split('|').map((cell) => cell.trim()).filter(Boolean).join('  '))
  // 分割线
  .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, '')
  // 任务列表 / 无序 / 有序列表 / 引用 / 标题（允许缩进，嵌套列表同样处理）
  .replace(/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+/gm, '')
  .replace(/^[ \t]*[-*+][ \t]+/gm, '')
  .replace(/^[ \t]*\d+[.)][ \t]+/gm, '')
  .replace(/^[ \t]*>+[ \t]?/gm, '')
  .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')

/**
 * 去掉行内强调标记。只去成对的标记：snake_case、C# 之类的普通字符不能被误删。
 */
export const stripMarkdownInline = (text = '') => String(text || '')
  .replace(/\{color:[^}]+\}(.+?)\{\/color\}/g, '$1')
  .replace(/==(?:\{[^}]+\})?(.+?)==/g, '$1')
  .replace(/\+\+(.+?)\+\+/g, '$1')
  .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias || target)
  .replace(/`([^`\n]+)`/g, '$1')
  .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
  .replace(/(^|[^\w*])[*_](?=\S)([^*_\n]*?\S)[*_](?![\w*])/g, '$1$2')
  .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
  .replace(/\$(?=\S)([^$\n]+?\S)\$/g, '$1')

export const stripMarkdownToPreviewText = (content = '') => stripMarkdownInline(
  stripMarkdownBlocks(content)
    .replace(AUDIO_MARKDOWN_PATTERN, '【语音】')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '【图片】')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/<\/?[a-zA-Z][^<\n]*?(?=<|$)/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|#39);/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
)
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{2,}/g, '\n')
  .trim()
  .replace(/\s*\n\s*/g, ' ')
