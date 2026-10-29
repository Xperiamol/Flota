import { forwardRef } from 'react'
import { Box, ButtonBase } from '@mui/material'

// A quiet property trigger inside a shared row; keeps normal buttons elsewhere unchanged.
const InlinePropertyButton = forwardRef(({ startIcon, endIcon, children, variant, sx, ...props }, ref) => (
  <ButtonBase ref={ref} {...props} sx={[...(Array.isArray(sx) ? sx : [sx]), {
    display: 'flex', justifyContent: 'flex-start', gap: 1, width: '100%', minWidth: 0, height: 34,
    border: 0, borderRadius: 1.25, bgcolor: 'transparent', boxShadow: 'none', py: 0, pl: 1, fontSize: 12.5,
    fontWeight: 500, lineHeight: 1.3,
    '&:hover': { bgcolor: 'action.hover', border: 0 },
    '&.Mui-disabled': { border: 0, bgcolor: 'transparent', color: 'text.disabled', opacity: 0.65 },
    '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
  }]}>
    {startIcon && <Box component="span" sx={{ display: 'flex', flexShrink: 0, '& svg': { fontSize: 18 } }}>{startIcon}</Box>}
    <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</Box>
    {endIcon && <Box component="span" sx={{ display: 'flex', ml: 'auto', flexShrink: 0, opacity: 0.6, '& svg': { fontSize: 16 } }}>{endIcon}</Box>}
  </ButtonBase>
))
export default InlinePropertyButton
