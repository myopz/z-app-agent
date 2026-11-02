/** Append/replace a cache-busting `t` query so browsers refetch iframe / document URLs. */
export function withCacheBust(url: string, token: string | number = Date.now()): string {
  const hashIdx = url.indexOf('#')
  const hash = hashIdx >= 0 ? url.slice(hashIdx) : ''
  const withoutHash = hashIdx >= 0 ? url.slice(0, hashIdx) : url
  const qIdx = withoutHash.indexOf('?')
  const path = qIdx >= 0 ? withoutHash.slice(0, qIdx) : withoutHash
  const query = qIdx >= 0 ? withoutHash.slice(qIdx + 1) : ''
  const params = new URLSearchParams(query)
  params.set('t', String(token))
  return `${path}?${params.toString()}${hash}`
}
