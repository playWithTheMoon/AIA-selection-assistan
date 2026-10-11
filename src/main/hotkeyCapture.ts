import type { WebContents } from 'electron'
import { EventType, UiohookKey, uIOhook } from 'uiohook-napi'
import type { UiohookKeyboardEvent } from 'uiohook-napi'
import { buildAccelerator as buildShortcutAccelerator } from '@shared/shortcutRule'

/**
 * 快捷键录制钩子：Windows 会截获部分组合键（如 Alt+Space 弹系统菜单），
 * keydown 到不了 renderer 录入框（2026-10-09 实测截屏定案）。录制态改在 main 用
 * 系统级钩子抓全局按键流，钩子层不受窗口焦点与系统菜单影响。ZTools（uTools 开源
 * 实现）同款机制。renderer 的 document keydown 保留为钩子启动失败时的兜底。
 *
 * 单次录制语义：提交一个组合键即自动停止，钩子存活期最小化（全局监听有隐私面）。
 */

// uiohook 键码 → Electron accelerator 主键名。覆盖域与前端 normalizeShortcutKey
// 一致（字母/数字/F1-F12/Space/方向/编辑键/标点），表外键码静默忽略（等价前端
// "不支持的按键"路径）。修饰键不入表——修饰态直接读事件上的 altKey/ctrlKey 等。
// 组合顺序与单键合法性规则本体在 @shared/shortcutRule，两端共用，不再靠注释对齐。
const KEY_TABLE = UiohookKey as unknown as Record<string, number>
const KEYCODE_TO_ACCELERATOR: Record<number, string> = {
  [UiohookKey.Space]: 'Space',
  [UiohookKey.Enter]: 'Enter',
  [UiohookKey.Backspace]: 'Backspace',
  [UiohookKey.Delete]: 'Delete',
  [UiohookKey.Insert]: 'Insert',
  [UiohookKey.Home]: 'Home',
  [UiohookKey.End]: 'End',
  [UiohookKey.PageUp]: 'PageUp',
  [UiohookKey.PageDown]: 'PageDown',
  [UiohookKey.ArrowUp]: 'Up',
  [UiohookKey.ArrowDown]: 'Down',
  [UiohookKey.ArrowLeft]: 'Left',
  [UiohookKey.ArrowRight]: 'Right',
  [UiohookKey.Semicolon]: ';',
  [UiohookKey.Equal]: '=',
  [UiohookKey.Comma]: ',',
  [UiohookKey.Minus]: '-',
  [UiohookKey.Period]: '.',
  [UiohookKey.Slash]: '/',
  [UiohookKey.Backquote]: '`',
  [UiohookKey.BracketLeft]: '[',
  [UiohookKey.BracketRight]: ']',
  [UiohookKey.Backslash]: '\\',
  [UiohookKey.Quote]: "'",
  ...Object.fromEntries(
    Array.from({ length: 26 }, (_, i) => [KEY_TABLE[String.fromCharCode(65 + i)], String.fromCharCode(65 + i)])
  ),
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [KEY_TABLE[String(i)], String(i)])),
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [KEY_TABLE[`F${i + 1}`], `F${i + 1}`]))
}

function buildAccelerator(event: UiohookKeyboardEvent): string | null {
  const mainKey = KEYCODE_TO_ACCELERATOR[event.keycode]
  if (!mainKey) return null
  return buildShortcutAccelerator(
    { commandOrControl: event.metaKey || event.ctrlKey, alt: event.altKey, shift: event.shiftKey },
    mainKey
  )
}

// 修饰键本身按下/松开不构成主键——单独列出避免每事件查多个集合
const MODIFIER_KEYCODES = new Set<number>([
  UiohookKey.Ctrl,
  UiohookKey.CtrlRight,
  UiohookKey.Alt,
  UiohookKey.AltRight,
  UiohookKey.Shift,
  UiohookKey.ShiftRight,
  UiohookKey.Meta,
  UiohookKey.MetaRight
])

let captureSender: WebContents | null = null
// Session token: many recorder components share one page-level IPC channel, so
// each start hands out a token and the captured event carries it back — only
// the recorder that started this capture accepts the keystroke.
let captureToken: number | null = null

function handleKeyboardEvent(event: UiohookKeyboardEvent): void {
  if (event.type !== EventType.EVENT_KEY_PRESSED) return
  // Escape 交还前端取消语义（Esc 无系统截获，renderer keydown 可达）
  if (event.keycode === UiohookKey.Escape || MODIFIER_KEYCODES.has(event.keycode)) return
  const accelerator = buildAccelerator(event)
  if (!accelerator || !captureSender || captureSender.isDestroyed()) return
  captureSender.send('hotkey-captured', captureToken, accelerator)
  stopHotkeyCapture()
}

export function startHotkeyCapture(sender: WebContents): number | null {
  if (captureSender && !captureSender.isDestroyed()) stopHotkeyCapture()
  try {
    uIOhook.on('keydown', handleKeyboardEvent)
    uIOhook.start()
  } catch (error) {
    // 原生模块加载/启动失败：静默回退，前端 keydown 兜底路径不受影响
    console.warn('[hotkey-capture] hook start failed:', error instanceof Error ? error.message : error)
    return null
  }
  captureSender = sender
  captureToken = Date.now()
  // 录制中窗口被销毁必须摘钩子，否则全局监听残留
  sender.once('destroyed', () => stopHotkeyCapture())
  return captureToken
}

export function stopHotkeyCapture(): void {
  if (!captureSender) return
  captureSender = null
  captureToken = null
  try {
    uIOhook.stop()
    uIOhook.off('keydown', handleKeyboardEvent)
  } catch (error) {
    console.warn('[hotkey-capture] hook stop failed:', error instanceof Error ? error.message : error)
  }
}
