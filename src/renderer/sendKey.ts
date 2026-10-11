import type { KeyboardEvent } from 'react'
import type { SendKeyMode } from '@shared/types'

/**
 * 判断键盘事件是否命中"发送"：4 处管辖输入框（action 追问/输入模式、chat、截图追问）
 * 共用同一判断，避免骨架漂移；isComposing（输入法组词中）在此统一拦截，
 * 修复单行追问框裸 Enter 误发的现状缺陷。
 * 默认档严格纯 Enter（无任何修饰键才发送，避免修饰组合误触）；
 * Ctrl 档兼容 metaKey（macOS Cmd+Enter）。
 */
export function matchesSendKey(event: KeyboardEvent, mode: SendKeyMode): boolean {
  if (event.nativeEvent.isComposing) return false
  if (event.key !== 'Enter') return false
  if (mode === 'ctrlEnter') {
    return (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey
  }
  if (mode === 'shiftEnter') {
    return event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
  }
  return !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
}
