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
import { floatingGlassSx } from './utils/floatingGlassSx'
import App from './App.jsx'
import './styles/index.css'

// 把宿主单例暴露给插件视图模块（避免双 React 实例 / 双 MUI 主题上下文）
window.__flotaHost__ = Object.freeze({
  version: 1,
  React: ReactNamespace,
  ReactDOM: ReactDOMNamespace,
  MaterialUI,
  MaterialIcons,
  MuiStyles,
  store: { useStore },
  utils: { stripMarkdownToPreviewText, floatingGlassSx }
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
