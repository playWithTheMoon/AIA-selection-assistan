import type { LastSelection, PreWindowEntry } from '@shared/types'

// Pre-selection pool: in-memory only. Its lifetime is ONE chat window
// session — closing the window ends the gathering intent, and the next
// session starts empty. A restart also clears it (nothing persists anywhere).
const MAX_POOL_SIZE = 10

const pool = new Map<string, PreWindowEntry>()
let lastSelection: LastSelection | null = null

export function savePreWindow(entry: Omit<PreWindowEntry, 'id' | 'createdAt'>): PreWindowEntry {
  const full: PreWindowEntry = {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: Date.now()
  }
  pool.set(full.id, full)
  if (pool.size > MAX_POOL_SIZE) {
    // Evict the oldest entry first (insertion order of Map is FIFO).
    const oldest = pool.keys().next().value
    if (oldest !== undefined) pool.delete(oldest)
  }
  return full
}

export function listPreWindows(): PreWindowEntry[] {
  return [...pool.values()].sort((a, b) => b.createdAt - a.createdAt)
}

export function removePreWindow(id: string): boolean {
  return pool.delete(id)
}

// Called when the chat window closes (index.ts 'closed' hook): one window
// session, one pool. The window is already destroyed at that point — no
// change notification needed, the next session re-pulls an empty list.
export function clearPreWindows(): void {
  pool.clear()
}

export function setLastSelection(selection: Omit<LastSelection, 'at'>): void {
  lastSelection = { ...selection, at: Date.now() }
}

export function getLastSelection(): LastSelection | null {
  return lastSelection
}
