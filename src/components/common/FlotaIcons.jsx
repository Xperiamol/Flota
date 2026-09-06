import { forwardRef } from 'react'
import SvgIcon from '@mui/material/SvgIcon'

// Shared 24px grid; cutouts stay transparent in every theme.
const icon = (name, shape) => {
  const Icon = forwardRef((props, ref) => <SvgIcon ref={ref} {...props}>{shape}</SvgIcon>)
  Icon.displayName = name
  Icon.muiName = SvgIcon.muiName
  return Icon
}

export const FlotaNoteIcon = icon('FlotaNoteIcon', <>
  <path fillRule="evenodd" d="M6 2h8v4.5A2.5 2.5 0 0 0 16.5 9H21v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3Zm1 10a1 1 0 0 0 0 2h7a1 1 0 0 0 0-2H7Zm0 5a1 1 0 0 0 0 2h7a1 1 0 0 0 0-2H7Z" />
  <path opacity=".5" d="M14 2 21 9h-4.5A2.5 2.5 0 0 1 14 6.5Z" />
</>)

export const FlotaTodoIcon = icon('FlotaTodoIcon',
  <path fillRule="evenodd" d="M6 2h12a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4Zm12.1 5.9a1.5 1.5 0 0 0-2.2 0L10 13.8l-2.4-2.4a1.5 1.5 0 0 0-2.2 2.2l3.5 3.5a1.5 1.5 0 0 0 2.2 0l7-7a1.5 1.5 0 0 0 0-2.2Z" />
)

export const FlotaCalendarIcon = icon('FlotaCalendarIcon', <>
  <path opacity=".5" d="M6 4h12a4 4 0 0 1 4 4v1H2V8a4 4 0 0 1 4-4Z" />
  <path fillRule="evenodd" d="M6 2.5a1.5 1.5 0 0 1 3 0v3a1.5 1.5 0 0 1-3 0v-3Zm9 0a1.5 1.5 0 0 1 3 0v3a1.5 1.5 0 0 1-3 0v-3ZM2 10h20v8a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4v-8Zm4 3a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1H6Zm5.5 0a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-1Zm5.5 0a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-1Z" />
</>)

export const FlotaTimelineIcon = icon('FlotaTimelineIcon', <>
  <rect x="2" y="12" width="11" height="8" rx="2.5" />
  <rect x="12" y="4" width="10" height="7" rx="2.5" opacity=".5" />
</>)

export const FlotaWhiteboardIcon = icon('FlotaWhiteboardIcon', <>
  <path fillRule="evenodd" d="M6 2h11a4 4 0 0 1 4 4v11h-2a2 2 0 0 0-2 2v3H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4Zm3 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm6.9 6.5a1 1 0 0 0-1.8 0l-2.4 4a1 1 0 0 0 .9 1.5h4.8a1 1 0 0 0 .9-1.5l-2.4-4Z" />
  <path opacity=".5" d="M19 17h3v3a2 2 0 0 1-2 2h-3v-3a2 2 0 0 1 2-2Z" />
</>)

export const FlotaSparkleIcon = icon('FlotaSparkleIcon', <>
  <path d="M10 2c1 0 1.5.6 1.8 1.8 1 4.3 2.6 5.9 6.9 6.9 1.2.3 1.8.8 1.8 1.8s-.6 1.5-1.8 1.8c-4.3 1-5.9 2.6-6.9 6.9-.3 1.2-.8 1.8-1.8 1.8s-1.5-.6-1.8-1.8c-1-4.3-2.6-5.9-6.9-6.9C.5 14 .2 13.4.2 12.5s.3-1.5 1.1-1.8c4.3-1 5.9-2.6 6.9-6.9C8.5 2.6 9 2 10 2Z" />
  <path d="M20 1c.4 0 .6.3.7.8.3 1.4 1.1 2.2 2.5 2.5.5.1.8.3.8.7s-.3.6-.8.7c-1.4.3-2.2 1.1-2.5 2.5-.1.5-.3.8-.7.8s-.6-.3-.7-.8c-.3-1.4-1.1-2.2-2.5-2.5-.5-.1-.8-.3-.8-.7s.3-.6.8-.7c1.4-.3 2.2-1.1 2.5-2.5.1-.5.3-.8.7-.8Z" />
</>)

export const FlotaPluginIcon = icon('FlotaPluginIcon', <>
  <path d="M5 2h6v3h1a2 2 0 0 1 0 4h-1v2H9a3 3 0 0 0-6 0H2V5a3 3 0 0 1 3-3ZM2 12h2v-1a2 2 0 0 1 4 0v1h3v2a3 3 0 0 0 0 6v2H5a3 3 0 0 1-3-3Zm10 0h2a3 3 0 0 0 6 0h2v7a3 3 0 0 1-3 3h-7v-3h-1a2 2 0 0 1 0-4h1Z" />
  <path opacity=".5" d="M12 2h7a3 3 0 0 1 3 3v6h-3v1a2 2 0 0 1-4 0v-1h-3v-1a3 3 0 0 0 0-6Z" />
</>)

export const FlotaPersonIcon = icon('FlotaPersonIcon', <>
  <circle cx="12" cy="6.5" r="5" />
  <path d="M12 12.5a8.5 8.5 0 0 1 8.5 8.5 1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5 8.5 8.5 0 0 1 8.5-8.5Z" />
</>)

export const FlotaSettingsIcon = icon('FlotaSettingsIcon',
  <path fillRule="evenodd" d="M10 1h4a1 1 0 0 1 1 1v2l2 1.2 1.8-.9a1 1 0 0 1 1.4.4l2 3.4a1 1 0 0 1-.4 1.4L20 10.6v2.8l1.8 1.1a1 1 0 0 1 .4 1.4l-2 3.4a1 1 0 0 1-1.4.4l-1.8-.9-2 1.2v2a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-2l-2-1.2-1.8.9a1 1 0 0 1-1.4-.4l-2-3.4a1 1 0 0 1 .4-1.4L4 13.4v-2.8L2.2 9.5a1 1 0 0 1-.4-1.4l2-3.4a1 1 0 0 1 1.4-.4l1.8.9L9 4V2a1 1 0 0 1 1-1Zm2 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
)

export const FlotaPinIcon = icon('FlotaPinIcon', <>
  <path opacity=".5" d="M8 5h8l.7 8H7.3Z" />
  <path d="M7 2h10a2 2 0 0 1 0 4H7a2 2 0 0 1 0-4Zm.5 10h9c2.5 0 4 2 4 4a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1c0-2 1.5-4 4-4ZM10 17h4c0 3-.8 6-2 6s-2-3-2-6Z" />
</>)

export const FlotaGraphIcon = icon('FlotaGraphIcon', <>
  <path opacity=".5" d="m7 5 10 1 1 12-12 1L7 5Zm2 3-.7 8 6.9-.5-.5-6.8L9 8Z" fillRule="evenodd" />
  <circle cx="7" cy="5" r="4" />
  <circle cx="18" cy="7" r="3.5" />
  <circle cx="6" cy="18" r="3.5" />
  <circle cx="17" cy="18" r="4" />
</>)

export const FlotaTagIcon = icon('FlotaTagIcon',
  <path fillRule="evenodd" d="M5 2h5.3a3 3 0 0 1 2.1.9l9.2 9.2a3 3 0 0 1 0 4.2l-5.3 5.3a3 3 0 0 1-4.2 0l-9.2-9.2a3 3 0 0 1-.9-2.1V5a3 3 0 0 1 3-3Zm2.5 3A2.5 2.5 0 1 0 7.5 10a2.5 2.5 0 0 0 0-5Z" />
)
