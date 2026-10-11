import { beforeEach, describe, expect, it } from 'vitest'
import {
  abortStream,
  findRacingStreams,
  registerStream,
  unregisterStream
} from './aiStreamRegistry'

// The registry is module-level state shared across tests in this file —
// every test must register through this helper so beforeEach can reset it.
const registeredIds: string[] = []
function registerForTest(
  requestId: string,
  entry: { controller: AbortController; senderId: number }
): void {
  registerStream(requestId, entry)
  registeredIds.push(requestId)
}

beforeEach(() => {
  for (const requestId of registeredIds.splice(0)) {
    unregisterStream(requestId)
  }
})

// Note: the two disposal trigger sources (window destruction / racing
// takeover) intentionally share one raceResponse setting — a documented
// simplification decision, see main/index.ts handler comment.
function makeEntry(senderId: number): { controller: AbortController; senderId: number } {
  return { controller: new AbortController(), senderId }
}

describe('findRacingStreams', () => {
  it('returns streams from the same sender excluding the current request', () => {
    const old1 = makeEntry(7)
    const old2 = makeEntry(7)
    const other = makeEntry(9)
    registerForTest('r1', old1)
    registerForTest('r2', old2)
    registerForTest('r3', other)

    const racing = findRacingStreams(7, 'r-new')
    expect(racing).toHaveLength(2)
    expect(racing).toContain(old1)
    expect(racing).toContain(old2)
    expect(racing).not.toContain(other)
  })

  it('never reports the request being registered itself', () => {
    registerForTest('r1', makeEntry(7))
    expect(findRacingStreams(7, 'r1')).toHaveLength(0)
  })

  it('returns nothing for unknown senders or an empty registry', () => {
    registerForTest('r1', makeEntry(7))
    expect(findRacingStreams(8, 'r-new')).toHaveLength(0)
    unregisterStream('r1')
    expect(findRacingStreams(7, 'r-new')).toHaveLength(0)
  })
})

describe('abortStream', () => {
  it('aborts the stream and drops its registry entry', () => {
    const entry = makeEntry(1)
    registerForTest('r1', entry)
    expect(abortStream('r1')).toBe(true)
    expect(entry.controller.signal.aborted).toBe(true)
    expect(abortStream('r1')).toBe(false)
  })

  it('returns false for unknown requestIds', () => {
    expect(abortStream('missing')).toBe(false)
  })
})

describe('registerStream / unregisterStream', () => {
  it('replaces the entry when the same requestId re-registers', () => {
    const first = makeEntry(1)
    const second = makeEntry(1)
    registerForTest('r1', first)
    registerForTest('r1', second)
    expect(abortStream('r1')).toBe(true)
    expect(second.controller.signal.aborted).toBe(true)
    expect(first.controller.signal.aborted).toBe(false)
  })
})
