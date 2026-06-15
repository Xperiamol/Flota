// 浮窗统一玻璃风样式（与编辑器右键菜单一致）
// 使用方式：
//   sx={{ ...floatingGlassSx({ radius: '4px', shadow: 'menu' }) }}
export const floatingGlassSx = ({ radius = '4px', shadow = 'default' } = {}) => ({
  borderRadius: radius,
  bgcolor: (theme) => theme.palette.mode === 'dark'
    ? 'rgba(15, 23, 42, 0.78)'
    : 'rgba(255, 255, 255, 0.78)',
  border: '1px solid',
  borderColor: (theme) => theme.palette.mode === 'dark'
    ? 'rgba(148, 163, 184, 0.18)'
    : 'rgba(148, 163, 184, 0.24)',
  boxShadow: shadow === 'menu'
    ? '0 18px 56px rgba(15, 23, 42, 0.22), 0 4px 16px rgba(15, 23, 42, 0.10)'
    : '0 10px 36px rgba(15, 23, 42, 0.18), 0 2px 10px rgba(15, 23, 42, 0.08)',
  backdropFilter: 'blur(18px) saturate(160%)',
  WebkitBackdropFilter: 'blur(18px) saturate(160%)',
  backgroundClip: 'padding-box',
})
