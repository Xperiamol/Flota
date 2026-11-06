import React from 'react'
import * as ReactNamespace from 'react'
import ReactDOM from 'react-dom/client'
import * as ReactDOMNamespace from 'react-dom'
import * as MaterialUI from '@mui/material'
import * as MaterialIcons from './components/common/AppIcons'
import * as MuiStyles from '@mui/material/styles'
import { CacheProvider } from '@emotion/react'
import createCache from '@emotion/cache'
import { useStore } from './store/useStore'
import { stripMarkdownToPreviewText } from './utils/markdownTextUtils'
import { glassSx, glassSxFor } from './styles/materials'
import SegmentedControl from './components/common/SegmentedControl'
import App from './App.jsx'
import './styles/index.css'

// 插件 API（保持旧签名）：浮层玻璃材质，实际取自主题的 popover 材质
const floatingGlassSx = ({ radius = '4px', shadow = 'default' } = {}) => ({
  ...glassSxFor('popover', { radius, shadow: shadow === 'menu' ? 'menu' : undefined }),
  backgroundClip: 'padding-box',
})

// 把宿主单例暴露给插件视图模块（避免双 React 实例 / 双 MUI 主题上下文）
window.__flotaHost__ = Object.freeze({
  version: 1,
  React: ReactNamespace,
  ReactDOM: ReactDOMNamespace,
  MaterialUI,
  MaterialIcons,
  MuiStyles,
  store: { useStore },
  utils: { stripMarkdownToPreviewText, floatingGlassSx, glassSx },
  // 与宿主一致的通用控件，插件界面直接用，不用自己仿一份
  components: { SegmentedControl },
})

// 创建主应用的emotion cache
const emotionCache = createCache({
  key: 'flota-app',
  prepend: true,
  speedy: false  // 禁用speedy模式，提高兼容性
})

// 创建根元素并渲染应用
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <CacheProvider value={emotionCache}>
      <App />
    </CacheProvider>
  </React.StrictMode>,
)
