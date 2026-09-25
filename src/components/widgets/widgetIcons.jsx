import { forwardRef } from 'react'
import SvgIcon from '@mui/material/SvgIcon'
import {
  FlotaCalendarIcon, FlotaGraphIcon, FlotaNoteIcon, FlotaTagIcon, FlotaTimelineIcon, FlotaTodoIcon,
} from '../common/FlotaIcons'

// 组件图标：与 FlotaIcons 同一套 24px 网格、实心 + 半透明双色、跟随文字颜色
const icon = (name, shape) => {
  const Icon = forwardRef((props, ref) => <SvgIcon ref={ref} {...props}>{shape}</SvgIcon>)
  Icon.displayName = name
  Icon.muiName = SvgIcon.muiName
  return Icon
}

const WidgetIcon = icon('WidgetIcon', <>
  <rect x="2" y="2" width="9" height="9" rx="2.5" />
  <rect x="13" y="2" width="9" height="9" rx="4.5" opacity=".5" />
  <rect x="2" y="13" width="9" height="9" rx="2.5" />
  <rect x="13" y="13" width="9" height="9" rx="2.5" />
</>)

const CardsIcon = icon('CardsIcon', <>
  <rect x="8" y="2" width="14" height="15" rx="3" opacity=".5" />
  <path fillRule="evenodd" d="M5 7h9a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3Zm1.5 5a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-6Zm0 4a1 1 0 0 0 0 2h4a1 1 0 0 0 0-2h-4Z" />
</>)

const BoardIcon = icon('BoardIcon', <>
  <rect x="2" y="2" width="6" height="14" rx="2.5" />
  <rect x="9" y="2" width="6" height="20" rx="2.5" opacity=".5" />
  <rect x="16" y="2" width="6" height="10" rx="2.5" />
</>)

const BookIcon = icon('BookIcon', <>
  <path d="M2 5.5A2.5 2.5 0 0 1 4.5 3H8a4 4 0 0 1 4 4v15a3 3 0 0 0-3-3H4.5A2.5 2.5 0 0 1 2 16.5Z" />
  <path opacity=".5" d="M22 5.5A2.5 2.5 0 0 0 19.5 3H16a4 4 0 0 0-4 4v15a3 3 0 0 1 3-3h4.5a2.5 2.5 0 0 0 2.5-2.5Z" />
</>)

const HabitIcon = icon('HabitIcon', <>
  <rect x="2" y="2" width="5.5" height="5.5" rx="1.75" />
  <rect x="9.25" y="2" width="5.5" height="5.5" rx="1.75" opacity=".5" />
  <rect x="16.5" y="2" width="5.5" height="5.5" rx="1.75" />
  <rect x="2" y="9.25" width="5.5" height="5.5" rx="1.75" opacity=".5" />
  <rect x="9.25" y="9.25" width="5.5" height="5.5" rx="1.75" />
  <rect x="16.5" y="9.25" width="5.5" height="5.5" rx="1.75" />
  <rect x="2" y="16.5" width="5.5" height="5.5" rx="1.75" />
  <rect x="9.25" y="16.5" width="5.5" height="5.5" rx="1.75" />
  <rect x="16.5" y="16.5" width="5.5" height="5.5" rx="1.75" opacity=".5" />
</>)

const HourglassIcon = icon('HourglassIcon', <>
  <path opacity=".5" d="M6 5h12v2.2a6 6 0 0 1-3 5.2L14.3 12l.7.4a6 6 0 0 1 3 5.2V19H6v-1.4a6 6 0 0 1 3-5.2l.7-.4-.7-.4a6 6 0 0 1-3-5.2Z" />
  <rect x="4" y="2" width="16" height="3.5" rx="1.75" />
  <rect x="4" y="18.5" width="16" height="3.5" rx="1.75" />
  <path d="M8.5 18.5c0-2 1.6-3.6 3.5-4 1.9.4 3.5 2 3.5 4Z" />
</>)

