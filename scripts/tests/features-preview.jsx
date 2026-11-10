import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Box, Button, Chip, CssBaseline, Paper, TextField, ThemeProvider, Typography, useTheme } from '@mui/material'
import { createAppTheme } from '../../src/styles/theme'
import CloudBackupSettings from '../../src/components/sync/CloudBackupSettings'
import STTSettings from '../../src/components/settings/STTSettings'
import NoteHistoryDialog from '../../src/components/editor/NoteHistoryDialog'
import { TEXTURE_STYLES, getPatternBackgroundStyle, generatePatternCSS } from '../../src/utils/patternStyles'
import TitleBarAIButton from '../../src/components/layout/TitleBarAIButton'
import OnboardingTour from '../../src/components/common/OnboardingTour'
import { usePrefsStore } from '../../src/store/usePrefsStore'
import PendingActionCard from '../../src/components/ai/PendingActionCard'
import { runPendingAction } from '../../src/utils/aiCore/pendingActionExecutor'
import SettingsSearch from '../../src/components/settings/SettingsSearch'
import QuickPromptShortcuts from '../../src/components/ai/QuickPromptShortcuts'
import { GENERAL_AI_QUICK_PROMPTS } from '../../src/utils/aiQuickPrompts'
import AICapabilityTicker from '../../src/components/ai/AICapabilityTicker'
import { CHRISTMAS_ART } from '../../src/assets/christmas'
import ChristmasDecorations from '../../src/components/common/ChristmasSnow'
import ShortcutInput from '../../src/components/common/ShortcutInput'
import FilterChip from '../../src/components/filters/FilterChip'
import SecondarySidebar from '../../src/components/layout/SecondarySidebar'
import { useStore } from '../../src/store/useStore'
import { ErrorProvider } from '../../src/components/common/ErrorProvider'

