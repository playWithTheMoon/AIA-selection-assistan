// Registry of in-flight AI streams, keyed by requestId.
//
// Lives in its own module (not main index.ts) so the racing-lookup logic can
// be unit tested without importing the app entry.
export type AbortEntry = {
  controller: AbortController
  senderId: number
}

const abortStreams = new Map<string, AbortEntry>()

export function registerStream(requestId: string, entry: AbortEntry): void {
  abortStreams.set(requestId, entry)
}

export function unregisterStream(requestId: string): void {
  abortStreams.delete(requestId)
}

// Streams previously started by the same window (sender) other than the
// request being registered right now — the "racing takeover" trigger source.
export function findRacingStreams(senderId: number, currentRequestId: string): AbortEntry[] {
  const racing: AbortEntry[] = []
  for (const [requestId, entry] of abortStreams) {
    if (requestId !== currentRequestId && entry.senderId === senderId) {
      racing.push(entry)
    }
  }
  return racing
}

// Abort by requestId and drop the registry entry (used by the explicit
// renderer abort path). Returns whether a stream was found.
export function abortStream(requestId: string): boolean {
  const entry = abortStreams.get(requestId)
  if (!entry) return false
  entry.controller.abort()
  abortStreams.delete(requestId)
  return true
}
