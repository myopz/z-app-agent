import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function readDotEnv(key: string): string | undefined {
  if (process.env[key] !== undefined) return process.env[key]
  const file = path.join(repoRoot, '.env')
  if (!fs.existsSync(file)) return undefined
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const eq = line.indexOf('=')
    const k = line.slice(0, eq).trim()
    if (k !== key) continue
    let v = line.slice(eq + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    return v
  }
  return undefined
}

/** Normalize to `` or `/zapp` (no trailing slash). Default `/zapp`. */
function normalizePublicBase(raw: string | undefined): string {
  const t = (raw ?? '/zapp').trim()
  if (!t || t === '/') return ''
  return `/${t.replace(/^\/+|\/+$/g, '')}`
}

const publicBase = normalizePublicBase(readDotEnv('PUBLIC_BASE_PATH'))
const base = publicBase ? `${publicBase}/` : '/'

function proxyToServer(): ProxyOptions {
  return {
    target: 'http://127.0.0.1:39000',
    rewrite: publicBase
      ? (p) => {
          const stripped = p.startsWith(publicBase) ? p.slice(publicBase.length) : p
          return stripped || '/'
        }
      : undefined,
    configure(proxy) {
      if (!publicBase) return
      proxy.on('proxyRes', (proxyRes) => {
        const loc = proxyRes.headers.location
        if (typeof loc !== 'string' || !loc.startsWith('/')) return
        if (loc === publicBase || loc.startsWith(`${publicBase}/`)) return
        proxyRes.headers.location = `${publicBase}${loc}`
      })
    },
  }
}

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'redirect-root-to-base',
      configureServer(server) {
        // Wrap early so later Vite setHeader('Cache-Control', 'no-cache') cannot stick.
        server.middlewares.use((req, res, next) => {
          const pathOnly = (req.url ?? '').split('?')[0] ?? ''
          const isHtmlEntry =
            pathOnly === '/' ||
            pathOnly === publicBase ||
            pathOnly === `${publicBase}/` ||
            pathOnly.endsWith('.html')
          const isDevModule =
            pathOnly.includes('/src/') ||
            pathOnly.includes('/@vite/') ||
            pathOnly.includes('/@fs/') ||
            pathOnly.includes('/@id/') ||
            pathOnly.endsWith('.css')
          if (isHtmlEntry || isDevModule) {
            const setHeader = res.setHeader.bind(res)
            res.setHeader = ((name: string, value: number | string | readonly string[]) => {
              if (String(name).toLowerCase() === 'cache-control') {
                return setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
              }
              return setHeader(name, value)
            }) as typeof res.setHeader
            setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
            setHeader('Pragma', 'no-cache')
            setHeader('Expires', '0')
          }
          next()
        })
        if (!publicBase) return
        server.middlewares.use((req, res, next) => {
          const url = req.url ?? ''
          if (url === '/' || url.startsWith('/?')) {
            res.statusCode = 302
            res.setHeader('Location', `${publicBase}/${url.slice(1)}`)
            res.end()
            return
          }
          next()
        })
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 39001,
    strictPort: true,
    // 经 OpenResty 反代时 Host 为 mac.ittoolplus.cn；仅监听 127.0.0.1，放开即可
    allowedHosts: true,
    proxy: publicBase
      ? {
          [`${publicBase}/api`]: proxyToServer(),
          [`${publicBase}/preview`]: proxyToServer(),
          [`${publicBase}/healthz`]: proxyToServer(),
        }
      : {
          '/api': proxyToServer(),
          '/preview': proxyToServer(),
          '/healthz': proxyToServer(),
        },
  },
})
