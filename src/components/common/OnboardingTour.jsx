import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Box, Button, Modal, Typography, useTheme } from '@mui/material'
import { VisibilityOffOutlined, MicNoneRounded, HistoryRounded, BackupOutlined, AccountTreeRounded } from '@mui/icons-material'
import { WHITEBOARD_AI_EXAMPLES } from '../../utils/whiteboardAIPrompts'
import { usePrefsStore } from '../../store/usePrefsStore'

const steps = [
  { title: '你好，欢迎来到 Flota', text: '几步认识你的记录空间。随时可以跳过，之后也能在设置里重新打开。', note: '先记下来，再慢慢整理。' },
  { target: 'notes', title: '先把灵感记下来', text: '笔记支持 Markdown、图片和录音，也可以切换到画布，让想法自由展开。', note: '一句话，也值得被留下。' },
  { target: 'todo', title: '给下一步留个位置', text: '把要做的事放进待办，按优先级整理，再用专注计时开始。', note: '一次只做一件小事。' },
  { target: 'calendar', title: '让安排落在日历上', text: '按日期查看笔记和待办，把计划与当天的记录放在一起。', note: '为重要的事情留出时间。' },
  { target: 'timeline', title: '所有记录，一条时间线', text: '在时间轴里回看笔记、画布和待办，再用搜索、标签和时间筛选找到它们。', note: '不用记住放在哪一天。' },
  { target: 'ai-quick', title: '右上角，随时问 AI', text: '点右上角星光按钮，不离开当前页面就能问 AI：做组件、分章节写长文、记住偏好。左侧可进入完整对话，服务与记忆需要先在设置里配置。', note: '帮手就在手边，不必打断思路。' },
  { target: 'settings', title: '把这里变成你的样子', text: '挑选主题和材质纹理，调整编辑习惯，或设置同步、备份与历史版本。', note: '舒服的工具，才会常常打开。' },
  { canvas: true, features: true, target: 'ai-quick', title: '画布 AI，能做这些', text: '打开一篇画布笔记，再点右上角 AI。选个示例，改好描述后发送。' },
  { features: true, title: '还有几件，可能正合你意', text: '需要时，到设置里开启或调整。' },
  { title: '现在，写下第一句话', text: '不必一次学会全部功能。从一篇笔记、一个待办，或今天的灵感开始就好。', note: '很高兴，在这里遇见你。' },
]

const features = [
  { title: '隐藏模式', text: '设置 → 通用，为窗口开启系统级内容保护。', Icon: VisibilityOffOutlined },
  { title: '离线语音', text: '下载模型后，录音在本机转成文字。', Icon: MicNoneRounded },
  { title: '历史版本', text: '找回笔记旧内容，间隔和保留数量可调。', Icon: HistoryRounded },
  { title: '多网盘备份', text: '给笔记、历史和附件多留几份副本。', Icon: BackupOutlined },
]

