declare module 'selection-hook' {
  export interface Point {
    x: number
    y: number
  }

  export interface TextSelectionData {
    text: string
    programName: string
    isFullscreen?: boolean
    posLevel: number
    mousePosStart: Point
    mousePosEnd: Point
    startTop: Point
    startBottom: Point
    endTop: Point
    endBottom: Point
    /** [fork] Handle of the window the selection was read from (Windows only; null elsewhere) */
    hwnd?: number | null
  }

  export interface KeyboardEventData {
    vkCode: number
    /** Whether any of Ctrl/Alt/Win was held at event time (GetAsyncKeyState in selection_hook.cc) */
    sys?: boolean
    /** MDN KeyboardEvent.key style name (e.g. 'a') */
    uniKey?: string
    /** Low-level hook flags (LLKHF_*) */
    flags?: number
  }

  export interface MouseEventData {
    x: number
    y: number
  }

  export interface SelectionHookInstance {
    start(options?: { debug?: boolean }): boolean
    stop(): void
    cleanup(): void
    on(event: string, callback: (...args: any[]) => void): void
    off(event: string, callback: (...args: any[]) => void): void
    getCurrentSelection(): TextSelectionData | null
    /** [fork] Read the selection of a specific window by handle (Windows only) */
    getSelectionOfWindow(hwnd: number): TextSelectionData | null
    /** [fork] Send Ctrl+V; with hwnd, only while that window is still foreground at injection time; false when skipped (Windows only) */
    sendPasteKey(hwnd?: number | null): boolean
    /** [fork] Bring the window with the given handle to the foreground; false when invalid or denied (Windows only) */
    focusWindow(hwnd: number): boolean
    setSelectionPassiveMode(passive: boolean): void
    setGlobalFilterMode(mode: number, list: string[]): boolean
    writeToClipboard(text: string): boolean
  }

  export interface SelectionHookConstructor {
    new (): SelectionHookInstance
    PositionLevel: {
      NONE: number
      MOUSE_SINGLE: number
      MOUSE_DUAL: number
      SEL_FULL: number
      SEL_DETAILED: number
    }
    FilterMode: {
      DEFAULT: number
      INCLUDE_LIST: number
      EXCLUDE_LIST: number
    }
  }

  const SelectionHook: SelectionHookConstructor
  export default SelectionHook
}
