import { useEffect, useMemo, useState } from 'react'
import { Box, Button, Switch, Tooltip, Typography, alpha } from '@mui/material'
import {
  AccountTreeRounded, AutoStoriesRounded, ChecklistRounded, ImageSearchRounded, PsychologyRounded,
  PublicRounded, TravelExploreRounded, WidgetsRounded, EastRounded,
} from '../common/AppIcons'
import FlotaAIOrb from '../common/FlotaAIOrb'
import { useStore } from '../../store/useStore'
import { fetchTodoStats } from '../../api/todoAPI'
import { askAI } from '../../utils/widgets/askAI'

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

// ---------- 演示：一次真实的 Agent 流程是怎样跑的（示意，不是实时数据） ----------

const DEMOS = [
  {
    ask: '把这篇会议记录画成流程图',
    steps: ['读取当前笔记', '梳理步骤与分支', '生成画布', '等你确认后插入'],
  },
  {
    ask: '写一篇 8000 字的短篇小说，雨夜里的图书馆',
    steps: ['规划大纲与人物', '逐章写作 · 滚动摘要保持连贯', '合并成稿', '存成一篇新笔记'],
  },
  {
    ask: '做一个读书打卡组件，显示本月连续天数',
    steps: ['写清需求与数据结构', '生成组件代码', '沙箱试运行', '出错自动修复'],
  },
  {
    ask: '看看我今天和逾期的待办，排个顺序',
    steps: ['读取今天与逾期待办', '按重要 / 紧急排序', '给出执行顺序', '调整待办前先问你'],
  },
]

