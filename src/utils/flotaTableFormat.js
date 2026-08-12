export const FLOTA_TABLE_START = ':::flota-table v=1'
const FLOTA_TABLE_END = ':::'

const clampSpan = (value, max) => Math.min(Math.max(Number(value) || 1, 1), max)

export const encodeFlotaTable = (rows) => {
  const normalizedRows = (rows || []).slice(0, 500).map(row =>
    (row || []).slice(0, 50).map(cell => ({
      text: String(cell?.text || '').slice(0, 100_000),
      colspan: clampSpan(cell?.colspan, 50),
      rowspan: clampSpan(cell?.rowspan, 500),
      header: Boolean(cell?.header),
    }))
  )
  return `${FLOTA_TABLE_START}\n${JSON.stringify({ version: 1, rows: normalizedRows })}\n${FLOTA_TABLE_END}`
}

export const decodeFlotaTable = (json) => {
  try {
    const parsed = JSON.parse(String(json || ''))
    if (parsed?.version !== 1 || !Array.isArray(parsed.rows)) return null
    return parsed.rows.slice(0, 500).map(row =>
      (Array.isArray(row) ? row : []).slice(0, 50).map(cell => ({
        text: String(cell?.text || '').slice(0, 100_000),
        colspan: clampSpan(cell?.colspan, 50),
        rowspan: clampSpan(cell?.rowspan, 500),
        header: Boolean(cell?.header),
      }))
    )
  } catch (_) {
    return null
  }
}

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const tableToHtml = (rows) => `<table><tbody>${rows.map(row =>
  `<tr>${row.map(cell => {
    const tag = cell.header ? 'th' : 'td'
    return `<${tag} colspan="${cell.colspan}" rowspan="${cell.rowspan}">${escapeHtml(cell.text)}</${tag}>`
  }).join('')}</tr>`
).join('')}</tbody></table>`

/** Expands versioned table blocks for TipTap/markdown-it; malformed blocks remain verbatim. */
export const expandFlotaTableBlocks = (markdown) => {
  const lines = String(markdown || '').split('\n')
  const output = []
  let index = 0
  while (index < lines.length) {
    if (lines[index].trim() !== FLOTA_TABLE_START) {
      output.push(lines[index++])
      continue
    }
    const start = index
    const jsonLines = []
    index += 1
    while (index < lines.length && lines[index].trim() !== FLOTA_TABLE_END) {
      jsonLines.push(lines[index++])
    }
    if (index >= lines.length) {
      output.push(...lines.slice(start))
      break
    }
    const rows = decodeFlotaTable(jsonLines.join('\n'))
    if (rows == null) output.push(...lines.slice(start, index + 1))
    else output.push(tableToHtml(rows))
    index += 1
  }
  return output.join('\n')
}
