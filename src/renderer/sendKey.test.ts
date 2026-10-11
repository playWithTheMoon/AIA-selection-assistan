import { describe, expect, it } from 'vitest'
import type { KeyboardEvent } from 'react'
import { matchesSendKey } from './sendKey'

type KeyMods = { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; isComposing?: boolean }

function keyEvent(key: string, mods: KeyMods = {}): KeyboardEvent {
  const { isComposing = false, shiftKey = false, ctrlKey = false, metaKey = false, altKey = false } = mods
  return {
    key,
    shiftKey,
    ctrlKey,
    metaKey,
    altKey,
    nativeEvent: { isComposing }
  } as unknown as KeyboardEvent
}

describe('matchesSendKey', () => {
  it("enter mode: plain Enter matches, modifier combos don't", () => {
    expect(matchesSendKey(keyEvent('Enter'), 'enter')).toBe(true)
    expect(matchesSendKey(keyEvent('Enter', { ctrlKey: true }), 'enter')).toBe(false)
    expect(matchesSendKey(keyEvent('Enter', { metaKey: true }), 'enter')).toBe(false)
    expect(matchesSendKey(keyEvent('Enter', { shiftKey: true }), 'enter')).toBe(false)
    expect(matchesSendKey(keyEvent('Enter', { altKey: true }), 'enter')).toBe(false)
  })

  it('ctrlEnter mode: ctrl or meta Enter matches, plain and shift Enter do not', () => {
    expect(matchesSendKey(keyEvent('Enter', { ctrlKey: true }), 'ctrlEnter')).toBe(true)
    expect(matchesSendKey(keyEvent('Enter', { metaKey: true }), 'ctrlEnter')).toBe(true)
    expect(matchesSendKey(keyEvent('Enter'), 'ctrlEnter')).toBe(false)
    expect(matchesSendKey(keyEvent('Enter', { ctrlKey: true, shiftKey: true }), 'ctrlEnter')).toBe(false)
  })

  it('shiftEnter mode: shift Enter matches, ctrl-shift Enter does not', () => {
    expect(matchesSendKey(keyEvent('Enter', { shiftKey: true }), 'shiftEnter')).toBe(true)
    expect(matchesSendKey(keyEvent('Enter', { shiftKey: true, ctrlKey: true }), 'shiftEnter')).toBe(false)
    expect(matchesSendKey(keyEvent('Enter'), 'shiftEnter')).toBe(false)
  })

  it('non-Enter keys never match in any mode', () => {
    expect(matchesSendKey(keyEvent('a'), 'enter')).toBe(false)
    expect(matchesSendKey(keyEvent('Escape'), 'ctrlEnter')).toBe(false)
    expect(matchesSendKey(keyEvent('z', { shiftKey: true }), 'shiftEnter')).toBe(false)
  })

  it('isComposing blocks send in every mode (IME confirmation Enter)', () => {
    expect(matchesSendKey(keyEvent('Enter', { isComposing: true }), 'enter')).toBe(false)
    expect(matchesSendKey(keyEvent('Enter', { isComposing: true, ctrlKey: true }), 'ctrlEnter')).toBe(false)
    expect(matchesSendKey(keyEvent('Enter', { isComposing: true, shiftKey: true }), 'shiftEnter')).toBe(false)
  })
})