const DropIcon = icon('DropIcon', <>
  <path opacity=".5" d="M12 2.5c.5 0 .9.2 1.3.7C16.1 6.7 19 10.8 19 14.8a7 7 0 0 1-14 0c0-4 2.9-8.1 5.7-11.6.4-.5.8-.7 1.3-.7Z" />
  <path d="M5.1 13.6h13.8a7 7 0 0 1-13.8 0Z" />
</>)

const ChartIcon = icon('ChartIcon', <>
  <rect x="2.5" y="12" width="5" height="10" rx="2" />
  <rect x="9.5" y="2" width="5" height="20" rx="2" />
  <rect x="16.5" y="7" width="5" height="15" rx="2" opacity=".5" />
</>)

const ListIcon = icon('ListIcon', <>
  <circle cx="4.5" cy="5" r="2.5" />
  <circle cx="4.5" cy="12" r="2.5" />
  <circle cx="4.5" cy="19" r="2.5" />
  <path opacity=".5" d="M10.5 3.5h10a1.5 1.5 0 0 1 0 3h-10a1.5 1.5 0 0 1 0-3Zm0 7h10a1.5 1.5 0 0 1 0 3h-10a1.5 1.5 0 0 1 0-3Zm0 7h10a1.5 1.5 0 0 1 0 3h-10a1.5 1.5 0 0 1 0-3Z" />
</>)

const TargetIcon = icon('TargetIcon', <>
  <path opacity=".5" fillRule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z" />
  <circle cx="12" cy="12" r="3.5" />
</>)

const TimerIcon = icon('TimerIcon', <>
  <rect x="9" y="1" width="6" height="3" rx="1.5" opacity=".5" />
  <path fillRule="evenodd" d="M12 4.5a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm0 3.5a1.3 1.3 0 0 0-1.3 1.3v4.2c0 .4.2.7.4 1l2.8 2.8a1.3 1.3 0 0 0 1.8-1.8l-2.4-2.4V9.3A1.3 1.3 0 0 0 12 8Z" />
</>)

const StarIcon = icon('StarIcon',
  <path d="M10.6 3c.6-1.2 2.2-1.2 2.8 0l1.9 3.9 4.3.6c1.3.2 1.8 1.8.9 2.7l-3.1 3 .7 4.3c.2 1.3-1.1 2.3-2.3 1.7L12 17.1l-3.8 2c-1.2.7-2.5-.4-2.3-1.6l.7-4.3-3.1-3c-1-.9-.4-2.5.9-2.7l4.3-.6Z" />
)

const HeartIcon = icon('HeartIcon',
  <path d="M12 20.5c-.3 0-.6-.1-.9-.3C7.4 17.6 2.5 14 2.5 8.9A5.2 5.2 0 0 1 7.7 3.6c1.8 0 3.3.9 4.3 2.3a5.2 5.2 0 0 1 4.3-2.3 5.2 5.2 0 0 1 5.2 5.3c0 5.1-4.9 8.7-8.6 11.3-.3.2-.6.3-.9.3Z" />
)

const WalletIcon = icon('WalletIcon', <>
  <path opacity=".5" d="M4 5.8 15.3 2.4a2 2 0 0 1 2.6 1.9V6H4Z" />
  <path fillRule="evenodd" d="M5 6h14a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3Zm11.5 5.5a2 2 0 1 0 0 4h3.5v-4h-3.5Z" />
</>)

const FitnessIcon = icon('FitnessIcon', <>
  <rect x="8" y="10.5" width="8" height="3" opacity=".5" />
  <rect x="3.5" y="5" width="5" height="14" rx="2" />
  <rect x="15.5" y="5" width="5" height="14" rx="2" />
  <rect x="1" y="8.5" width="2.5" height="7" rx="1.25" />
  <rect x="20.5" y="8.5" width="2.5" height="7" rx="1.25" />
</>)

const LeafIcon = icon('LeafIcon', <>
  <path opacity=".5" d="M20.5 3c.3 0 .5.2.5.5C21 13 16 19 9 19c-1.4 0-2.7-.3-3.8-.9C4.4 16.9 4 15.5 4 14 4 7.5 10 3 20.5 3Z" />
  <path d="M15.3 7.8a1 1 0 0 1 1.4 1.4c-3.6 3.6-7.3 7.8-10 12.2a1 1 0 0 1-1.7-1c2.8-4.6 6.6-8.9 10.3-12.6Z" />
</>)

