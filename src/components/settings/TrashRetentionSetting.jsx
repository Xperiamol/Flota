import { useEffect } from 'react'
import { Box, MenuItem, TextField, Typography } from '@mui/material'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../../store/useStore'
import { notifyError, notifySuccess } from '../../utils/notify'
import { sectionDescriptionSx, sectionTitleSx } from '../../styles/commonStyles'

const OPTIONS = [
  { value: 7, label: '7 天后' },
  { value: 14, label: '14 天后' },
  { value: 30, label: '30 天后' },
  { value: 60, label: '60 天后' },
  { value: 90, label: '90 天后' },
  { value: 0, label: '永不自动清除' },
]

/** 设置 → 数据管理：回收站自动清理的保留天数 */
export default function TrashRetentionSetting() {
  const { policy, trashCount, loadTrash, setTrashRetention } = useStore(useShallow((state) => ({
    policy: state.trashPolicy,
    trashCount: state.trashNotes.length,
    loadTrash: state.loadTrash,
    setTrashRetention: state.setTrashRetention,
  })))
  useEffect(() => { loadTrash() }, [loadTrash])

  const change = async (days) => {
    const result = await setTrashRetention(days)
    if (!result.success) return notifyError(result.error || '保存失败')
    notifySuccess(result.purged ? `已保存，清除了 ${result.purged} 篇过期的笔记` : '已保存')
  }

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h6" sx={sectionTitleSx}>回收站</Typography>
      <Typography variant="caption" sx={{ ...sectionDescriptionSx, mb: 1.5 }}>
        删除的笔记先进入回收站，超过保留时间后自动永久删除。回收站里现在有 {trashCount} 篇笔记。
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 0.5 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>自动清除</Typography>
          <Typography variant="caption" color="text.secondary">
            从删除那天开始计算；更新前就在回收站里的笔记，从开启这个功能时开始计算
          </Typography>
        </Box>
        <TextField select size="small" value={policy?.days ?? 30} onChange={(event) => change(Number(event.target.value))}
          sx={{ minWidth: 160 }} slotProps={{ htmlInput: { 'aria-label': '回收站自动清除时间' } }}>
          {OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
        </TextField>
      </Box>
    </Box>
  )
}
