import React from 'react'
import ReactDOM from 'react-dom/client'
import { CacheProvider } from '@emotion/react'
import createCache from '@emotion/cache'
import App from './App.jsx'
import './styles/index.css'

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