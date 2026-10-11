import { describe, expect, it } from 'vitest'
import {
  INITIAL_SELECT_ALL_STATE,
  ctrlSide,
  isCtrlKeyCode,
  stepSelectAllTrigger,
  type SelectAllTriggerState
} from './selectAllTrigger'
import type { KeyboardEventData } from 'selection-hook'

const keyEvent = (vkCode: number): KeyboardEventData => ({ vkCode })
const win = false
const mac = true

function run(events: Array<[number, boolean]>, macLayout = false): { state: SelectAllTriggerState; triggered: number } {
  let state = INITIAL_SELECT_ALL_STATE
  let triggered = 0
  for (const [vkCode, isDown] of events) {
    const step = stepSelectAllTrigger(state, keyEvent(vkCode), macLayout, isDown)
    state = step.state
    if (step.trigger) triggered += 1
  }
  return { state, triggered }
}

describe('ctrlSide / isCtrlKeyCode', () => {
  it('splits Windows VK_LCONTROL / VK_RCONTROL', () => {
    expect(ctrlSide(162, win)).toBe('left')
    expect(ctrlSide(163, win)).toBe('right')
    expect(isCtrlKeyCode(162, win)).toBe(true)
    expect(isCtrlKeyCode(163, win)).toBe(true)
    expect(isCtrlKeyCode(65, win)).toBe(false)
  })

  it('splits macOS ctrl key codes', () => {
    expect(ctrlSide(59, mac)).toBe('left')
    expect(ctrlSide(62, mac)).toBe('right')
    expect(isCtrlKeyCode(59, mac)).toBe(true)
  })
})

describe('stepSelectAllTrigger', () => {
  it('does not fire on A key-up without Ctrl', () => {
    expect(run([[65, false]]).triggered).toBe(0)
  })

  it('fires on A key-up while left Ctrl is held', () => {
    expect(run([[162, true], [65, false]]).triggered).toBe(1)
  })

  it('fires on A key-up while right Ctrl is held', () => {
    expect(run([[163, true], [65, false]]).triggered).toBe(1)
  })

  it('never fires on key-down (target app owns Ctrl+A on key-down)', () => {
    expect(run([[162, true], [65, true]]).triggered).toBe(0)
  })

  it('does not fire after Ctrl was released before A', () => {
    expect(run([[162, true], [162, false], [65, false]]).triggered).toBe(0)
  })

  it('does not fire on non-A key-ups', () => {
    expect(run([[162, true], [83, false]]).triggered).toBe(0) // S
  })

  it('fires on the left-down -> right-down -> left-up -> A-up hand-over sequence', () => {
    // The single-flag regression: right Ctrl is still physically held when A
    // goes up, but the old state machine had already cleared on left-up.
    expect(run([[162, true], [163, true], [162, false], [65, false]]).triggered).toBe(1)
  })

  it('does not fire once both Ctrl keys are released', () => {
    expect(run([[162, true], [163, true], [162, false], [163, false], [65, false]]).triggered).toBe(0)
  })

  it('is pure: the input state object is never mutated', () => {
    const before = { ...INITIAL_SELECT_ALL_STATE }
    stepSelectAllTrigger(INITIAL_SELECT_ALL_STATE, keyEvent(162), win, true)
    expect(INITIAL_SELECT_ALL_STATE).toEqual(before)
  })

  it('works with the macOS layout codes', () => {
    expect(run([[59, true], [65, false]], true).triggered).toBe(1)
  })
})
