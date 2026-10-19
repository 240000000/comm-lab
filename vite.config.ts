import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 部署在仓库子路径 /comm-lab/ 下；本地开发仍走根路径。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/comm-lab/' : '/',
  plugins: [react()],
}))
