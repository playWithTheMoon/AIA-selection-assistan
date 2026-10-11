import { describe, expect, it } from 'vitest'
import { isOwnProgram, shouldProcessProgram } from './selectionFilter'

describe('selection filtering', () => {
  it('allows everything in default mode', () => {
    expect(shouldProcessProgram('chrome.exe', 'default', ['chrome'])).toBe(true)
  })

  it('supports whitelist mode', () => {
    expect(shouldProcessProgram('Google Chrome', 'whitelist', ['chrome'])).toBe(true)
    expect(shouldProcessProgram('Notes', 'whitelist', ['chrome'])).toBe(false)
  })

  it('supports blacklist mode', () => {
    expect(shouldProcessProgram('Google Chrome', 'blacklist', ['chrome'])).toBe(false)
    expect(shouldProcessProgram('Notes', 'blacklist', ['chrome'])).toBe(true)
  })
})

describe('isOwnProgram', () => {
  it('matches the own executable name case-insensitively', () => {
    expect(isOwnProgram('electron.exe', 'electron.exe')).toBe(true)
    expect(isOwnProgram('Electron.EXE', 'electron.exe')).toBe(true)
  })

  it('does not match other programs', () => {
    expect(isOwnProgram('Code.exe', 'electron.exe')).toBe(false)
  })

  it('treats a missing program name as not-own (pass through)', () => {
    expect(isOwnProgram(undefined, 'electron.exe')).toBe(false)
  })
})
