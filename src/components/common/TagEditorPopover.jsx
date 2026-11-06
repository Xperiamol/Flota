import { Box, Popover, Typography } from '@mui/material'
import { Close as CloseIcon } from './AppIcons'
import PanelIconButton from './PanelIconButton'
import TagInput from './TagInput'

// 「管理标签」弹层：笔记编辑器和时间轴共用，标签的输入、建议、插件扩展都一样。
//
// value / onChange 用逗号分隔的标签字符串（与 TagInput 一致）；onChange 每次增删都会触发，
// 由调用方决定立即保存还是延后保存。

export const NOTE_MAX_TAGS = 5

export default function TagEditorPopover({
  anchorEl,
  onClose,
  value,
  onChange,
  placeholder = '添加标签…',
  maxTags = NOTE_MAX_TAGS,
  getSuggestions,
  noteContent,
  noteId,
  anchorOrigin = { vertical: 'bottom', horizontal: 'center' },
  transformOrigin = { vertical: 'top', horizontal: 'center' },
}) {
  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={anchorOrigin}
      transformOrigin={transformOrigin}
      slotProps={{
        paper: {
          sx: {
            mt: 0.75,
            width: 360,
            maxWidth: 'calc(100vw - 32px)',
            overflow: 'visible',
          }
        }
      }}
    >
      <Box sx={{ p: 1.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'text.disabled', letterSpacing: '0.04em' }}>
            管理标签
          </Typography>
          <PanelIconButton title="关闭标签" onClick={onClose}>
            <CloseIcon />
          </PanelIconButton>
        </Box>

        <TagInput
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          maxTags={maxTags}
          showSuggestions
          getSuggestions={getSuggestions}
          noteContent={noteContent}
          noteId={noteId}
          sx={{ width: '100%' }}
        />
      </Box>
    </Popover>
  )
}
