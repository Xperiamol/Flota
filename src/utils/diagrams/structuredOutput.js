// Accept JSON or a fenced JSON payload. Never guess missing values or repair syntax locally.
export const parseStructuredOutput = content => {
  const text = String(content ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try { return JSON.parse(text) } catch (error) {
    // Some compatible providers add an introduction despite the requested format.
    const start = text.search(/[\[{]/)
    if (start < 0) throw error
    const end = text.lastIndexOf(text[start] === '{' ? '}' : ']')
    if (end <= start) throw error
    return JSON.parse(text.slice(start, end + 1))
  }
}
