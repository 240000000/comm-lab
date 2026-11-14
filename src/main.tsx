// 必须早于 pdf.js 的动态 import：R115 的 Map 兼容层在模块求值时安装。
import './compat.ts'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