function AgentDemo() {
  const [demoIndex, setDemoIndex] = useState(0)
  const [stepCount, setStepCount] = useState(reduceMotion() ? 4 : 0)
  useEffect(() => {
    if (reduceMotion()) return undefined
    const demo = DEMOS[demoIndex]
    const done = stepCount >= demo.steps.length
    const timer = window.setTimeout(() => {
      if (done) {
        setDemoIndex((index) => (index + 1) % DEMOS.length)
        setStepCount(0)
      } else {
        setStepCount((count) => count + 1)
      }
    }, done ? 2600 : stepCount === 0 ? 900 : 700)
    return () => window.clearTimeout(timer)
  }, [demoIndex, stepCount])
  const demo = DEMOS[demoIndex]

  return (
    <Box sx={(theme) => ({
      mt: 2.5, p: 1.75, borderRadius: '14px',
      bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.35 : 0.62),
      border: `1px solid ${theme.palette.divider}`,
    })}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
        <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', letterSpacing: '0.04em' }}>示例</Typography>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {DEMOS.map((item, index) => (
            <Box key={item.ask} component="button" type="button" aria-label={`示例 ${index + 1}`}
              onClick={() => { setDemoIndex(index); setStepCount(reduceMotion() ? 4 : 0) }}
              sx={(theme) => ({
                width: index === demoIndex ? 14 : 6, height: 6, p: 0, border: 0, borderRadius: 99, cursor: 'pointer',
                bgcolor: index === demoIndex ? 'primary.main' : alpha(theme.palette.text.primary, 0.18),
                transition: 'width 220ms ease, background-color 220ms ease',
              })} />
          ))}
        </Box>
      </Box>
      {/* 用户的一句话 */}
      <Box key={`ask-${demoIndex}`} sx={(theme) => ({
        display: 'inline-block', maxWidth: '100%', px: 1.25, py: 0.625, borderRadius: '10px 10px 10px 3px',
        fontSize: 13.5, bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.1),
        animation: 'aiDemoIn 260ms ease',
        '@keyframes aiDemoIn': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'none' } },
      })}>
        {demo.ask}
      </Box>
      {/* Agent 的步骤：依次亮起 */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, mt: 1.25, minHeight: 28 }}>
        {demo.steps.map((step, index) => {
          const shown = index < stepCount
          const current = index === stepCount - 1 && stepCount < demo.steps.length
          return (
            <Box key={`${demoIndex}-${step}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              {index > 0 && (
                <EastRounded sx={{ fontSize: 14, color: 'text.disabled', opacity: shown ? 1 : 0.35, transition: 'opacity 200ms ease' }} />
              )}
              <Box sx={(theme) => ({
                display: 'flex', alignItems: 'center', gap: 0.625, height: 26, px: 1, borderRadius: '8px', fontSize: 12.5,
                color: shown ? 'text.primary' : 'text.disabled',
                bgcolor: shown ? theme.custom?.surface?.inset : 'transparent',
                border: `1px solid ${shown ? theme.palette.divider : 'transparent'}`,
                transition: 'color 220ms ease, background-color 220ms ease, border-color 220ms ease',
              })}>
                <Box sx={(theme) => ({
                  width: 6, height: 6, borderRadius: 99, flexShrink: 0,
                  bgcolor: shown ? (current ? 'primary.main' : 'success.main') : alpha(theme.palette.text.primary, 0.2),
                  animation: current ? 'aiDemoPulse 1s ease-in-out infinite' : 'none',
                  '@keyframes aiDemoPulse': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.3 } },
                })} />
                {step}
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

// ---------- 顶部主视觉 ----------

export function AgentHero({ enabled, ready, providerName, model, onToggle, onConfigure }) {
  const notesCount = useStore((state) => state.notes.filter((note) => !note.is_deleted).length)
  const conversationCount = useStore((state) => state.aiConversations.filter((conversation) => conversation.messages?.length).length)
  const [pendingTodos, setPendingTodos] = useState(null)
  useEffect(() => {
    fetchTodoStats().then((stats) => setPendingTodos(stats?.pending ?? null)).catch(() => {})
  }, [])

  const stats = [
    { value: notesCount, label: '篇笔记' },
    pendingTodos != null && { value: pendingTodos, label: '项待办' },
    { value: conversationCount, label: '段对话' },
  ].filter(Boolean)

  return (
    <Box sx={(theme) => {
      const dark = theme.palette.mode === 'dark'
      const primary = theme.palette.primary.main
      return {
        position: 'relative', overflow: 'hidden', borderRadius: '18px', p: { xs: 2.5, md: 3 }, mb: 3,
        bgcolor: theme.custom?.surface?.inset,
        border: `1px solid ${theme.palette.divider}`,
        isolation: 'isolate',
        // 缓慢流动的主题色光晕：只在主视觉里出现，其余部分保持安静
        '&::before': {
          content: '""', position: 'absolute', inset: '-40%', zIndex: -1, pointerEvents: 'none',
          background: [
            `radial-gradient(closest-side at 72% 38%, ${alpha(primary, dark ? 0.32 : 0.22)}, transparent)`,
            `radial-gradient(closest-side at 22% 78%, ${alpha(primary, dark ? 0.18 : 0.12)}, transparent)`,
            `radial-gradient(closest-side at 88% 88%, ${alpha(theme.palette.secondary.main, dark ? 0.14 : 0.1)}, transparent)`,
          ].join(', '),
          animation: 'aiHeroDrift 16s ease-in-out infinite alternate',
          '@keyframes aiHeroDrift': {
            from: { transform: 'translate3d(-3%, -2%, 0) rotate(0deg)' },
            to: { transform: 'translate3d(3%, 2%, 0) rotate(8deg)' },
          },
        },
        '@media (prefers-reduced-motion: reduce)': { '&::before': { animation: 'none' } },
      }
    }}>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.14em', color: 'primary.main' }}>FLOTA AGENT</Typography>
          <Typography component="h2" sx={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2, mt: 0.5 }}>
            FlotaAI
          </Typography>
          <Typography sx={{ fontSize: 14.5, color: 'text.secondary', mt: 0.75, maxWidth: 460, lineHeight: 1.65 }}>
            住在你笔记里的 Agent。会读、会写、会画，还会给自己做工具——每一处改动都先问过你。
          </Typography>

          {/* 连接状态 + 总开关 */}
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.25, mt: 2 }}>
            <Box sx={(theme) => ({
              display: 'flex', alignItems: 'center', gap: 0.75, height: 30, pl: 1.25, pr: 1.5, borderRadius: '10px', fontSize: 13,
              bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.35 : 0.7),
              border: `1px solid ${theme.palette.divider}`,
            })}>
              <Box sx={{
                width: 8, height: 8, borderRadius: 99,
                bgcolor: !enabled ? 'text.disabled' : ready ? 'success.main' : 'warning.main',
                boxShadow: (theme) => (enabled && ready ? `0 0 0 3px ${alpha(theme.palette.success.main, 0.18)}` : 'none'),
              }} />
              {!enabled ? '已关闭' : ready ? `${providerName || '模型'} · ${model || '未选择模型'}` : '还没配置模型'}
            </Box>
            {enabled && !ready && (
              <Button size="small" variant="contained" onClick={onConfigure} sx={{ height: 30 }}>配置模型</Button>
            )}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, pl: 0.5 }}>
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>启用</Typography>
              <Switch checked={enabled} onChange={(event) => onToggle(event.target.checked)} inputProps={{ 'aria-label': '启用 AI' }} />
            </Box>
          </Box>

          {/* 它能看到的东西：真实数据 */}
          <Box sx={{ display: 'flex', gap: 3, mt: 2.25 }}>
            {stats.map((stat) => (
              <Box key={stat.label}>
                <Typography component="span" sx={{ fontSize: 22, fontWeight: 650, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{stat.value}</Typography>
                <Typography component="span" sx={{ fontSize: 12.5, color: 'text.secondary', ml: 0.5 }}>{stat.label}</Typography>
              </Box>
            ))}
          </Box>
        </Box>

        {/* 可互动的 AI 球：鼠标靠近会被吸引 */}
        <Box aria-hidden sx={{ position: 'relative', width: 180, height: 180, flexShrink: 0, display: { xs: 'none', md: 'block' }, mt: -1, mr: -1 }}>
          <FlotaAIOrb sx={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%) scale(0.78)', transformOrigin: 'center' }} />
        </Box>
      </Box>

      <AgentDemo />
    </Box>
  )
}

// ---------- 能力卡片 ----------

const CAPABILITIES = [
  {
    id: 'writing',
    wide: true,
    icon: AutoStoriesRounded,
    title: '长文写作',
    desc: '小说、PRD、调研报告都行。先规划大纲，再一章一章写，每章都带着前文摘要，几万字也前后连贯。',
    chips: ['小说', 'PRD', '调研报告', '方案', '复盘', '教程', '架构设计'],
    pipeline: ['规划大纲', '分章写作', '滚动摘要', '合并成稿'],
    prompt: '帮我写一篇短篇小说：在一座会下雨的图书馆里，管理员每天整理读者遗落的记忆。约 8000 字，分章节，存成一篇新笔记。',
  },
  {
    id: 'whiteboard',
    icon: AccountTreeRounded,
    title: '画画布',
    desc: '一句话画出思维导图、流程图、架构图，也能基于当前笔记画，或改一张已有的画布。',
    chips: ['思维导图', '流程图', '架构图', '时序图', 'SVG 插画'],
    prompt: '帮我在一张新画布里画一张思维导图：如何在一个月内读完并吸收一本书。',
  },
  {
    id: 'widget',
    icon: WidgetsRounded,
    title: '给自己做工具',
    desc: '需要看板、闪卡、打卡或记账？说出来，它会写代码、在沙箱里试运行、出错自己修。',
    pipeline: ['生成', '试运行', '自动修复'],
    prompt: '帮我做一个组件：读书打卡，记录每天读了多少页，显示本月的连续天数。',
  },
  {
    id: 'notes',
    icon: TravelExploreRounded,
    title: '整理笔记',
    desc: '搜索、读完一篇很长的笔记、改写段落，或一次给一批笔记补标题和标签。',
    chips: ['搜索', '长文阅读', '改写', '批量打标签'],
    prompt: '帮我找出最近一周写的笔记，概括每篇的要点，并给没有标签的笔记补上合适的标签。',
  },
  {
    id: 'todos',
    icon: ChecklistRounded,
    title: '规划待办',
    desc: '读取今天和逾期的待办，按重要紧急排好顺序；也能把一个大目标拆成一串待办。',
    prompt: '读取我今天和已经逾期的待办，帮我排一个今天的执行顺序。',
  },
  {
    id: 'memory',
    icon: PsychologyRounded,
    title: '长期记忆',
    desc: '记住你的偏好、背景和正在做的事，下次不用再解释一遍。',
    prompt: '记住：我更喜欢简洁的要点式回答，除非我要求展开。',
    link: { label: '管理记忆', settingsTab: 5 },
  },
  {
    id: 'web',
    icon: PublicRounded,
    title: '联网搜索',
    desc: '需要最新信息时自己上网查，长文写作也会用它找资料。',
    toggle: 'webSearchEnabled',
    prompt: '搜索最近一周 AI 领域的重要新闻，整理成一篇笔记。',
    link: { label: '配置搜索服务', anchor: 'ai-settings-web' },
  },
  {
    id: 'vision',
    icon: ImageSearchRounded,
    title: '看懂图片',
    desc: '读笔记里的截图和照片，也可以直接把图片拖进对话框。需要模型支持视觉。',
    toggle: 'visionEnabled',
    prompt: '看看当前笔记里的图片，告诉我它们讲了什么。',
  },
]

const openSettingsTab = (tab) => {
  const state = useStore.getState()
  state.setSettingsTabValue(tab)
  state.setCurrentView('settings')
}

function CapabilityCard({ capability, ready, toggles, onToggle }) {
  const Icon = capability.icon
  const toggledOn = capability.toggle ? Boolean(toggles[capability.toggle]) : true
  const canTry = ready && toggledOn
  return (
    <Box sx={(theme) => ({
      gridColumn: capability.wide ? { xs: 'auto', md: 'span 2' } : 'auto',
      display: 'flex', flexDirection: 'column', gap: 1, p: '16px 18px', borderRadius: '14px',
      bgcolor: theme.custom?.surface?.inset,
      transition: 'background-color 150ms ease',
      '&:hover': { bgcolor: theme.custom?.surface?.insetHover },
      '&:hover .ai-cap-try': { opacity: 1 },
    })}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <Box sx={(theme) => ({
          width: 32, height: 32, borderRadius: '9px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: toggledOn ? 'primary.main' : 'text.disabled',
          bgcolor: alpha(toggledOn ? theme.palette.primary.main : theme.palette.text.primary, toggledOn ? 0.12 : 0.06),
        })}>
          <Icon sx={{ fontSize: 18 }} />
        </Box>
        <Typography sx={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 650 }}>{capability.title}</Typography>
        {capability.toggle && (
          <Switch checked={toggledOn} onChange={(event) => onToggle(capability.toggle, event.target.checked)}
            inputProps={{ 'aria-label': `启用${capability.title}` }} />
        )}
      </Box>

      <Typography sx={{ fontSize: 13, color: 'text.secondary', lineHeight: 1.65 }}>{capability.desc}</Typography>

      {capability.pipeline && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}>
          {capability.pipeline.map((step, index) => (
            <Box key={step} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {index > 0 && <EastRounded sx={{ fontSize: 13, color: 'text.disabled' }} />}
              <Typography sx={(theme) => ({
                fontSize: 12, fontWeight: 600, px: 0.875, py: 0.25, borderRadius: '6px', color: 'primary.main',
                bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.08),
              })}>{step}</Typography>
            </Box>
          ))}
        </Box>
      )}
      {capability.chips && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {capability.chips.map((chip) => (
            <Typography key={chip} sx={(theme) => ({
              fontSize: 12, px: 0.875, py: 0.25, borderRadius: '6px', color: 'text.secondary',
              bgcolor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.07 : 0.05),
            })}>{chip}</Typography>
          ))}
        </Box>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 'auto', pt: 0.5 }}>
        <Tooltip title={!ready ? '先配置模型' : !toggledOn ? '先打开右上角的开关' : '把示例问题填进 AI 小窗，你可以先改一改再发送'}>
          <span>
            <Button className="ai-cap-try" size="small" endIcon={<EastRounded sx={{ fontSize: '16px !important' }} />} disabled={!canTry}
              onClick={() => askAI(capability.prompt)}
              sx={{ ml: -1, opacity: { xs: 1, md: 0.72 }, transition: 'opacity 150ms ease' }}>
              试一试
            </Button>
          </span>
        </Tooltip>
        {capability.link && (
          <Button size="small" color="inherit" sx={{ color: 'text.secondary' }}
            onClick={() => (capability.link.anchor
              ? document.getElementById(capability.link.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              : openSettingsTab(capability.link.settingsTab))}>
            {capability.link.label}
          </Button>
        )}
      </Box>
    </Box>
  )
}

export function CapabilityGrid({ ready, toggles, onToggle }) {
  const list = useMemo(() => CAPABILITIES, [])
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, px: 1, mb: 1.5 }}>
        <Typography variant="h6" sx={{ fontSize: 16, fontWeight: 650 }}>它能做什么</Typography>
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>在 AI 小窗和 AI 页面里都能用 · 新建和修改之前都会先给你确认</Typography>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 1.5 }}>
        {list.map((capability) => (
          <CapabilityCard key={capability.id} capability={capability} ready={ready} toggles={toggles} onToggle={onToggle} />
        ))}
      </Box>
    </Box>
  )
}
