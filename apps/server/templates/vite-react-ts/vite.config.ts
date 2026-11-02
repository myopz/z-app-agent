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
    // Preview is embedded in an iframe behind /preview/:id — HMR ws would break.
    hmr: previewBase === '/' ? true : false,
  },
})
