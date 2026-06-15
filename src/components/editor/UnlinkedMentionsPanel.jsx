import { useMemo, useState } from 'react'
import { Box, Typography, ButtonBase, Stack, IconButton, Tooltip } from '@mui/material'
import LinkOffIcon from '@mui/icons-material/LinkOff'
import LinkIcon from '@mui/icons-material/Link'
import { useStore } from '../../store/useStore'
import { useLinkGraph } from '../../store/useLinkGraph'
import { stripMarkdownToPreviewText } from '../../utils/markdownTextUtils'

// 把字符串里的正则元字符转义
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 构造一个匹配「整词」的正则：CJK 友好，用 (?:^|[^\p{L}\p{N}_]) 与 (?:$|[^\p{L}\p{N}_]) 包围
const buildWordRegex = (title, flags) => {
  const escTitle = escapeRegExp(title)
  try {
    return new RegExp(`(?:^|[^\\p{L}\\p{N}_])(${escTitle})(?:$|[^\\p{L}\\p{N}_])`, flags + 'u')
  } catch {
    return new RegExp(`(?:^|\\W)(${escTitle})(?:$|\\W)`, flags)
  }
}

// 把代码块/行内代码剥成等长空白
const stripCode = (text) => String(text || '')
  .replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length))
  .replace(/~~~[\s\S]*?~~~/g, (m) => ' '.repeat(m.length))
  .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length))

// 在内容里挑一行作为 snippet：标题以整词出现且该出现不位于 [[...]] 内、不位于代码块中
const findUnlinkedSnippet = (content, targetTitle) => {
  if (!content || !targetTitle) return ''
  const re = buildWordRegex(targetTitle, 'i')
  const cleaned = stripCode(content)
  const cleanedLines = cleaned.split('\n')
  const rawLines = String(content).split('\n')
  for (let i = 0; i < cleanedLines.length; i++) {
    const line = cleanedLines[i]
    if (!line.trim()) continue
    if (!re.test(line)) continue
    const stripped = line.replace(/\[\[[^\]\n]+?\]\]/g, '')
    if (!re.test(stripped)) continue
    const raw = rawLines[i] || line
    try { return stripMarkdownToPreviewText(raw.trim()) } catch { return raw.trim() }
  }
  return ''
}

// 把内容里所有「未被 [[]] 包裹、且不在代码块中的整词 title」替换成 [[title]]
const convertUnlinkedToLinks = (content, targetTitle) => {
  if (!content || !targetTitle) return { newContent: content, count: 0 }
  // 1) 把所有代码块、行内代码、[[...]] 都按段抽出来，留下占位符
  const placeholders = []
  const PLACEHOLDER = (i) => `\u0000WL${i}\u0000`
  const masked = content
    .replace(/```[\s\S]*?```/g, (m) => { placeholders.push(m); return PLACEHOLDER(placeholders.length - 1) })
    .replace(/~~~[\s\S]*?~~~/g, (m) => { placeholders.push(m); return PLACEHOLDER(placeholders.length - 1) })
    .replace(/`[^`\n]*`/g, (m) => { placeholders.push(m); return PLACEHOLDER(placeholders.length - 1) })
    .replace(/\[\[[^\]\n]+?\]\]/g, (m) => { placeholders.push(m); return PLACEHOLDER(placeholders.length - 1) })
  // 2) 对 masked 做整词替换
  const re = buildWordRegex(targetTitle, 'gi')
  let count = 0
  const replaced = masked.replace(re, (full, hit) => {
    count++
    return full.replace(hit, `[[${targetTitle}]]`)
  })
  // 3) 还原占位符
  const restored = replaced.replace(/\u0000WL(\d+)\u0000/g, (_, idx) => placeholders[Number(idx)] || '')
  return { newContent: restored, count }
}

const UnlinkedMentionsPanel = ({ noteTitle, currentNoteId }) => {
  const notes = useStore((s) => s.notes)
  const setSelectedNoteId = useStore((s) => s.setSelectedNoteId)
  const updateNote = useStore((s) => s.updateNote)
  const incoming = useLinkGraph((s) => s.incoming)
  const [busyId, setBusyId] = useState(null)

  const items = useMemo(() => {
    if (!noteTitle) return []
    if (noteTitle.trim().length < 2) return []
    const linkedIds = incoming.get(noteTitle.toLowerCase()) || new Set()
    const titleLower = noteTitle.toLowerCase()
    const list = []
    for (const n of notes) {
      if (!n || !n.content || n.id === currentNoteId) continue
      if (linkedIds.has(n.id)) continue
      if (n.note_type === 'whiteboard') continue
      // 快速预过滤：title 完全不出现在内容里就跳过昂贵的 stripCode + regex
      if (n.content.toLowerCase().indexOf(titleLower) < 0) continue
      const snippet = findUnlinkedSnippet(n.content, noteTitle)
      if (!snippet) continue
      list.push({ id: n.id, title: n.title || '(无标题)', snippet })
      if (list.length >= 50) break
    }
    list.sort((a, b) => a.title.localeCompare(b.title))
    return list
  }, [incoming, noteTitle, notes, currentNoteId])

  const handleConvert = async (e, item) => {
    e.stopPropagation()
    if (busyId) return
    const note = notes.find((n) => n.id === item.id)
    if (!note) return
    setBusyId(item.id)
    try {
      const { newContent, count } = convertUnlinkedToLinks(note.content || '', noteTitle)
      if (count > 0 && newContent !== note.content) {
        await updateNote(item.id, { content: newContent })
      }
    } catch (err) {
      console.warn('[UnlinkedMentionsPanel] 转链失败:', err)
    } finally {
      setBusyId(null)
    }
  }

  if (!noteTitle || items.length === 0) return null

  return (
    <Box sx={{ px: 1.25, py: 0.85 }}>
      <Stack direction="row" alignItems="center" spacing={0.6} sx={{ px: 0.4, mb: 0.6 }}>
        <LinkOffIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
        <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', color: 'text.disabled' }}>
          未链接的提及 · {items.length}
        </Typography>
      </Stack>
      <Stack spacing={0.35}>
        {items.map((it) => (
          <Box
            key={it.id}
            sx={{
              display: 'flex',
              alignItems: 'stretch',
              borderRadius: 1.2,
              transition: 'background-color 160ms cubic-bezier(0.32, 0.72, 0, 1)',
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <ButtonBase
              onClick={() => setSelectedNoteId(it.id)}
              sx={{
                flex: 1,
                minWidth: 0,
                justifyContent: 'flex-start',
                textAlign: 'left',
                px: 0.85,
                py: 0.55,
                borderRadius: 1.2,
              }}
            >
              <Box sx={{ minWidth: 0, width: '100%' }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600, fontSize: 12.5 }}>
                  {it.title}
                </Typography>
                {it.snippet && (
                  <Typography
                    variant="caption"
                    noWrap
                    sx={{ display: 'block', color: 'text.secondary', opacity: 0.85, fontSize: 11 }}
                  >
                    {it.snippet}
                  </Typography>
                )}
              </Box>
            </ButtonBase>
            <Tooltip title={`将该笔记中所有"${noteTitle}"转为双链`}>
              <span>
                <IconButton
                  size="small"
                  disabled={busyId === it.id}
                  onClick={(e) => handleConvert(e, it)}
                  sx={{ alignSelf: 'center', mr: 0.5, borderRadius: '8px' }}
                >
                  <LinkIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        ))}
      </Stack>
    </Box>
  )
}

export default UnlinkedMentionsPanel
