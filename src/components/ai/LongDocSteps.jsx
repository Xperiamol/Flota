import React, { useState, useEffect, useRef } from 'react'
import { Box, Typography, Collapse, Chip, CircularProgress } from '@mui/material'
import { useTheme, alpha } from '@mui/material/styles'
import {
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon,
  CheckCircle as CheckCircleIcon,
  ErrorOutline as ErrorIcon,
  Article as ArticleIcon,
} from '@mui/icons-material'

// 步骤树：根节点（长文档生成）下挂规划/各章节/归并子节点
// steps 为扁平节点数组：{ id, parentId, title, status, stepType, content, meta }
// status: 'running' | 'done' | 'failed'
export default function LongDocSteps({ steps, renderContent, onOpenNote }) {
  const theme = useTheme()
  const root = steps.find(s => s.stepType === 'root') || steps.find(s => s.parentId === 0)
  if (!root) return null
  const children = steps.filter(s => s.parentId === root.id)

  const total = root.meta?.total
  const doneCount = children.filter(c => c.stepType === 'section' && c.status === 'done').length
  const noteId = root.meta?.noteId
  const noteTitle = root.meta?.noteTitle

  return (
    <Box sx={{
      mb: 1,
      border: '1px solid',
      borderColor: alpha(theme.palette.primary.main, 0.25),
      borderRadius: 1,
      overflow: 'hidden',
      bgcolor: alpha(theme.palette.primary.main, 0.04),
    }}>
      {/* 根节点头部 */}
      <Box sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
        {root.status === 'running'
          ? <CircularProgress size={15} />
          : root.status === 'failed'
          ? <ErrorIcon sx={{ fontSize: 18, color: 'error.main' }} />
          : <CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} />}
        <Typography variant="body2" sx={{ fontWeight: 700 }}>{root.title}</Typography>
        {total > 0 && (
          <Chip size="small" label={`${doneCount}/${total} 章`} variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
        )}
      </Box>

      {/* 子节点列表 */}
      <Box sx={{ px: 0.5, pb: 0.5 }}>
        {children.map(node => (
          <StepNode key={node.id} node={node} renderContent={renderContent} />
        ))}
      </Box>

      {/* 完成后保存为笔记的链接 */}
      {root.status === 'done' && noteId && (
        <Box
          onClick={() => onOpenNote?.(noteId)}
          sx={{
            px: 1.5, py: 0.75, display: 'flex', alignItems: 'center', gap: 0.75,
            cursor: 'pointer', borderTop: '1px solid', borderColor: alpha(theme.palette.primary.main, 0.15),
            color: 'primary.main', '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.08) },
          }}
        >
          <ArticleIcon sx={{ fontSize: 16 }} />
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            已保存为笔记：{noteTitle || '点击打开'}
          </Typography>
        </Box>
      )}
    </Box>
  )
}

function StepNode({ node, renderContent }) {
  const theme = useTheme()
  const [expanded, setExpanded] = useState(node.status === 'running')
  const [userToggled, setUserToggled] = useState(false)
  const prevStatusRef = useRef(node.status)

  // 自动展开/收起：running 自动展开，转为 done/failed 自动收起（未被用户手动干预时）
  useEffect(() => {
    if (prevStatusRef.current !== node.status) {
      if (!userToggled) {
        setExpanded(node.status === 'running')
      }
      prevStatusRef.current = node.status
    }
  }, [node.status, userToggled])

  const hasContent = Boolean(node.content && node.content.trim())
  const words = node.meta?.words
  const targetWords = node.meta?.targetWords

  const statusIcon = node.status === 'running'
    ? <CircularProgress size={13} />
    : node.status === 'failed'
    ? <ErrorIcon sx={{ fontSize: 16, color: 'error.main' }} />
    : <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} />

  return (
    <Box sx={{ mb: 0.25 }}>
      <Box
        onClick={() => { setExpanded(e => !e); setUserToggled(true) }}
        sx={{
          px: 1, py: 0.6, display: 'flex', alignItems: 'center', gap: 0.5,
          borderRadius: 1, cursor: hasContent ? 'pointer' : 'default',
          '&:hover': hasContent ? { bgcolor: alpha(theme.palette.text.primary, 0.05) } : {},
        }}
      >
        {hasContent
          ? (expanded ? <ExpandMoreIcon sx={{ fontSize: 16, opacity: 0.6 }} /> : <ChevronRightIcon sx={{ fontSize: 16, opacity: 0.6 }} />)
          : <Box sx={{ width: 16 }} />}
        {statusIcon}
        <Typography variant="caption" sx={{ flex: 1, minWidth: 0, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.title}
        </Typography>
        {words > 0 && (
          <Typography variant="caption" sx={{ opacity: 0.6, flexShrink: 0 }}>
            {words}{targetWords > 0 ? `/${targetWords}` : ''} 字
          </Typography>
        )}
      </Box>
      {hasContent && (
        <Collapse in={expanded} unmountOnExit>
          <Box sx={{
            ml: 3, mr: 1, my: 0.5, px: 1.5, py: 0.5,
            borderLeft: '2px solid', borderColor: alpha(theme.palette.primary.main, 0.2),
            userSelect: 'text',
          }}>
            {renderContent ? renderContent(node.content) : <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{node.content}</Typography>}
          </Box>
        </Collapse>
      )}
    </Box>
  )
}