const MoodIcon = icon('MoodIcon',
  <path fillRule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20ZM8.5 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM7.9 13.5a1 1 0 0 0-.9 1.5 5.8 5.8 0 0 0 10 0 1 1 0 0 0-.9-1.5Z" />
)

const BookmarkIcon = icon('BookmarkIcon', <>
  <path d="M7 2h10a3 3 0 0 1 3 3v15.6a1 1 0 0 1-1.6.8L12 16.8l-6.4 4.6a1 1 0 0 1-1.6-.8V5a3 3 0 0 1 3-3Z" />
</>)

const CodeIcon = icon('CodeIcon', <>
  <rect x="2" y="3" width="20" height="18" rx="4" opacity=".5" />
  <path d="M8.7 8.3a1 1 0 0 1 0 1.4L6.4 12l2.3 2.3a1 1 0 0 1-1.4 1.4l-3-3a1 1 0 0 1 0-1.4l3-3a1 1 0 0 1 1.4 0Zm6.6 0a1 1 0 0 1 1.4 0l3 3a1 1 0 0 1 0 1.4l-3 3a1 1 0 0 1-1.4-1.4l2.3-2.3-2.3-2.3a1 1 0 0 1 0-1.4Z" />
</>)

/** 可选的组件图标（manifest.icon 取这些名字之一） */
export const WIDGET_ICONS = {
  widget: WidgetIcon,
  cards: CardsIcon,
  board: BoardIcon,
  book: BookIcon,
  habit: HabitIcon,
  hourglass: HourglassIcon,
  drop: DropIcon,
  chart: ChartIcon,
  list: ListIcon,
  target: TargetIcon,
  timer: TimerIcon,
  star: StarIcon,
  heart: HeartIcon,
  wallet: WalletIcon,
  fitness: FitnessIcon,
  leaf: LeafIcon,
  mood: MoodIcon,
  bookmark: BookmarkIcon,
  code: CodeIcon,
  note: FlotaNoteIcon,
  check: FlotaTodoIcon,
  calendar: FlotaCalendarIcon,
  tag: FlotaTagIcon,
  timeline: FlotaTimelineIcon,
  graph: FlotaGraphIcon,
}

// 早期组件的 emoji 图标 → 对应的图标名
const EMOJI_ALIASES = {
  '🃏': 'cards', '🗂': 'cards', '🎴': 'cards', '📋': 'board', '📌': 'board', '📚': 'book', '📖': 'book', '📕': 'book',
  '✅': 'habit', '☑️': 'check', '🔥': 'habit', '⏳': 'hourglass', '⌛': 'hourglass', '⏰': 'timer', '⏱': 'timer', '🍅': 'timer',
  '💧': 'drop', '🚰': 'drop', '📊': 'chart', '📈': 'chart', '📝': 'note', '🗒': 'list', '🎯': 'target', '⭐': 'star',
  '🌟': 'star', '❤️': 'heart', '💰': 'wallet', '💵': 'wallet', '💪': 'fitness', '🏃': 'fitness', '🌱': 'leaf', '🪴': 'leaf',
  '😊': 'mood', '🙂': 'mood', '🔖': 'bookmark', '📅': 'calendar', '🗓': 'calendar', '🏷': 'tag',
}

export const resolveWidgetIcon = (value) => {
  const key = String(value || '').trim()
  if (WIDGET_ICONS[key]) return WIDGET_ICONS[key]
  const alias = EMOJI_ALIASES[key] || EMOJI_ALIASES[key.replace(/️/g, '')]
  return WIDGET_ICONS[alias] || WidgetIcon
}

/** 组件图标：按 manifest.icon 取图，未知或缺省时用通用组件图标 */
export function WidgetGlyph({ icon: name, ...props }) {
  const Icon = resolveWidgetIcon(name)
  return <Icon {...props} />
}
