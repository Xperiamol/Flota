import { Box, Tooltip, alpha } from '@mui/material'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../../store/useStore'
import FlotaAIIcon from '../common/FlotaAIIcon'
import shortcutManager from '../../utils/ShortcutManager'

export const formatShortcut = (key) => String(key || '')
  .replace(/CmdOrCtrl/g, navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl')
  .replace(/\+/g, navigator.platform?.includes('Mac') ? '' : '+')

/** 标题栏右上角、云同步旁的 AI 入口：任何页面一键打开 / 关闭 AI 小窗 */
export default function TitleBarAIButton() {
  const { enabled, open, setOpen } = useStore(useShallow((state) => ({
    enabled: state.aiCommandCenterEnabled,
    open: state.aiCommandCenterOpen,
    setOpen: state.setAiCommandCenterOpen,
  })))
  if (!enabled) return null
  const shortcut = formatShortcut(shortcutManager.shortcuts?.['panels.aiCommandCenter']?.currentKey || 'CmdOrCtrl+K')

  return (
    <Tooltip title={`${open ? '关闭' : '打开'} FlotaAI（${shortcut}）`} placement="bottom">
      <Box
        component="button"
        type="button"
        aria-label={open ? '关闭 FlotaAI' : '打开 FlotaAI'}
        aria-pressed={open}
        onClick={() => setOpen(!open)}
        sx={(theme) => {
          const dark = theme.palette.mode === 'dark'
          const primary = theme.palette.primary.main
          return {
            // 与标题栏左侧的置顶按钮同尺寸同圆角
            width: 28,
            height: 28,
            p: 0,
            border: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            borderRadius: '7px',
            color: open ? primary : theme.palette.text.secondary,
            backgroundColor: open ? alpha(primary, dark ? 0.2 : 0.12) : 'transparent',
            boxShadow: open ? `inset 0 0 0 1px ${alpha(primary, dark ? 0.3 : 0.18)}` : 'none',
            transition: 'background-color 160ms ease, color 160ms ease, box-shadow 160ms ease',
            '& svg': { fontSize: 17, transition: 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), filter 220ms ease' },
            '&:hover': {
              color: primary,
              backgroundColor: open ? alpha(primary, dark ? 0.26 : 0.16) : (dark ? 'rgba(255,255,255,0.08)' : 'rgba(22,22,24,0.05)'),
              '& svg': { transform: 'rotate(-12deg) scale(1.08)', filter: `drop-shadow(0 0 4px ${alpha(primary, 0.45)})` },
            },
            '&:focus-visible': { outline: `2px solid ${alpha(primary, 0.5)}`, outlineOffset: 1 },
          }
        }}
      >
        <FlotaAIIcon />
      </Box>
    </Tooltip>
  )
}
