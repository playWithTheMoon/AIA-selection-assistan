import type { KeyboardEventData } from 'selection-hook'

/** vkCode of the letter A (US layout; the select-all hotkey's main key). */
export const VK_A = 65

/** Which physical Ctrl key: Windows VK_LCONTROL=162/VK_RCONTROL=163, macOS 59/62. */
export type CtrlSide = 'left' | 'right'

/** vkCode is either physical Ctrl key (either side holds the trigger). */
export function isCtrlKeyCode(vkCode: number, mac: boolean): boolean {
  return ctrlSide(vkCode, mac) !== null
}

export function ctrlSide(vkCode: number, mac: boolean): CtrlSide | null {
  if (mac) {
    if (vkCode === 59) return 'left'
    if (vkCode === 62) return 'right'
    return null
  }
  if (vkCode === 162) return 'left'
  if (vkCode === 163) return 'right'
  return null
}

/**
 * Held-state of BOTH Ctrl keys tracked separately: one shared boolean loses
 * the hand-over sequence left-down -> right-down -> left-up -> 'A'-up (right
 * is still physically held, but a single-flag state machine already cleared
 * it and the trigger silently missed).
 */
export interface SelectAllTriggerState {
  ctrlLeftDown: boolean
  ctrlRightDown: boolean
}

export const INITIAL_SELECT_ALL_STATE: SelectAllTriggerState = {
  ctrlLeftDown: false,
  ctrlRightDown: false
}

/**
 * One key event step of the Ctrl+A trigger detector. Pure so the state rules
 * are unit-testable without Electron or the native hook. Returns the next
 * state plus whether this event fires the trigger: the key-up of 'A' while
 * either Ctrl key is still held. Key-up, not key-down, because the target
 * app processes Ctrl+A on key-down (selection not ready before that) and
 * key repeat only repeats key-down events, so key-up is naturally
 * repeat-free. The input state is never mutated.
 */
export function stepSelectAllTrigger(
  state: SelectAllTriggerState,
  event: KeyboardEventData,
  mac: boolean,
  isDown: boolean
): { state: SelectAllTriggerState; trigger: boolean } {
  const side = ctrlSide(event.vkCode, mac)
  if (side) {
    const next: SelectAllTriggerState = { ...state }
    if (side === 'left') next.ctrlLeftDown = isDown
    else next.ctrlRightDown = isDown
    return { state: next, trigger: false }
  }
  const ctrlHeld = state.ctrlLeftDown || state.ctrlRightDown
  const trigger = !isDown && event.vkCode === VK_A && ctrlHeld
  return { state, trigger }
}
