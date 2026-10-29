import { Box, Typography } from '@mui/material'
import TodoReferenceCard from './TodoReferenceCard'

export default function RelatedTodos({ references, loading = false, error = '' }) {
  const { tasks, hasReferences, missingCount } = references
  if (!hasReferences) return null
  return <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
    <Typography variant="caption" color="text.secondary">关联待办{tasks.length ? ` · ${tasks.length}` : ''}</Typography>
    <Box sx={{ display: 'grid', gap: 0.75, mt: 0.75, maxHeight: 240, overflowY: 'auto' }}>
      {tasks.map(todo => <TodoReferenceCard key={todo.sync_id || todo.id} todo={todo} />)}
      {(loading || error || missingCount > 0 || !tasks.length) && <Typography variant="caption" color="text.secondary">
        {loading ? '正在加载待办…' : error ? '待办加载失败，请稍后重试' : missingCount ? `${missingCount} 个引用的待办已删除或尚未同步` : '引用的清单中暂无待办'}
      </Typography>}
    </Box>
  </Box>
}
