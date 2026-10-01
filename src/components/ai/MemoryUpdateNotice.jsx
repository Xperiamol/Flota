import { useState } from 'react'
import { Box, ButtonBase, Chip, Collapse, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { Memory as MemoryIcon } from '../common/AppIcons'

const OP_LABELS = { add: '记住', update: '更新', delete: '忘记' }

const summarize = (changes) => {
  const first = changes[0]?.content || ''
  const head = first.length > 24 ? `${first.slice(0, 24)}…` : first
  return changes.length > 1 ? `${head} 等 ${changes.length} 条` : head
}

/**
 * 回复下方的「记忆已更新」提示：可展开看具体变更，可一键撤销。
 * variant: 'chip' 跟主对话页的来源标签一致；'pill' 跟浮窗里的「继续 / 重试」一致。
 */
export default function MemoryUpdateNotice({ updates, onUndo, variant = 'chip' }) {
  const [expanded, setExpanded] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const changes = updates?.changes || []
  if (changes.length === 0) return null
  const reverted = !!updates.reverted

  const handleUndo = async () => {
    setUndoing(true)
    try { await onUndo?.() } finally { setUndoing(false) }
  }

  const label = reverted ? '已撤销记忆更新' : `记忆已更新：${summarize(changes)}`
  const pillSx = (theme) => ({
    height: 22, px: 1, borderRadius: '7px', fontSize: 12, fontWeight: 600,
    color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.1),
  })

  return (
    <Box sx={{ mt: 0.75, minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
        {variant === 'chip' ? (
          <>
            <Chip
              size="small"
              icon={<MemoryIcon sx={{ fontSize: 14 }} />}
              label={label}
              variant="outlined"
              onClick={reverted ? undefined : () => setExpanded((v) => !v)}
              sx={{ height: 22, fontSize: '0.7rem', opacity: 0.75, maxWidth: '100%' }}
            />
            {!reverted && (
              <Chip size="small" label={undoing ? '撤销中…' : '撤销'} variant="outlined" onClick={undoing ? undefined : handleUndo} sx={{ height: 22, fontSize: '0.7rem' }} />
            )}
          </>
        ) : (
          <>
            <ButtonBase
              onClick={reverted ? undefined : () => setExpanded((v) => !v)}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, borderRadius: '7px', px: 0.5, height: 22, color: 'text.secondary' }}
            >
              <MemoryIcon sx={{ fontSize: 14, flexShrink: 0 }} />
              <Typography variant="caption" noWrap sx={{ fontSize: 12 }}>{label}</Typography>
            </ButtonBase>
            {!reverted && (
              <ButtonBase onClick={undoing ? undefined : handleUndo} sx={pillSx}>
                {undoing ? '撤销中…' : '撤销'}
              </ButtonBase>
            )}
          </>
        )}
      </Box>
      <Collapse in={expanded && !reverted} unmountOnExit>
        <Box sx={{ mt: 0.5, pl: 1 }}>
          {changes.map((change) => (
            <Typography key={`${change.op}-${change.id}`} variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.6 }}>
              {OP_LABELS[change.op] || change.op}：{change.content}
              {change.op === 'update' && change.previousContent ? `（原：${change.previousContent}）` : ''}
            </Typography>
          ))}
        </Box>
      </Collapse>
    </Box>
  )
}