export default function OnboardingTour({ ready = true }) {
  const theme = useTheme()
  const seen = usePrefsStore(state => state.onboardingSeen)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [layout, setLayout] = useState(null)
  const card = useRef(null)
  const item = steps[step]
  const finish = useCallback(() => {
    usePrefsStore.getState().setPref('onboardingSeen', true)
    setOpen(false)
  }, [])
  useEffect(() => {
    if (!ready || seen) return
    const timer = setTimeout(() => { setStep(0); setOpen(true) }, 700)
    return () => clearTimeout(timer)
  }, [ready, seen])
  useEffect(() => {
    const replay = () => { setStep(0); setOpen(true) }
    window.addEventListener('flota:show-onboarding', replay)
    return () => window.removeEventListener('flota:show-onboarding', replay)
  }, [])
  useLayoutEffect(() => {
    if (!open) return
    const target = item.target ? document.querySelector(`[data-tour="${item.target}"]`) : null
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const measure = () => {
      const rect = target?.getBoundingClientRect()
      const visible = rect && rect.width > 0 && rect.bottom > 0 && rect.top < innerHeight
      const maxWidth = Math.min(360, innerWidth - 32)
      const rightWidth = visible ? Math.min(maxWidth, innerWidth - rect.right - 56) : 0
      const leftWidth = visible ? Math.min(maxWidth, rect.left - 56) : 0
      const side = Math.max(leftWidth, rightWidth) >= 240 ? (rightWidth >= leftWidth ? 'right' : 'left') : null
      const width = side ? (side === 'right' ? rightWidth : leftWidth) : maxWidth
      const height = Math.min(card.current?.offsetHeight || 340, innerHeight - 32)
      setLayout({
        width, height, side,
        left: side === 'right' ? rect.right + 40 : side === 'left' ? rect.left - width - 40 : (innerWidth - width) / 2,
        top: side ? Math.max(16, Math.min(innerHeight - height - 16, rect.top - 56)) : Math.max(16, (innerHeight - height) / 2),
        target: side ? { x: rect.x - 8, y: rect.y - 8, width: rect.width + 16, height: rect.height + 16 } : null,
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (target) observer.observe(target)
    if (card.current) observer.observe(card.current)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [open, item])
  const next = () => step === steps.length - 1 ? finish() : setStep(index => index + 1)
  const dark = theme.palette.mode === 'dark'
  const ink = dark ? '#aecfc8' : '#426d68'
  const hole = layout?.target
  return <Modal open={open} onClose={finish} hideBackdrop aria-labelledby="flota-tour-title" aria-describedby="flota-tour-description">
    <Box role="dialog" aria-modal="true" tabIndex={-1} data-onboarding-tour sx={{ position: 'fixed', inset: 0, outline: 'none' }}
      onKeyDown={event => {
        if (event.key === 'ArrowRight') { event.preventDefault(); next() }
        if (event.key === 'ArrowLeft') { event.preventDefault(); setStep(index => Math.max(0, index - 1)) }
      }}>
      <svg aria-hidden="true" width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <defs><mask id="flota-tour-mask"><rect width="100%" height="100%" fill="white" />{hole && <rect x={hole.x} y={hole.y} width={hole.width} height={hole.height} rx="16" fill="black" />}</mask><marker id="flota-tour-arrow" viewBox="0 0 12 12" refX="9" refY="6" markerWidth="10" markerHeight="10" orient="auto"><path d="M2 2 L10 6 L2 10" fill="none" stroke={ink} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></marker></defs>
        <rect width="100%" height="100%" fill={dark ? 'rgba(7,12,16,.7)' : 'rgba(32,43,48,.42)'} mask="url(#flota-tour-mask)" />
        {hole && <><rect data-onboarding-highlight x={hole.x - 3} y={hole.y - 2} width={hole.width + 5} height={hole.height + 4} rx="18" fill="none" stroke="#e9c66f" strokeWidth="2" strokeDasharray="5 4" />
          <path d={`M${layout.side === 'right' ? layout.left - 7 : layout.left + layout.width + 7},${layout.top + Math.min(layout.height * .5, 120)} Q${layout.side === 'right' ? hole.x + hole.width + 70 : hole.x - 70},${Math.max(20, hole.y - 24)} ${layout.side === 'right' ? hole.x + hole.width + 8 : hole.x - 8},${hole.y + hole.height / 2}`} fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" markerEnd="url(#flota-tour-arrow)" />
        </>}
      </svg>
      <Box ref={card} data-onboarding-card sx={{ position: 'absolute', width: layout?.width || 'min(360px, calc(100vw - 32px))', left: layout?.left ?? '50%', top: layout?.top ?? '50%', transform: layout ? 'none' : 'translate(-50%,-50%)', maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto', p: item.features ? 2 : 3, boxSizing: 'border-box', bgcolor: dark ? '#282d2d' : '#fffdf6', color: dark ? '#f1ede3' : '#343e3c', border: `1.5px solid ${dark ? '#71766a' : '#b8bba9'}`, borderRadius: '22px 16px 24px 18px / 18px 24px 16px 22px', boxShadow: '0 24px 80px rgba(10,25,20,.25), inset 0 0 0 4px rgba(170,172,145,.07)', outline: 'none' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: item.features ? 1 : 2 }}><Typography variant="caption" sx={{ color: ink, fontWeight: 650, letterSpacing: 1 }}>FLOTA / 初次见面</Typography><Button size="small" onClick={finish} sx={{ color: 'inherit', opacity: .65, minWidth: 0, fontSize: 11 }}>跳过</Button></Box>
        {!item.features && <Box aria-hidden="true" component="svg" viewBox="0 0 104 60" sx={{ width: 90, height: 52, color: ink, mb: 1 }}>
          <path d="M16 10 Q40 4 63 12 L60 49 Q38 44 14 48 Z M22 19 L51 22 M21 28 L47 30 M21 37 L40 38 M16 10 L11 12 L9 51 L60 53" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M78 7 L81 17 L91 20 L81 23 L78 33 L75 23 L65 20 L75 17 Z" fill="#edcf7d" fillOpacity=".65" stroke="currentColor" strokeWidth="1.2" /><path d="M86 40 Q99 39 94 48 Q88 53 84 47" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </Box>}
        <Typography id="flota-tour-title" sx={{ fontSize: item.features ? 20 : 23, lineHeight: 1.4, fontWeight: 700, letterSpacing: '-.03em', mb: 1.5 }}>{item.title}</Typography>
        <Typography id="flota-tour-description" sx={{ fontSize: 13, lineHeight: 1.9, opacity: .75 }}>{item.text}</Typography>
        {item.features && <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mt: 1.5, mb: 2 }}>
          {(item.canvas ? WHITEBOARD_AI_EXAMPLES.map(example => ({ title: example.label, text: example.description, Icon: AccountTreeRounded })) : features).map(({ title, text, Icon }) => <Box key={title} sx={{ p: 1, border: `1px dashed ${dark ? '#59675e' : '#c8cebf'}`, borderRadius: '12px 8px 10px 9px', bgcolor: dark ? 'rgba(174,207,200,.035)' : 'rgba(66,109,104,.025)' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: .5, mb: .5 }}><Icon sx={{ fontSize: 17, color: ink }} /><Typography sx={{ fontSize: 13, fontWeight: 650 }}>{title}</Typography></Box><Typography sx={{ fontSize: 11, lineHeight: 1.55, opacity: .7 }}>{text}</Typography>
          </Box>)}
        </Box>}
        {item.note && <Typography sx={{ display: 'inline-block', fontFamily: '"Kaiti SC", "STKaiti", serif', fontSize: 15, mt: 2, mb: 2.5, color: ink, backgroundImage: 'linear-gradient(transparent 65%, rgba(233,198,111,.22) 65%)' }}>{item.note}</Typography>}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Typography variant="caption" sx={{ opacity: .5, fontVariantNumeric: 'tabular-nums' }}>{String(step + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>{step > 0 && <Button size="small" onClick={() => setStep(index => index - 1)} sx={{ color: 'inherit', opacity: .7 }}>上一步</Button>}<Button autoFocus size="small" variant="contained" disableElevation onClick={next} sx={{ bgcolor: '#426d68', color: '#fffdf6', borderRadius: '10px 8px 11px 9px', '&:hover': { bgcolor: '#355e59' } }}>{step === 0 ? '带我看看' : step === steps.length - 1 ? '开始使用' : '下一步'}</Button></Box>
        </Box>
        <Box aria-hidden="true" sx={{ display: 'flex', gap: .5, mt: 2 }}>{steps.map((_, index) => <Box key={index} sx={{ flex: 1, height: 2, borderRadius: 1, bgcolor: index <= step ? ink : dark ? '#464b47' : '#e5e4d8' }} />)}</Box>
      </Box>
    </Box>
  </Modal>
}
