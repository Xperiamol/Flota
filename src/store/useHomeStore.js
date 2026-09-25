import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** 首页内置卡片（顺序即默认布局） */
export const HOME_BUILTIN_CARDS = [
  { id: 'todo-rate', name: '待办完成率' },
  { id: 'todo-today', name: '今日待办' },
  { id: 'recent-notes', name: '最近笔记' },
  { id: 'todo-overdue', name: '逾期待办' },
  { id: 'notes-overview', name: '笔记概览' },
  { id: 'focus', name: '专注时长' },
  { id: 'heatmap', name: '笔记热力图' },
  { id: 'top-words', name: '高频词' },
  { id: 'plugins', name: '插件' },
]

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
  return [...instanceIds.map(widgetCardId), ...HOME_BUILTIN_CARDS.map((card) => card.id)]
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
      // 启动应用时直接打开首页
      openOnStartup: false,
      editing: false,
      toggleWide: (cardId) => set((state) => ({ wide: { ...state.wide, [cardId]: !state.wide[cardId] } })),
      setOpenOnStartup: (value) => set({ openOnStartup: Boolean(value) }),
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
      version: 1,
      partialize: (state) => ({ cards: state.cards, wide: state.wide, openOnStartup: state.openOnStartup }),
      // v1 新增「最近笔记」：放在今日待办后面（用户之后可以移除）
      migrate: (persisted, version) => {
        const cards = Array.isArray(persisted?.cards) ? [...persisted.cards] : initialCards()
        if (version < 1 && !cards.includes('recent-notes')) {
          const index = cards.indexOf('todo-today')
          cards.splice(index < 0 ? cards.length : index + 1, 0, 'recent-notes')
        }
        return { ...persisted, cards }
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
