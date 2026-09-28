import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** 首页内置卡片（顺序即默认布局） */
export const HOME_BUILTIN_CARDS = [
  { id: 'quick-note', name: '快速记录', description: '写一句话直接存成笔记' },
  { id: 'todo-rate', name: '待办完成率' },
  { id: 'todo-today', name: '今日待办' },
  { id: 'upcoming', name: '未来 7 天', description: '按天列出即将到期的待办' },
  { id: 'recent-notes', name: '最近笔记' },
  { id: 'todo-overdue', name: '逾期待办' },
  { id: 'notes-overview', name: '笔记概览' },
  { id: 'focus', name: '专注时长' },
  { id: 'heatmap', name: '笔记热力图' },
  { id: 'top-words', name: '高频词' },
  { id: 'plugins', name: '插件' },
  { id: 'recent-clips', name: '最近剪藏', description: '网页剪藏进来的文章' },
  { id: 'pinned-notes', name: '置顶笔记', description: '常用笔记的快捷入口' },
  { id: 'review', name: '温故', description: '每天翻出一篇旧笔记重读' },
  { id: 'tags', name: '常用标签', description: '点标签筛选笔记' },
]

// 新用户的默认首页：不放全部卡片，其余的在「添加卡片」里
const DEFAULT_CARD_IDS = ['quick-note', 'todo-rate', 'todo-today', 'upcoming', 'recent-notes', 'todo-overdue', 'notes-overview', 'focus', 'heatmap', 'review', 'top-words']

/** 启动时可以打开的页面；'last' 表示上次离开时所在的页面 */
export const STARTUP_VIEWS = [
  { value: 'profile', label: '首页' },
  { value: 'notes', label: '笔记' },
  { value: 'todo', label: '待办' },
  { value: 'calendar', label: '日历' },
  { value: 'timeline', label: '时间轴' },
  { value: 'ai', label: 'AI' },
  { value: 'last', label: '上次离开时的页面' },
]
const RESTORABLE_VIEWS = new Set(STARTUP_VIEWS.map((view) => view.value).filter((value) => value !== 'last'))
export const isRestorableView = (view) => RESTORABLE_VIEWS.has(view)

const WIDGET_PREFIX = 'widget:'
export const widgetCardId = (instanceId) => `${WIDGET_PREFIX}${instanceId}`
export const parseWidgetCardId = (cardId) => (String(cardId).startsWith(WIDGET_PREFIX) ? String(cardId).slice(WIDGET_PREFIX.length) : null)

// 首次使用：沿用个人中心已放的组件卡片，排在内置卡片前面
const initialCards = () => {
  let instanceIds = []
  try {
    instanceIds = JSON.parse(localStorage.getItem('Flota-widgets') || '{}')?.state?.profileInstanceIds || []
  } catch {
    instanceIds = []
  }
  return [...instanceIds.map(widgetCardId), ...DEFAULT_CARD_IDS]
}

/**
 * 首页（原个人中心）的卡片布局：内置卡片与组件实例放在同一个有序列表里。
 */
export const useHomeStore = create(
  persist(
    (set) => ({
      cards: initialCards(),
      // 占两列的卡片：{ [cardId]: true }
      wide: {},
      // 启动时打开的页面（见 STARTUP_VIEWS）；lastView 记录上次所在的主页面
      startupView: 'notes',
      lastView: 'notes',
      // 首页顶部「问 FlotaAI」输入框：永久隐藏（持久化）/ 本次不显示（只在这次运行中生效）
      aiBarHidden: false,
      aiBarHiddenThisSession: false,
      setAiBarHidden: (hidden) => set({ aiBarHidden: Boolean(hidden), aiBarHiddenThisSession: false }),
      hideAiBarThisSession: () => set({ aiBarHiddenThisSession: true }),
      editing: false,
      toggleWide: (cardId) => set((state) => ({ wide: { ...state.wide, [cardId]: !state.wide[cardId] } })),
      setStartupView: (value) => set({ startupView: STARTUP_VIEWS.some((view) => view.value === value) ? value : 'notes' }),
      setLastView: (value) => set((state) => (isRestorableView(value) && state.lastView !== value ? { lastView: value } : {})),
      setEditing: (editing) => set({ editing: Boolean(editing) }),
      addCard: (cardId) => set((state) => (state.cards.includes(cardId) ? {} : { cards: [...state.cards, cardId] })),
      removeCard: (cardId) => set((state) => ({ cards: state.cards.filter((id) => id !== cardId) })),
      /** 把卡片移到 targetId 之前（targetId 为空时移到末尾） */
      moveCard: (cardId, targetId) => set((state) => {
        if (cardId === targetId) return {}
        const rest = state.cards.filter((id) => id !== cardId)
        const index = targetId ? rest.indexOf(targetId) : -1
        rest.splice(index < 0 ? rest.length : index, 0, cardId)
        return { cards: rest }
      }),
    }),
    {
      name: 'Flota-home',
      version: 3,
      partialize: (state) => ({ cards: state.cards, wide: state.wide, startupView: state.startupView, lastView: state.lastView, aiBarHidden: state.aiBarHidden }),
      // v1 新增「最近笔记」：放在今日待办后面（用户之后可以移除）
      migrate: (persisted, version) => {
        const cards = Array.isArray(persisted?.cards) ? [...persisted.cards] : initialCards()
        if (version < 1 && !cards.includes('recent-notes')) {
          const index = cards.indexOf('todo-today')
          cards.splice(index < 0 ? cards.length : index + 1, 0, 'recent-notes')
        }
        // v2 新增「快速记录」「未来 7 天」：放到老用户首页上（之后可以移除），其余新卡片在「添加卡片」里
        if (version < 2) {
          if (!cards.includes('quick-note')) cards.unshift('quick-note')
          if (!cards.includes('upcoming')) {
            const index = cards.indexOf('todo-today')
            cards.splice(index < 0 ? cards.length : index + 1, 0, 'upcoming')
          }
        }
        // v3：「启动时打开首页」开关改为可选启动页面
        const next = { ...persisted, cards }
        if (version < 3) {
          next.startupView = persisted?.openOnStartup ? 'profile' : 'notes'
          delete next.openOnStartup
        }
        return next
      },
    }
  )
)

// 迁移后立即落盘：旧的个人中心列表随后会从 Flota-widgets 里去掉
try {
  if (!localStorage.getItem('Flota-home')) useHomeStore.setState({ cards: useHomeStore.getState().cards })
} catch {
  // 无法访问 localStorage 时使用内存中的默认布局
}

export const isInstanceOnHome = (state, instanceId) => state.cards.includes(widgetCardId(instanceId))

/** 放到首页 / 从首页移除某个组件实例，返回操作后是否在首页 */
export const toggleInstanceOnHome = (instanceId) => {
  const store = useHomeStore.getState()
  const cardId = widgetCardId(instanceId)
  if (store.cards.includes(cardId)) {
    store.removeCard(cardId)
    return false
  }
  store.addCard(cardId)
  return true
}
