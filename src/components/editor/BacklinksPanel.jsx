import { useMemo } from 'react'
import { Box, Typography, ButtonBase, Stack } from '@mui/material'
import { Link as LinkIcon } from '../common/AppIcons'
import { useStore } from '../../store/useStore'
import { useLinkGraph } from '../../store/useLinkGraph'
import { stripMarkdownToPreviewText } from '../../utils/markdownTextUtils'

// 在引用方笔记的内容里抓出包含 [[currentTitle]] 的那一行作为 snippet
const findContextSnippet = (content, targetTitle) => {
  if (!content || !targetTitle) return ''
  const text = String(content)
  const lower = targetTitle.toLowerCase()
  const lines = text.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // 匹配 [[Title]] 或 [[Title|...]] 或 [[Title#...]]
    const re = /\[\[([^\]\n]+?)\]\]/g
    let m
    while ((m = re.exec(trimmed)) !== null) {
      const target = m[1].split('|')[0].split('#')[0].trim().toLowerCase()
      if (target === lower) {
        // 去掉 markdown 装饰，只留可读文本
        try {
          return stripMarkdownToPreviewText(trimmed)
        } catch {
          return trimmed
        }
      }
    }
  }
  return ''
}

const BacklinksPanel = ({ noteTitle, currentNoteId, embedded = false }) => {
  const notes = useStore((s) => s.notes)
  const setSelectedNoteId = useStore((s) => s.setSelectedNoteId)
  // 订阅 incoming Map 的变化（rebuild / indexNote / removeNote 都会换引用）
  const incoming = useLinkGraph((s) => s.incoming)

  const backlinks = useMemo(() => {
    if (!noteTitle) return []
    const ids = incoming.get(noteTitle.toLowerCase())
    if (!ids || ids.size === 0) return []
    // 注：indexNote 已做"出边未变则不发新引用"短路，
    // notes 数组虽然在 autosave 时引用会变，但 useMemo 体内只读 ids 涉及的笔记。
    const noteById = new Map()
    notes.forEach((n) => { if (ids.has(n.id)) noteById.set(n.id, n) })
    const list = []
    ids.forEach((id) => {
      if (id === currentNoteId) return // 自引用不显示
      const note = noteById.get(id)
      if (!note) return
      list.push({
        id: note.id,
        title: note.title || '(无标题)',
        snippet: findContextSnippet(note.content, noteTitle),
      })
    })
    list.sort((a, b) => a.title.localeCompare(b.title))
    return list
  }, [incoming, noteTitle, notes, currentNoteId])

  if (!noteTitle || backlinks.length === 0) {
    return null
  }

  return (
    <Box
      sx={{
        px: embedded ? 1.25 : 2,
        py: embedded ? 0.85 : 1.25,
        borderTop: embedded ? 0 : 1,
        borderColor: 'divider',
        bgcolor: embedded ? 'transparent' : 'background.paper',
      }}
    >
      <Stack direction="row" alignItems="center" spacing={0.6} sx={{ px: embedded ? 0.4 : 0, mb: 0.6 }}>
        <LinkIcon sx={{ fontSize: embedded ? 14 : 16, color: embedded ? 'text.disabled' : 'text.secondary' }} />
        <Typography variant="caption" sx={{ color: embedded ? 'text.disabled' : 'text.secondary', fontWeight: embedded ? 800 : 600, letterSpacing: embedded ? '0.04em' : 0 }}>
          反向链接 · {backlinks.length}
        </Typography>
      </Stack>
      <Stack spacing={0.5}>
        {backlinks.map((bl) => (
          <ButtonBase
            key={bl.id}
            onClick={() => setSelectedNoteId(bl.id)}
            sx={{
              justifyContent: 'flex-start',
              textAlign: 'left',
              px: 1,
              py: 0.6,
              borderRadius: 1,
              transition: 'background-color 160ms cubic-bezier(0.32, 0.72, 0, 1)',
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Box sx={{ minWidth: 0, width: '100%' }}>
              <Typography
                variant="body2"
                noWrap
                sx={{ fontWeight: 500, color: 'text.primary' }}
              >
                {bl.title}
              </Typography>
              {bl.snippet && (
                <Typography
                  variant="caption"
                  noWrap
                  sx={{ display: 'block', color: 'text.secondary', opacity: 0.85 }}
                >
                  {bl.snippet}
                </Typography>
              )}
            </Box>
          </ButtonBase>
        ))}
      </Stack>
    </Box>
  )
}

export default BacklinksPanel
