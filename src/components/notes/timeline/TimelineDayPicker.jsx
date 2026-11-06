import { useEffect, useMemo, useState } from 'react'
import { Box, Button, ButtonBase, IconButton, Popover, Typography, alpha, useTheme } from '@mui/material'
import { ChevronLeft, ChevronRight } from '../../common/AppIcons'

// 点日期分组标签弹出的小月历：有记录的日子可点，点了就跳到那一天。
// 底部顺带放「合并这一天的记录」，整理一天的碎片记录时最常用。

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

const startOfMonth = (time) => {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

// 周一开头的 6×7 网格
const buildMonthCells = (month) => {
  const first = new Date(month)
  const offset = (first.getDay() + 6) % 7
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset)
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index))
}

/**
 * @param {object} props
 * @param {HTMLElement|null} props.anchorEl
 * @param {Map<string, number>} props.dayCounts toDateString() → 记录数
 * @param {number} props.activeTime 当前分组那天的任一时间
 * @param {(dayKey: string) => void} props.onPick
 * @param {number} [props.mergeCount] 当天可合并的记录数（≥2 时显示合并按钮）
 * @param {() => void} [props.onMerge]
 */
export default function TimelineDayPicker({ anchorEl, onClose, dayCounts, activeTime, onPick, mergeCount = 0, onMerge }) {
  const theme = useTheme()
  const [month, setMonth] = useState(() => startOfMonth(activeTime || Date.now()))
  useEffect(() => { if (anchorEl) setMonth(startOfMonth(activeTime || Date.now())) }, [anchorEl, activeTime])

  const cells = useMemo(() => buildMonthCells(month), [month])
  const activeKey = activeTime ? new Date(activeTime).toDateString() : ''
  const todayKey = new Date().toDateString()
  const shiftMonth = (delta) => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1))
  const dark = theme.palette.mode === 'dark'

  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      // 关闭时不把焦点还给日期标签：否则浏览器会把那个标签滚回视野，跳转就白跳了
      disableRestoreFocus
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      transformOrigin={{ vertical: 'top', horizontal: 'center' }}
      slotProps={{ paper: { sx: { mt: 0.75, p: 1.25, width: 268, borderRadius: 1.5 } } }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.75 }}>
        <IconButton size="small" aria-label="上个月" onClick={() => shiftMonth(-1)}><ChevronLeft fontSize="small" /></IconButton>
        <Typography sx={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 600 }}>
          {month.getFullYear()}年{month.getMonth() + 1}月
        </Typography>
        <IconButton size="small" aria-label="下个月" onClick={() => shiftMonth(1)}><ChevronRight fontSize="small" /></IconButton>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 0.25 }}>
        {WEEKDAYS.map((day) => (
          <Typography key={day} sx={{ textAlign: 'center', fontSize: 11, color: 'text.disabled', pb: 0.5 }}>{day}</Typography>
        ))}
        {cells.map((date) => {
          const key = date.toDateString()
          const count = dayCounts.get(key) || 0
          const inMonth = date.getMonth() === month.getMonth()
          const active = key === activeKey
          return (
            <ButtonBase
              key={key}
              disabled={!count}
              onClick={() => onPick(key)}
              title={count ? `${count} 条记录` : undefined}
              sx={{
                position: 'relative',
                height: 32,
                borderRadius: 1,
                fontSize: 12.5,
                fontWeight: count ? 600 : 400,
                fontVariantNumeric: 'tabular-nums',
                color: active ? 'primary.contrastText' : count ? 'text.primary' : 'text.disabled',
                opacity: inMonth ? 1 : 0.4,
                bgcolor: active ? 'primary.main' : 'transparent',
                outline: key === todayKey && !active ? `1px solid ${alpha(theme.palette.primary.main, 0.5)}` : 'none',
                outlineOffset: -1,
                '&:hover': count && !active ? { bgcolor: alpha(theme.palette.text.primary, dark ? 0.08 : 0.05) } : {},
              }}
            >
              {date.getDate()}
              {count > 0 && !active && (
                <Box sx={{ position: 'absolute', bottom: 4, width: 3, height: 3, borderRadius: '50%', bgcolor: 'primary.main' }} />
              )}
            </ButtonBase>
          )
        })}
      </Box>
      {mergeCount >= 2 && onMerge && (
        <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
          <Button fullWidth size="small" color="inherit" onClick={onMerge}
            sx={{ justifyContent: 'flex-start', textTransform: 'none', fontSize: 12.5, color: 'text.secondary', borderRadius: 1 }}>
            把这天的 {mergeCount} 条记录合并成一篇笔记
          </Button>
        </Box>
      )}
    </Popover>
  )
}
