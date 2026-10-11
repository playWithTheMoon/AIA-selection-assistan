import { describe, expect, it } from 'vitest'
import { buildAccelerator, isStandaloneShortcutKey } from './shortcutRule'

describe('isStandaloneShortcutKey', () => {
  it('accepts F1 through F12 only', () => {
    expect(isStandaloneShortcutKey('F1')).toBe(true)
    expect(isStandaloneShortcutKey('F9')).toBe(true)
    expect(isStandaloneShortcutKey('F12')).toBe(true)
  })

  it('rejects out-of-range function keys (the renderer/main divergence incident)', () => {
    expect(isStandaloneShortcutKey('F13')).toBe(false)
    expect(isStandaloneShortcutKey('F50')).toBe(false)
    expect(isStandaloneShortcutKey('F0')).toBe(false)
  })

  it('rejects bare letters, digits and punctuation', () => {
    expect(isStandaloneShortcutKey('A')).toBe(false)
    expect(isStandaloneShortcutKey('1')).toBe(false)
    expect(isStandaloneShortcutKey(';')).toBe(false)
  })
})

describe('buildAccelerator', () => {
  it('composes modifiers in fixed order: CommandOrControl, Alt, Shift, main key', () => {
    expect(buildAccelerator({ commandOrControl: true, alt: true, shift: true }, 'A')).toBe(
      'CommandOrControl+Alt+Shift+A'
    )
    expect(buildAccelerator({ commandOrControl: false, alt: true, shift: false }, 'K')).toBe('Alt+K')
  })

  it('accepts bare function keys', () => {
    expect(buildAccelerator({ commandOrControl: false, alt: false, shift: false }, 'F5')).toBe('F5')
    expect(buildAccelerator({ commandOrControl: false, alt: false, shift: false }, 'F12')).toBe('F12')
  })

  it('rejects bare non-function keys (must never register a silent no-op shortcut)', () => {
    expect(buildAccelerator({ commandOrControl: false, alt: false, shift: false }, 'A')).toBeNull()
    expect(buildAccelerator({ commandOrControl: false, alt: false, shift: false }, 'F13')).toBeNull()
  })

  it('accepts function keys as main key with modifiers', () => {
    expect(buildAccelerator({ commandOrControl: true, alt: false, shift: false }, 'F3')).toBe(
      'CommandOrControl+F3'
    )
  })
})
