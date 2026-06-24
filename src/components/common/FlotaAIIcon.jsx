import React from 'react'
import { SvgIcon } from '@mui/material'

const FlotaAIIcon = React.forwardRef(function FlotaAIIcon(
  { animated = false, sx, ...props },
  ref
) {
  void animated
  const mergedSx = Array.isArray(sx) ? sx : [sx]

  return (
    <SvgIcon
      ref={ref}
      viewBox="0 0 24 24"
      sx={mergedSx}
      {...props}
    >
      {/* 鲸鱼流体主体 */}
      <path
        d="M 4 11.5 C 4 8.2 7.5 7 10.5 7 C 13.5 7 15 9.2 16.2 10.5 C 17.2 11.5 18.5 12 20 12 C 18.2 12.4 17.2 13.2 16 14.2 C 14.5 15.5 13 16.5 10.5 16.5 C 7.5 16.5 4 14.8 4 11.5 Z"
        fill="currentColor"
      />
      {/* 尾部伴生微滴 / 灵感喷水 */}
      <circle
        cx="20"
        cy="7.5"
        r="2.2"
        fill="currentColor"
      />
    </SvgIcon>
  )
})

export default FlotaAIIcon