function ShortcutPreview() {
  const [value, setValue] = useState('Ctrl+N')
  return <Box sx={{ display: 'grid', gap: 2.5 }}>
    {[['全局', ['新建笔记', '快速输入', '新建待办']], ['面板与导航', ['切换问 AI 窗口', '命令面板']]].map(([title, names]) => <Box key={title} sx={{ border: 1, borderColor: 'divider', borderRadius: '16px', overflow: 'hidden' }}>
      <Box sx={{ px: 2, py: 1.25, bgcolor: 'action.hover', display: 'flex', justifyContent: 'space-between' }}><Typography fontSize={13} fontWeight={700}>{title}</Typography><Typography variant="caption" color="text.disabled">{names.length}</Typography></Box>
      {names.map((name, i) => <Box key={name} sx={{ px: 2, py: 1.1, borderTop: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}><Typography fontSize={13}>{name}</Typography><ShortcutInput label={name} value={i === 0 ? value : i === 1 ? 'Ctrl+Shift+N' : ''} defaultValue="Ctrl+N" onChange={setValue} /></Box>)}
    </Box>)}
  </Box>
}

function CapabilityPreview() {
  const [draft, setDraft] = useState('')
  return <Box sx={{ maxWidth: 640, mx: 'auto' }}>
    <Typography variant="h5" fontWeight={700} sx={{ mb: 1 }}>你好，我是 FlotaAI</Typography>
    <AICapabilityTicker paused={Boolean(window.captureCapabilityPause)} onSelect={setDraft} />
    <TextField fullWidth multiline minRows={3} value={draft} placeholder="选个示例，改好再发送…" onChange={event => setDraft(event.target.value)} inputProps={{ 'aria-label': '能力示例草稿' }} sx={{ mt: 2 }} />
    <Box sx={{ mt: 2 }}><QuickPromptShortcuts defaults={GENERAL_AI_QUICK_PROMPTS} onSelect={setDraft} /></Box>
  </Box>
}

function AISettingsPreview() {
  const [action, setAction] = useState({ actionId: 'settings-preview', name: 'update_settings', summary: '主题 → 深色；显示阅读时长 → 关闭', args: { changes: [{ key: 'theme', value: 'dark' }, { key: 'editorShowReadingTime', value: false }] } })
  const readingTime = usePrefsStore(state => state.editorShowReadingTime)
  return <Box sx={{ maxWidth: 440, mx: 'auto', py: 2 }}>
    <Typography sx={{ fontSize: 13, mb: 2 }}>帮我改成深色主题，隐藏阅读时长。</Typography>
    <PendingActionCard action={action} onDismiss={() => setAction({ ...action, status: 'dismissed' })} onExecute={async () => {
      const result = await runPendingAction({ action })
      setAction({ ...action, status: result.success ? 'done' : 'failed', resultMessage: result.message, error: result.error })
    }} />
    <Typography data-settings-applied sx={{ fontSize: 12, color: 'text.secondary', mt: 2 }}>阅读时长：{readingTime ? '显示' : '隐藏'}</Typography>
  </Box>
}

function SettingsSearchPreview() {
  const [selected, setSelected] = useState(null)
  return <Box sx={{ minHeight: 460 }}>
    <SettingsSearch onNavigate={setSelected} />
    <Typography sx={{ mt: 4, fontSize: 13 }} data-search-selection>{selected ? `${selected.tab} / ${selected.label}` : '搜索功能名称或关键词'}</Typography>
  </Box>
}

function PatternPreview() {
  const [selected, setSelected] = useState('leather')
  const theme = useTheme()
  return <Box>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 1.5 }}>
      {Object.entries(TEXTURE_STYLES).map(([id, pattern]) => <Box component="button" key={id} onClick={() => setSelected(id)} aria-pressed={selected === id} sx={{ p: 0, border: '1px solid', borderColor: selected === id ? 'primary.main' : 'divider', borderRadius: '14px', bgcolor: 'background.paper', color: 'text.primary', overflow: 'hidden', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
        <Box data-pattern={id} style={getPatternBackgroundStyle(id, '#398273', 1, theme.palette.mode)} sx={{ height: 110 }} />
        <Box sx={{ p: 1.25, fontSize: 12, fontWeight: 600 }}>{pattern.name}</Box>
      </Box>)}
    </Box>
    <Box style={getPatternBackgroundStyle(selected, '#398273', 1, theme.palette.mode)} sx={{ mt: 3, p: 3, borderRadius: '16px', border: 1, borderColor: 'divider', bgcolor: 'background.default', minHeight: 210 }}>
      <Paper elevation={0} sx={{ p: 2.5, maxWidth: 360, borderRadius: '14px', bgcolor: theme => theme.palette.mode === 'dark' ? 'rgba(30,31,33,.82)' : 'rgba(255,255,255,.82)', backdropFilter: 'blur(12px)' }}><Typography variant="overline" color="text.secondary">FLOTA / NOTES</Typography><Typography fontWeight={700} sx={{ my: 1 }}>给思绪留一点空白</Typography><Typography variant="body2" color="text.secondary">温润的皮革，细腻的金属。让材质陪伴阅读。</Typography></Paper>
    </Box>
  </Box>
}

const root = createRoot(document.getElementById('root'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const waitFor = async fn => { for (let i = 0; i < 100; i++) { if (fn()) return; await sleep(30) } throw new Error('UI timeout') }
const assert = (value, text) => { if (!value) throw new Error(text) }
const button = text => [...document.querySelectorAll('button')].find(node => node.textContent.includes(text))
let noteId, restored, serial = 0
let config = { enabled: true, provider: 'offline', language: 'auto', offline: { ready: true }, volcAppId: '', volcToken: '', volcResourceId: '' }
const targets = [
  { id: 'one', name: '家里的 NAS', baseUrl: 'https://nas.example.com/dav', rootPath: '/Flota-backups/', username: 'me', auto: true, hasPassword: true, lastSuccess: Date.now(), lastFile: 'backup.zip' },
  { id: 'two', name: '坚果云 · 第二份副本', baseUrl: 'https://dav.jianguoyun.com/dav', rootPath: '/Flota-backups/', username: 'me', auto: false, hasPassword: true },
]
window.electronAPI = {
  notes: { versions: id => window.acceptanceStorage.versions(id), version: (id, version) => window.acceptanceStorage.version(id, version), restoreVersion: (id, version, revision) => window.acceptanceStorage.restoreVersion(id, version, revision) },
  stt: { getConfig: async () => ({ success: true, data: config }), saveConfig: async next => { config = next; return { success: true } }, onModelProgress: () => () => {}, prepareOffline: async () => { config = { ...config, offline: { ready: true } }; return { success: true } } },
  backup: { cloudConfig: async () => ({ success: true, data: { targets, busy: false } }),
    runCloud: async () => ({ success: false, error: '部分网盘备份未完成，家里的 NAS 已备份成功。' }),
    saveCloud: async draft => { targets.push({ ...draft, id: 'new' }); return { success: true, data: { targets: [...targets] } } },
    removeCloud: async () => ({ success: true }), downloadCloud: async () => ({ success: true }) },
}
window.showFeature = async (view = 'cloud', mode = 'light') => {
  serial++
  if (view === 'timeline') useStore.setState({ currentView: 'timeline', notes: Array.from({ length: 24 }, (_, i) => ({ id: i, tags: ['字节学习', '时间轴', '需求', '欢迎', '教程', '2.3', 'nus 准备', 'Agent', '网络错误'].slice(i % 9, i % 9 + 3) })) })
  root.render(<ThemeProvider theme={createAppTheme(mode)}><CssBaseline /><ErrorProvider>
    <Box sx={{ minHeight: '100vh', p: { xs: 2, sm: 4 }, background: mode === 'dark' ? 'radial-gradient(at 20% 10%, #202933, #161618 70%)' : 'radial-gradient(at 20% 10%, #e9eef4, #f4f4f2 70%)' }}>
      <Box sx={{ maxWidth: 1000, mx: 'auto' }}><Typography variant="caption" color="text.secondary">FLOTA / 设置</Typography><Typography variant="h5" fontWeight={650} sx={{ mt: 1, mb: 3 }}>{{ 'ai-capabilities': 'AI 可以做什么', 'christmas-art': '圣诞美术素材', onboarding: '初次见面', patterns: '材质纹理', cloud: '同步与备份', offline: '语音转文字', history: '笔记 · 历史版本', christmas: '圣诞模式', timeline: '时间轴筛选', choices: '选项样式', shortcuts: '快捷键' }[view]}</Typography>
        <Paper elevation={0} sx={{ borderRadius: 4, p: { xs: 2, sm: 3 }, border: 1, borderColor: 'divider', bgcolor: mode === 'dark' ? 'rgba(31,31,34,.65)' : 'rgba(255,255,255,.72)' }}>
          {view === 'ai-settings' ? <AISettingsPreview key={serial} /> : view === 'ai-capabilities' ? <CapabilityPreview /> : view === 'christmas-art' ? <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
            {Object.entries({ garland: '松枝彩灯', gifts: '圣诞礼物', snowman: '读书雪人', sleigh: '驯鹿雪橇', wreath: '花环铜铃', tree: '圣诞树' }).map(([id, name]) => <Box key={id} sx={{ border: 1, borderColor: 'divider', borderRadius: '16px', p: 1.5, textAlign: 'center', background: 'radial-gradient(ellipse, rgba(223,199,139,.08), transparent 75%)' }}><Box component="img" src={CHRISTMAS_ART[id]} alt={name} sx={{ display: 'block', width: '100%', height: 170, objectFit: 'contain' }} /><Typography variant="caption" color="text.secondary">{name}</Typography></Box>)}
          </Box> : view === 'onboarding' ? <Box sx={{ minHeight: 470, display: 'flex', gap: 3 }}>
            <Box sx={{ position: 'fixed', top: 20, right: 28 }}><TitleBarAIButton /></Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, width: 40 }}>{[['notes','笔记'],['todo','待办'],['calendar','日历'],['timeline','时间轴'],['ai','AI'],['settings','设置']].map(([id, label]) => <Button key={id} data-tour={id} sx={{ minWidth: 36, width: 36, height: 36, fontSize: 10, p: 0, bgcolor: 'action.hover' }}>{label}</Button>)}</Box>
            <Box sx={{ pt: 2 }}><Typography variant="h5" fontWeight={700}>记录，从这里开始。</Typography><Typography color="text.secondary" sx={{ mt: 2 }}>笔记 · 待办 · 日历 · 时间轴</Typography></Box>
          </Box> : view === 'settings-search' ? <SettingsSearchPreview key={serial} /> : view === 'patterns' ? <PatternPreview /> : view === 'christmas' ? <Box sx={{ minHeight: 390, p: 2 }}><Typography variant="overline" color="text.secondary">WINTER NOTES / 01</Typography><Typography variant="h4" fontWeight={700} sx={{ my: 2 }}>把冬天的小事记下来</Typography><Typography color="text.secondary" sx={{ lineHeight: 2, mb: 4 }}>一杯热饮，一首喜欢的歌，和一个突然冒出来的灵感。</Typography><Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}><Button variant="contained">新建一篇笔记</Button><Button onClick={() => window.dispatchEvent(new Event('flota:christmas-celebrate'))}>完成今日心愿</Button></Box></Box> : view === 'shortcuts' ? <ShortcutPreview key={serial} /> : view === 'choices' ? <Box sx={{ display: 'grid', gap: 3 }}>
            {[{ title: '快照最小间隔', values: ['30 秒', '1 分钟', '5 分钟', '10 分钟'] }, { title: '每篇保留版本', values: ['20 份', '50 份', '100 份', '200 份'] }].map(group => <Box key={group.title}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{group.title}</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>{group.values.map((label, i) => <Chip key={label} label={label} size="small" variant={i === 1 ? 'filled' : 'outlined'} color={i === 1 ? 'primary' : 'default'} onClick={() => {}} />)}</Box>
            </Box>)}
            <Box><Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>筛选</Typography><Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>{['今天', '7 天内', '30 天内'].map((label, i) => <FilterChip key={label} label={label} isSelected={i === 1} />)}</Box></Box>
          </Box> : view === 'timeline' ? <Box sx={{ height: 'calc(100vh - 190px)', minHeight: 320 }}><SecondarySidebar open /></Box> : view === 'cloud' ? <CloudBackupSettings key={serial} /> : view === 'offline' ? <STTSettings key={serial} showSnackbar={() => {}} /> : <Typography color="text.secondary">每次编辑都留下可以回来的路。</Typography>}
        </Paper>
      </Box>
      {view === 'christmas' && <ChristmasDecorations />}
      {view === 'onboarding' && <OnboardingTour ready={window.onboardingReady !== false} />}
      {view === 'history' && <NoteHistoryDialog key={serial} noteId={noteId} onClose={() => window.showFeature('cloud', mode)} onRestored={note => { restored = note }} />}
    </Box>
  </ErrorProvider></ThemeProvider>)
  await sleep(120)
}
window.runEditorTests = async () => {
  const results = []
  const test = async (name, run) => { try { await run(); results.push({ name, ok: true }) } catch (e) { results.push({ name, ok: false, error: e.message }) } }
  const created = await window.acceptanceStorage.createNote('# 一次产品复盘\n\n## 做得好的\n\n- 笔记可以安心找回\n- 录音在本机转文字\n\n> 让工具安静地帮忙。')
  noteId = created.data.id
  await window.acceptanceStorage.updateNote(noteId, '现在的正文，恢复前应保留。')
  await test('历史版本真实 SQLite 预览、恢复，并保留恢复前版本', async () => {
    await window.showFeature('history')
    await waitFor(() => button('恢复此版本') && !button('恢复此版本').disabled)
    assert(document.body.textContent.includes('一次产品复盘'), 'missing history preview')
    button('恢复此版本').click()
    await waitFor(() => restored)
    assert(restored.content.includes('一次产品复盘'), 'restore did not apply snapshot')
    const listed = await window.acceptanceStorage.versions(noteId)
    assert(listed.data.versions.length === 2, 'current version not saved before restore')
  })
  await test('离线模型准备与云端服务切换', async () => {
    config.offline.ready = false
    await window.showFeature('offline')
    await waitFor(() => button('下载离线模型'))
    button('下载离线模型').click()
    await waitFor(() => document.body.textContent.includes('模型已就绪'))
    button('云端识别').click()
    await waitFor(() => document.body.textContent.includes('App ID'))
    assert(config.provider === 'volcengine', 'provider not saved')
    button('本机离线').click()
    await waitFor(() => button('检查模型'))
  })
  await test('多网盘部分失败反馈与连接表单', async () => {
    await window.showFeature('cloud')
    await waitFor(() => button('备份到所有网盘'))
    button('备份到所有网盘').click()
    await waitFor(() => document.body.textContent.includes('部分网盘备份未完成'))
    button('添加网盘').click()
    await waitFor(() => document.querySelector('[role="dialog"]'))
    assert(document.querySelectorAll('[role="dialog"] input').length >= 5, 'missing backup fields')
    button('取消').click()
  })
  await test('快捷键录制、取消、清除和恢复默认', async () => {
    await window.showFeature('shortcuts')
    const field = () => document.querySelector('button[aria-label^="新建笔记："]')
    await waitFor(field)
    field().click()
    await waitFor(() => field().getAttribute('aria-pressed') === 'true')
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await waitFor(() => field().getAttribute('aria-pressed') === 'false')
    assert(field().textContent.includes('N'), 'cancel changed shortcut')
    field().click()
    await waitFor(() => field().getAttribute('aria-pressed') === 'true')
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'L', ctrlKey: true, bubbles: true, cancelable: true }))
    await waitFor(() => field().textContent.includes('L'))
    document.querySelector('button[aria-label="清除新建笔记"]').click()
    await waitFor(() => field().textContent.includes('设置快捷键'))
    assert(!document.body.textContent.includes('快捷键不能为空'), 'empty shortcut shows invalid error')
    document.querySelector('button[aria-label="恢复新建笔记默认值"]').click()
    await waitFor(() => field().textContent.includes('N'))
  })
  await test('圣诞彩蛋只在使用里出现、自动收起且关闭清理', async () => {
    await window.showFeature('christmas')
    assert(document.documentElement.dataset.flotaChristmas === 'true', 'missing festive theme')
    assert(!document.querySelector('[data-christmas-gift]'), 'persistent gift entry remains')
    assert(!document.querySelector('[data-christmas-surprise]'), 'surprise appeared without using app')
    button('新建一篇笔记').click()
    await sleep(100)
    assert(!document.querySelector('[data-christmas-burst]'), 'ordinary clicks trigger fireworks')
    for (let i = 0; i < 2; i++) window.dispatchEvent(new CustomEvent('flota:christmas-celebrate', { detail: { kind: 'todo' } }))
    await sleep(30)
    assert(!document.querySelector('[data-christmas-surprise]'), 'surprise appears too often')
    window.dispatchEvent(new CustomEvent('flota:christmas-celebrate', { detail: { kind: 'todo' } }))
    await waitFor(() => document.querySelector('[data-christmas-surprise="sleigh"]'))
    await document.querySelector('[data-christmas-surprise]').decode()
    assert(getComputedStyle(document.querySelector('[data-christmas-layer]')).pointerEvents === 'none', 'surprise intercepts input')
    await window.showFeature('cloud')
    assert(!document.querySelector('[data-christmas-layer]') && !document.documentElement.dataset.flotaChristmas, 'festive overlay survives close')
    await window.showFeature('christmas')
    for (let i = 0; i < 3; i++) window.dispatchEvent(new CustomEvent('flota:christmas-celebrate', { detail: { kind: 'note' } }))
    await waitFor(() => document.querySelector('[data-christmas-surprise="tree"]'))
    await sleep(3700)
    assert(!document.querySelector('[data-christmas-surprise]'), 'surprise does not hide automatically')
    await window.showFeature('cloud')
    window.dispatchEvent(new Event('flota:christmas-celebrate'))
    assert(!document.querySelector('[data-christmas-burst]'), 'listener survives close')
  })
  await test('材质纹理 CSS 有效，实际背景与预览同步使用主题色和强度', async () => {
    await window.showFeature('patterns')
    assert(generatePatternCSS('grid', '#398273', 1) === generatePatternCSS('steel', '#398273', 1), 'legacy texture mapping failed')
    assert(getPatternBackgroundStyle('leather', '#398273', 1, 'light').backgroundColor !== getPatternBackgroundStyle('leather', '#398273', 1, 'dark').backgroundColor, 'dark material palette missing')
    for (const id of Object.keys(TEXTURE_STYLES)) {
      const style = getPatternBackgroundStyle(id, '#398273', 1)
      assert(CSS.supports('background-image', style.backgroundImage), `${id} has invalid gradient`)
      const image = getComputedStyle(document.querySelector(`[data-pattern="${id}"]`)).backgroundImage
      assert(image !== 'none', `${id} preview missing`)
      assert(image.includes('57, 130, 115'), `${id} preview ignores theme color`)
      const css = generatePatternCSS(id, '#398273', 2)
      assert(css.includes('rgba(57, 130, 115,'), `${id} actual background ignores theme color`)
      assert(css !== generatePatternCSS(id, '#398273', 1), `${id} strength has no effect`)
    }
  })
  await test('首次引导等待就绪、定位入口、完成记忆、重看和 Esc 跳过', async () => {
    usePrefsStore.getState().setPref('onboardingSeen', false)
    window.onboardingReady = false
    await window.showFeature('onboarding')
    await sleep(800)
    assert(!document.querySelector('[data-onboarding-tour]'), 'tour opened before app ready')
    window.onboardingReady = true
    await window.showFeature('onboarding')
    await waitFor(() => button('带我看看'))
    button('带我看看').click()
    await waitFor(() => document.querySelector('[data-onboarding-highlight]'))
    assert(document.getElementById('flota-tour-title').textContent.includes('灵感'), 'notes step missing')
    button('上一步').click()
    await waitFor(() => button('带我看看'))
    button('带我看看').click()
    await waitFor(() => button('下一步'))
    for (let i = 0; i < 4; i++) { button('下一步').click(); await sleep(40) }
    assert(document.getElementById('flota-tour-title').textContent.includes('右上角'), 'quick AI step missing')
    const aiTarget = document.querySelector('[data-tour="ai-quick"]').getBoundingClientRect()
    const highlight = document.querySelector('[data-onboarding-highlight]').getBoundingClientRect()
    assert(Math.abs(highlight.right - aiTarget.right) < 16, 'quick AI entry not highlighted')
    assert(document.querySelector('[data-onboarding-card]').getBoundingClientRect().right < aiTarget.left, 'AI card should sit left of target')
    for (let i = 0; i < 2; i++) { button('下一步').click(); await sleep(40) }
    assert(document.querySelector('[data-onboarding-card]').textContent.includes('画布 AI'), 'canvas AI introduction missing')
    assert(['流程图', '思维导图', '架构图', '文字成图', '局部改图', '读图总结'].every(text => document.querySelector('[data-onboarding-card]').textContent.includes(text)), 'canvas abilities missing')
    button('下一步').click()
    await sleep(50)
    assert(['隐藏模式', '离线语音', '历史版本', '多网盘备份'].every(text => document.querySelector('[data-onboarding-card]').textContent.includes(text)), 'feature list incomplete')
    button('下一步').click()
    await waitFor(() => button('开始使用'))
    button('开始使用').click()
    await waitFor(() => !document.querySelector('[data-onboarding-tour]'))
    assert(JSON.parse(localStorage.getItem('Flota-prefs')).state.onboardingSeen, 'completion not persisted')
    await window.showFeature('cloud')
    await window.showFeature('onboarding')
    await sleep(800)
    assert(!document.querySelector('[data-onboarding-tour]'), 'completed tour automatically opened again')
    window.dispatchEvent(new Event('flota:show-onboarding'))
    await waitFor(() => button('带我看看'))
    document.querySelector('[data-onboarding-tour]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await waitFor(() => !document.querySelector('[data-onboarding-tour]'))
    assert(usePrefsStore.getState().onboardingSeen, 'skip not remembered')
  })
  await test('AI 轮播自动切换、预填正常，无额外能力按钮', async () => {
    window.captureCapabilityPause = false
    await window.showFeature('ai-capabilities')
    const current = () => document.querySelector('[data-ai-capability-ticker] button')
    await waitFor(() => current()?.getAttribute('aria-label').includes('写长文'))
    current().focus()
    current().dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await sleep(3300)
    await waitFor(() => current().getAttribute('aria-label').includes('长期记忆'))
    current().click()
    await waitFor(() => document.querySelector('[aria-label="能力示例草稿"]').value.includes('先检查是否已开启'))
    await waitFor(() => current().getAttribute('aria-label').includes('画画布'))
    await waitFor(() => current().getAttribute('aria-label').includes('规划待办'))
    assert(!document.querySelector('[aria-label="切换 AI 能力示例"]'), 'manual switch still visible')
    assert(!document.querySelector('[aria-label="查看全部 AI 能力"]'), 'capability menu still visible')

  })
  await test('AI 设置确认卡：确认前不修改，确认后持久化并即时应用', async () => {
    const previousTheme = useStore.getState().theme
    const previousReading = usePrefsStore.getState().editorShowReadingTime
    const previousAI = window.electronAPI.ai
    const previousSettings = window.electronAPI.settings
    const writes = []
    window.electronAPI.settings = { setMultiple: async changes => { writes.push(changes); return { success: true } } }
    window.electronAPI.ai = { executePendingAction: async () => ({ success: true, result: { settingsChanges: [{ key: 'theme', value: 'dark' }, { key: 'editorShowReadingTime', value: false }], message: '已应用：深色主题，隐藏阅读时长' } }) }
    try {
      useStore.getState().setTheme('light')
      usePrefsStore.getState().setPref('editorShowReadingTime', true)
      await window.showFeature('ai-settings')
      assert(useStore.getState().theme === 'light' && writes.length === 0, 'settings applied before confirmation')
      button('确认').click()
      await waitFor(() => document.querySelector('[data-settings-applied]').textContent.includes('隐藏'))
      assert(useStore.getState().theme === 'dark', 'theme did not update')
      assert(writes[0].theme === 'dark', 'theme not persisted')
      assert(JSON.parse(localStorage.getItem('Flota-prefs')).state.editorShowReadingTime === false, 'reading preference not persisted')
      await waitFor(() => document.body.textContent.includes('已应用：深色主题'))
    } finally {
      useStore.getState().setTheme(previousTheme)
      usePrefsStore.getState().setPref('editorShowReadingTime', previousReading)
      window.electronAPI.ai = previousAI
      window.electronAPI.settings = previousSettings
    }
  })

  await test('设置搜索支持关键词、键盘跳转、清空和无结果反馈', async () => {
    await window.showFeature('settings-search')
    const input = document.querySelector('[aria-label="搜索设置"]')
    const fill = value => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    input.focus()
    fill('历史版本')
    await waitFor(() => document.querySelector('[role="option"]'))
    assert(document.querySelector('[role="listbox"]').textContent.includes('自动保存历史快照'), 'history setting not found')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await waitFor(() => document.querySelector('[data-search-selection]').textContent.includes('10 /'))
    assert(!document.querySelector('[role="listbox"]'), 'results did not close after selection')
    input.blur()
    input.focus()
    fill('不存在的设置xyz123')
    await waitFor(() => document.querySelector('[role="listbox"]')?.textContent.includes('没有找到'))
    document.querySelector('[aria-label="清空设置搜索"]').click()
    await waitFor(() => input.value === '')
    assert(!document.querySelector('[role="listbox"]'), 'clear did not hide results')
  })

  await test('Prompt 快捷方式新增、编辑、预填、删除、恢复与本地持久化', async () => {
    const previous = usePrefsStore.getState().aiQuickPromptSets
    usePrefsStore.getState().setPref('aiQuickPromptSets', { canvas: [{ id: 'keep', label: '保留画布', prompt: 'test' }] })
    const fill = (node, value) => {
      const prototype = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value)
      node.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const dialogButton = text => [...document.querySelectorAll('[aria-label="快捷方式编辑面板"] button')].find(node => node.textContent.trim() === text)
    try {
      await window.showFeature('ai-capabilities')
      document.querySelector('[aria-label="新增 Prompt 快捷方式"]').click()
      await waitFor(() => document.querySelector('[aria-label="快捷方式编辑面板"] input'))
      assert(!document.querySelector('[role="dialog"]'), 'prompt editor escaped into a dialog')
      assert(document.querySelector('[data-quick-prompts]').contains(document.querySelector('[aria-label="快捷方式编辑面板"]')), 'editor is outside shortcut panel')
      fill(document.querySelector('[aria-label="快捷方式编辑面板"] input'), '我的周报')
      fill(document.querySelector('[aria-label="快捷方式编辑面板"] textarea'), '读取本周笔记，整理为完成事项、问题和下周计划。')
      await waitFor(() => !dialogButton('保存').disabled)
      dialogButton('保存').click()
      await waitFor(() => document.querySelector('[aria-label="编辑快捷方式：我的周报"]'))
      assert(JSON.parse(localStorage.getItem('Flota-prefs')).state.aiQuickPromptSets.general.some(item => item.label === '我的周报'), 'prompt not persisted')
      dialogButton('完成').click()
      await waitFor(() => !document.querySelector('[aria-label="快捷方式编辑面板"]'))
      ;[...document.querySelectorAll('[data-quick-prompts] .MuiChip-root')].find(node => node.textContent === '我的周报').click()
      await waitFor(() => document.querySelector('[aria-label="能力示例草稿"]').value.includes('读取本周笔记'))
      document.querySelector('[aria-label="管理 Prompt 快捷方式"]').click()
      await waitFor(() => document.querySelector('[aria-label="编辑快捷方式：我的周报"]'))
      document.querySelector('[aria-label="编辑快捷方式：我的周报"]').click()
      await waitFor(() => document.querySelector('[aria-label="快捷方式编辑面板"] input'))
      fill(document.querySelector('[aria-label="快捷方式编辑面板"] input'), '周报模板')
      await sleep(40)
      dialogButton('保存').click()
      await waitFor(() => document.querySelector('[aria-label="删除快捷方式：周报模板"]'))
      document.querySelector('[aria-label="删除快捷方式：周报模板"]').click()
      await waitFor(() => !document.querySelector('[aria-label="删除快捷方式：周报模板"]'))
      dialogButton('恢复默认').click()
      await waitFor(() => !Object.hasOwn(usePrefsStore.getState().aiQuickPromptSets, 'general'))
      assert(usePrefsStore.getState().aiQuickPromptSets.canvas[0].id === 'keep', 'restoring general overwrites canvas shortcuts')
      dialogButton('完成').click()
    } finally { usePrefsStore.getState().setPref('aiQuickPromptSets', previous) }
  })
  // Long snapshots and a full version list exercise independent scrolling.
  const longContent = Array.from({ length: 80 }, (_, i) => `## 第 ${i + 1} 段\n\n长笔记预览应随正文滚动，标题和恢复按钮始终可见。\n\n\`\`\`text\n保留原始代码内容\n\`\`\``).join('\n\n')
  const layoutNote = await window.acceptanceStorage.createNote(longContent)
  noteId = layoutNote.data.id
  await window.acceptanceStorage.updateNote(noteId, longContent + '\n当前版本')
  for (let i = 0; i < 24; i++) {
    const listed = await window.acceptanceStorage.versions(noteId)
    await window.acceptanceStorage.restoreVersion(noteId, listed.data.versions[0].id, listed.data.revision)
  }
  await window.showFeature('cloud')
  return results
}
window.checkHistoryLayout = async () => {
  await waitFor(() => document.querySelector('.markdown-preview-content'))
  const paper = document.querySelector('[role="dialog"]')
  const content = paper.querySelector('.MuiDialogContent-root')
  const preview = paper.querySelector('.markdown-preview-content')
  const pane = preview.parentElement
  const footer = paper.querySelector('.MuiDialogActions-root')
  assert(getComputedStyle(paper).overflowY === 'hidden', 'dialog scrolls')
  assert(getComputedStyle(content).overflowY === 'hidden', 'dialog content scrolls')
  assert(getComputedStyle(preview).overflowY === 'visible', 'preview creates nested scroll')
  assert(pane.scrollHeight > pane.clientHeight, 'long preview does not scroll')
  const before = pane.scrollTop
  pane.scrollTop = 160
  assert(pane.scrollTop > before, 'preview pane cannot scroll')
  assert(footer.getBoundingClientRect().bottom <= innerHeight, 'restore button below viewport')
  assert(paper.getBoundingClientRect().top >= 0, 'title above viewport')
  return true
}
window.testReady = true
window.showFeature()
