import type { ServerEvent } from '@z-app-agent/shared'

type Listener = (event: ServerEvent) => void

const listeners = new Map<string, Set<Listener>>()

export function subscribe(projectId: string, listener: Listener): () => void {
  let set = listeners.get(projectId)
  if (!set) {
    set = new Set()
    listeners.set(projectId, set)
  }
  set.add(listener)
  return () => {
    set!.delete(listener)
    if (set!.size === 0) listeners.delete(projectId)
  }
}

export function publish(projectId: string, event: ServerEvent) {
  const set = listeners.get(projectId)
  if (!set) return
  for (const listener of set) {
    try {
      listener(event)
    } catch (err) {
      console.error('event listener error', err)
    }
  }
}
