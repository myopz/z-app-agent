import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const previewBase = process.env.Z_APP_PREVIEW_BASE || '/'

export default defineConfig({
  base: previewBase,
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    strictPort: true,
    // 经 mac.ittoolplus.cn 反代时 Host 非 localhost
    allowedHosts: true,
    // iframe + 多级反代下 HMR/WebSocket 不可用，关掉避免白屏与报错遮罩
    hmr: false,
  },
})
