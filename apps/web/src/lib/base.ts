/** Public path prefix from Vite `base` (e.g. `/zapp`). Empty when served at site root. */
export function appBase(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, '')
}

/** Prefix an absolute app path (`/api/...`, `/preview/...`) with PUBLIC_BASE_PATH. */
export function withBase(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  const base = appBase()
  if (!path.startsWith('/')) return base ? `${base}/${path}` : path
  if (!base) return path
  if (path === base || path.startsWith(`${base}/`)) return path
  return `${base}${path}`
}
