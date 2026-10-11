// Single source of the shortcut composition rules, shared by the two recorder
// implementations (main-side global hook capture in hotkeyCapture.ts and the
// renderer-side keydown recorder in settings/entry.tsx). The key-code tables
// differ by input source (uiohook numeric codes vs browser KeyboardEvent.key)
// and stay separate on purpose — only composition order and validity rules are
// shared here. Divergence incident this prevents: the renderer accepted
// single-key F13-F99 while main only registers F1-F12, so recorded shortcuts
// silently never fired.

/** Standalone (no modifier) keys: only F1-F12 are valid global shortcuts. */
export function isStandaloneShortcutKey(mainKey: string): boolean {
  return /^F([1-9]|1[0-2])$/.test(mainKey)
}

export interface ShortcutModifiers {
  /** Ctrl on Windows/Linux, Cmd on macOS — Electron's CommandOrControl. */
  commandOrControl: boolean
  alt: boolean
  shift: boolean
}

/**
 * Compose an Electron accelerator from modifier booleans plus the main key.
 * Returns null when the combination is invalid (bare non-function key) so
 * callers can reject it at recording time instead of registering a shortcut
 * that never fires. Order is fixed: CommandOrControl, Alt, Shift, main key.
 */
export function buildAccelerator(modifiers: ShortcutModifiers, mainKey: string): string | null {
  const parts: string[] = []
  if (modifiers.commandOrControl) parts.push('CommandOrControl')
  if (modifiers.alt) parts.push('Alt')
  if (modifiers.shift) parts.push('Shift')
  parts.push(mainKey)
  const hasModifier = parts.length > 1
  if (!hasModifier && !isStandaloneShortcutKey(mainKey)) return null
  return parts.join('+')
}
