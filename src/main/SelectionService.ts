import { BrowserWindow, clipboard, ipcMain, screen, systemPreferences } from 'electron'
import { createRequire } from 'node:module'
import { basename } from 'node:path'
import { IPC } from '@shared/ipc'
import { isOwnProgram, shouldProcessProgram } from '@shared/selectionFilter'
import type { ActionItem, ActionPayload, AppSettings, ReplaceSelectionResult, SelectedTextPayload } from '@shared/types'
import { setLastSelection } from './preWindowStore'
import { loadRenderer } from './loadRenderer'
import { isMac, isWin } from './platform'
import {
  INITIAL_SELECT_ALL_STATE,
  isCtrlKeyCode,
  stepSelectAllTrigger,
  type SelectAllTriggerState
} from './selectAllTrigger'
import type {
  KeyboardEventData,
  MouseEventData,
  SelectionHookConstructor,
  SelectionHookInstance,
  TextSelectionData
} from 'selection-hook'

const require = createRequire(import.meta.url)

type Point = { x: number; y: number }
type Orientation = 'topLeft' | 'topRight' | 'topMiddle' | 'bottomLeft' | 'bottomRight' | 'bottomMiddle'

const TOOLBAR_HEIGHT = 36
const DEFAULT_TOOLBAR_WIDTH = 390
const TOOLBAR_SCREEN_MARGIN = 8
const TOOLBAR_SHADOW_PADDING = 16
const ACTION_WIDTH = 560
const ACTION_HEIGHT = 420
const ACTION_SHADOW_PADDING = 18
// Paste-back (issue #7): settle time between restoring focus to the target
// window and re-reading its selection. Experiment-verified value (two Notepad
// rounds: focus 15-21ms, readback fine at +120ms).
const REPLACE_FOCUS_DELAY_MS = 120

// Delay between the Ctrl+A key-up and reading the selection: the target app
// updates its selection while processing the key-down, so an immediate read
// races it. 120ms mirrors the experiment-verified paste-back readback delay
// above; recalibrate if slow-UIA apps miss the trigger.
const SELECT_ALL_READ_DELAY_MS = 120

// Selection text shape can differ between the hook's first read and the
// verification readback (CRLF vs LF); compare on normalized form only.
const normalizeForCompare = (text: string): string => text.replace(/\r\n|\r/g, '\n')

export class SelectionService {
  private hookCtor: SelectionHookConstructor | null = null
  private hook: SelectionHookInstance | null = null
  private toolbarWindow: BrowserWindow | null = null
  /** True once the toolbar renderer measured its content (first determineToolbarSize) — that call only happens after React mounted with real buttons, so it is a reliable "page is usable" signal (ready-to-show is unreliable on transparent windows). Selections before it are dropped instead of flashing an empty toolbar. */
  private toolbarReady = false
  private actionWindows = new Set<BrowserWindow>()
  // Payload a fresh action window opens with, keyed by webContents id. The
  // renderer pulls it synchronously on its first render (SelectionGetInitialAction).
  private pendingInitialPayload = new Map<number, ActionPayload>()
  // Single-window pool lifecycle flags (pool capacity locked to 1). WeakSet
  // entries die with their window — nothing to clean on 'closed'.
  // - readyWindows: 'ready-to-show' has fired. A window without this flag is
  //   still loading its renderer (in flight); its payload must arrive via
  //   pendingInitialPayload, because webContents.send finds no listener yet.
  // - closingWindows: close() requested but 'closed' not yet fired. Excluded
  //   from reuse — a payload sent into a dying window is silently dropped.
  private readyWindows = new WeakSet<BrowserWindow>()
  private closingWindows = new WeakSet<BrowserWindow>()
  // True while the service is stopping or the app is exiting: window close
  // requests must really close, never route into the hide-instead-of-close
  // setting. Reset on start() so stop→start cycles restore the setting.
  private forceClose = false
  private started = false
  // Ctrl+A select-all trigger (Windows only): held-state of either Ctrl key,
  // fed by the always-on key-down/key-up listeners hung in start().
  private selectAllState: SelectAllTriggerState = INITIAL_SELECT_ALL_STATE
  private toolbarWidth = DEFAULT_TOOLBAR_WIDTH
  private lastActionSize = { width: ACTION_WIDTH, height: ACTION_HEIGHT }
  private hideListenerActive = false
  // Own executable name for the self-selection ban (handleSelection): the hook
  // reports the exe the selection happened in, so comparing against
  // process.execPath covers dev (electron.exe) and packaged builds without
  // hardcoding a name.
  private readonly ownProgramName = basename(process.execPath)

  constructor(
    private getSettings: () => AppSettings,
    private preloadPath: string,
    private rendererDir: string,
    private windowIcon: Electron.NativeImage,
    /** Packaged-build failure channel (tray balloon), same pattern as failed
     * shortcut registration. Optional: dev relies on console.error alone. */
    private notifyFailure?: (title: string, message: string) => void
  ) {
    try {
      this.hookCtor = require('selection-hook') as SelectionHookConstructor
      this.hook = new this.hookCtor()
    } catch (error) {
      console.error('Failed to load selection-hook', error)
    }
  }

  get isAvailable(): boolean {
    return !!this.hook && !!this.hookCtor
  }

  get isRunning(): boolean {
    return this.started
  }

  start(): boolean {
    if (!this.hook || !this.hookCtor || this.started) return false
    if (isMac && !systemPreferences.isTrustedAccessibilityClient(false)) return false

    this.forceClose = false
    this.createToolbarWindow()
    // Prebuild the pooled action window at service
    // start so the first trigger skips window creation. Same placement as the
    // toolbar window: created before hook.start(), torn down by stop().
    if (this.getSettings().prebuildActionWindow) this.precreateActionWindow()
    this.hook.on('text-selection', this.handleSelection)

    if (!this.hook.start({ debug: !process.env.NODE_ENV || process.env.NODE_ENV === 'development' })) return false

    // The select-all trigger rides the keyboard channel the hook already runs
    // (the C++ low-level hook is always installed and always reports; adding a
    // JS listener costs nothing extra). Windows only: the key event semantics
    // verified here are the Windows low-level hook's.
    if (isWin) {
      this.hook.on('key-down', this.handleSelectAllKeyDown)
      this.hook.on('key-up', this.handleSelectAllKeyUp)
    }

    this.started = true
    this.applySettings(this.getSettings())
    return true
  }

  stop(): void {
    // Stopping tears the pool down regardless of the close-action setting.
    this.forceClose = true
    if (!this.hook || !this.started) return
    this.stopHideListeners()
    if (isWin) {
      this.hook.off('key-down', this.handleSelectAllKeyDown)
      this.hook.off('key-up', this.handleSelectAllKeyUp)
    }
    // A lost key-up while stopping would leave stale held-state; reset on stop
    // so start() begins from a clean slate.
    this.selectAllState = INITIAL_SELECT_ALL_STATE
    this.hook.stop()
    this.hook.cleanup()
    this.toolbarWindow?.close()
    this.toolbarWindow = null
    this.toolbarReady = false
    for (const win of this.actionWindows) {
      if (!win.isDestroyed()) win.close()
    }
    this.actionWindows.clear()
    this.started = false
  }

  dispose(): void {
    this.stop()
    this.hook = null
  }

  // App exit path (before-quit): window closes from here on are final, so the
  // hide-instead-of-close setting must not intercept them.
  prepareExit(): void {
    this.forceClose = true
  }

  applySettings(settings: AppSettings): void {
    if (!this.hook || !this.hookCtor || !this.started) return

    const modeMap = {
      default: this.hookCtor.FilterMode.DEFAULT,
      whitelist: this.hookCtor.FilterMode.INCLUDE_LIST,
      blacklist: this.hookCtor.FilterMode.EXCLUDE_LIST
    }
    this.hook.setGlobalFilterMode(modeMap[settings.filterMode], settings.filterList)

    this.hook.setSelectionPassiveMode(settings.triggerMode === 'shortcut')
  }

  processShortcutSelection(): void {
    if (!this.hook || !this.started || this.getSettings().triggerMode !== 'shortcut') return
    const selection = this.hook.getCurrentSelection()
    if (selection) this.handleSelection(selection)
  }

  hideToolbar(): void {
    this.stopHideListeners()
    if (!this.toolbarWindow || this.toolbarWindow.isDestroyed()) return
    this.toolbarWindow.hide()
    this.toolbarWindow.webContents.send(IPC.SelectionVisibility, false)
  }

  writeClipboard(text: string): boolean {
    if (this.hook && this.started) {
      try {
        return this.hook.writeToClipboard(text)
      } catch {
        // Fall through to Electron clipboard.
      }
    }
    clipboard.writeText(text)
    return true
  }

  /**
   * Issue #7 paste-back: write `text` over the original selection in the
   * window the selection came from. Gates in order — platform, focus restore,
   * selection re-verification — and never sends the paste key unless every
   * gate passes (experiment-verified chain: focusWindow -> delay ->
   * getSelectionOfWindow -> sendPasteKey). Every failure path leaves the
   * clipboard holding `text`, so the renderer can hint a manual paste.
   */
  async replaceSelection(payload: {
    text: string
    selectedText: string
    programName?: string
    hwnd?: number | null
  }): Promise<ReplaceSelectionResult> {
    if (!isWin || !this.hook || !this.started) return { ok: false, reason: 'unsupported' }
    if (!payload.hwnd) return { ok: false, reason: 'window-gone' }

    this.writeClipboard(payload.text)

    if (!this.hook.focusWindow(payload.hwnd)) return { ok: false, reason: 'window-gone' }
    await new Promise((resolve) => setTimeout(resolve, REPLACE_FOCUS_DELAY_MS))

    const selection = this.hook.getSelectionOfWindow(payload.hwnd)
    const sameText = Boolean(selection && normalizeForCompare(selection.text) === normalizeForCompare(payload.selectedText))
    const sameProgram = Boolean(
      selection && (!payload.programName || selection.programName === payload.programName)
    )
    if (!selection || !sameText || !sameProgram) return { ok: false, reason: 'selection-changed' }

    // Target hwnd rides along to the injection boundary: between the
    // verification above and this call the user may switch windows, and the
    // paste must never land in whatever became foreground instead. A false
    // return (skipped or blocked) keeps the clipboard holding `text`, so the
    // renderer can hint a manual paste.
    if (!this.hook.sendPasteKey(payload.hwnd)) return { ok: false, reason: 'send-failed' }
    return { ok: true }
  }

  setToolbarSize(width: number): void {
    // First measure = React mounted with real buttons: the toolbar page is
    // usable from here on (see toolbarReady doc).
    this.toolbarReady = true
    if (!Number.isFinite(width) || width <= 0) return
    this.toolbarWidth = this.clampToolbarWidth(Math.ceil(width))
    if (!this.toolbarWindow || this.toolbarWindow.isDestroyed() || !this.toolbarWindow.isVisible()) return

    const bounds = this.toolbarWindow.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const area = display.workArea
    const visibleX = bounds.x + TOOLBAR_SHADOW_PADDING
    const x = Math.round(Math.max(area.x, Math.min(visibleX, area.x + area.width - this.toolbarWidth)))
    this.toolbarWindow.setBounds({
      x: x - TOOLBAR_SHADOW_PADDING,
      y: bounds.y,
      width: this.getToolbarWindowWidth(),
      height: this.getToolbarWindowHeight()
    })
  }

  processAction(payload: ActionPayload): void {
    const settings = this.getSettings()
    this.openActionWindow(payload, (win) => this.positionAndShowActionWindow(win, settings))
  }

  // Open a type-in window for an action (triggered by its global shortcut),
  // independent of the selection toolbar.
  openActionInput(action: ActionItem): void {
    const settings = this.getSettings()
    const payload: ActionPayload = { action, selectedText: '', mode: 'input' }
    this.openActionWindow(payload, (win) => {
      this.positionActionWindowCenter(win, settings)
      win.show()
      win.focus()
    })
  }

  // Single-window pool (capacity locked to 1): reuse
  // the one living window whenever it exists; create only when none does.
  // The reuse predicate is lifecycle state, NOT isVisible() — isVisible() is
  // false for minimized AND still-loading windows, which caused both original
  // leaks: a second window spawned while the first was mid-creation, and
  // minimized windows never reused, so the pool could grow.
  //
  // Delivery on a reused window is belt-and-braces: the payload is stashed in
  // pendingInitialPayload (overwrites — an in-flight renderer has not pulled
  // yet) AND sent over IPC. Each channel covers the other's timing gap: send
  // wins once the renderer's onAction listener is mounted, the stash covers
  // everything before that. Double delivery is harmless — setPayload overwrites.
  //
  // show() runs only for ready windows: show() un-minimizes, so a minimized
  // window restores in place with fresh content. An in-flight window is shown
  // by its existing ready-to-show callback (positioned by the first trigger —
  // accepted trade-off for a simpler state machine).
  private openActionWindow(payload: ActionPayload, show: (win: BrowserWindow) => void): void {
    const existing = Array.from(this.actionWindows).find(
      (win) => !win.isDestroyed() && !this.closingWindows.has(win)
    )
    if (existing) {
      this.pendingInitialPayload.set(existing.webContents.id, payload)
      existing.webContents.send(IPC.SelectionProcessAction, payload)
      if (this.readyWindows.has(existing)) show(existing)
      return
    }
    const win = this.createActionWindow()
    this.pendingInitialPayload.set(win.webContents.id, payload)
    win.once('ready-to-show', () => {
      this.readyWindows.add(win)
      if (!win.isDestroyed()) show(win)
    })
  }

  closeActionWindow(sender: Electron.WebContents): void {
    const win = BrowserWindow.fromWebContents(sender)
    if (win && !win.isDestroyed()) win.close()
  }

  minimizeActionWindow(sender: Electron.WebContents): void {
    const win = BrowserWindow.fromWebContents(sender)
    if (win && !win.isDestroyed()) win.minimize()
  }

  pinActionWindow(sender: Electron.WebContents, pinned: boolean): void {
    const win = BrowserWindow.fromWebContents(sender)
    if (win && !win.isDestroyed()) win.setAlwaysOnTop(pinned)
  }

  registerIpc(): void {
    ipcMain.handle(IPC.SelectionStart, () => this.start())
    ipcMain.handle(IPC.SelectionStop, () => this.stop())
    ipcMain.handle(IPC.SelectionHideToolbar, () => this.hideToolbar())
    ipcMain.handle(IPC.SelectionWriteClipboard, (_event, text: string) => this.writeClipboard(text))
    ipcMain.handle(IPC.SelectionReplaceSelection, (_event, payload) => this.replaceSelection(payload))
    ipcMain.handle(IPC.SelectionDetermineToolbarSize, (_event, width: number) => this.setToolbarSize(width))
    ipcMain.handle(IPC.SelectionProcessAction, (_event, payload: ActionPayload) => this.processAction(payload))
    ipcMain.on(IPC.SelectionGetInitialAction, (event) => {
      // 幂等取用：不在此处 delete。React StrictMode（dev）会双调用 useState initializer
      // （entry.tsx ActionApp），消费两次导致第二次返回 null → 空窗。
      // 条目由窗 closed 事件清理。
      event.returnValue = this.pendingInitialPayload.get(event.sender.id) ?? null
    })
    ipcMain.handle(IPC.WindowClose, (event) => this.closeActionWindow(event.sender))
    ipcMain.handle(IPC.WindowMinimize, (event) => this.minimizeActionWindow(event.sender))
    ipcMain.handle(IPC.WindowPin, (event, pinned: boolean) => this.pinActionWindow(event.sender, pinned))
    ipcMain.handle(IPC.SelectionGetAccessibility, () =>
      isMac ? systemPreferences.isTrustedAccessibilityClient(false) : true
    )
    ipcMain.handle(IPC.SelectionRequestAccessibility, () =>
      isMac ? systemPreferences.isTrustedAccessibilityClient(true) : true
    )
  }

  private createToolbarWindow(): void {
    if (this.toolbarWindow && !this.toolbarWindow.isDestroyed()) return

    this.toolbarReady = false
    this.toolbarWindow = new BrowserWindow({
      width: this.getToolbarWindowWidth(),
      height: this.getToolbarWindowHeight(),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      autoHideMenuBar: true,
      focusable: false,
      ...(isMac ? { type: 'panel' as const, hiddenInMissionControl: true, acceptFirstMouse: true } : {}),
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    if (isMac) {
      this.toolbarWindow.on('blur', () => this.hideToolbar())
    }
    this.toolbarWindow.on('closed', () => {
      this.toolbarWindow = null
    })
    this.toolbarWindow.once('ready-to-show', () => {
      this.toolbarReady = true
    })
    // A failed page load used to be masked by a 30s force-ready timer ("a
    // visible empty toolbar beats a permanently mute one") — removed
    // deliberately: failure must be visible, not papered over with a
    // timer that could also fire after a stop/start cycle and mark an
    // unloaded window ready. Until the page is genuinely ready, selections
    // stay dropped by handleSelection's toolbarReady gate.
    // Electron signature: (event, errorCode, errorDescription, validatedURL,
    // isMainFrame, ...) — isMainFrame is the FIFTH argument, not the fourth.
    this.toolbarWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (!isMainFrame || !this.started) return
      console.error(`[selection] toolbar page failed to load: ${errorCode} ${errorDescription}`)
      const zh = this.getSettings().language === 'zh-CN'
      this.notifyFailure?.(
        zh ? '划词工具栏加载失败' : 'Selection toolbar failed to load',
        zh
          ? `错误码 ${errorCode}：划词功能可能不可用，请重启应用`
          : `Error ${errorCode}: the selection toolbar may be unavailable. Restart the app.`
      )
    })
    loadRenderer(this.toolbarWindow, this.rendererDir, 'selectionToolbar.html')
  }

  private createActionWindow(): BrowserWindow {
    const settings = this.getSettings()
    const width = settings.rememberWindowSize ? this.lastActionSize.width : settings.actionWindowWidth
    const height = settings.rememberWindowSize ? this.lastActionSize.height : settings.actionWindowHeight
    const win = new BrowserWindow({
      width: this.getActionWindowWidth(width),
      height: this.getActionWindowHeight(height),
      minWidth: this.getActionWindowWidth(320),
      minHeight: this.getActionWindowHeight(240),
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      icon: this.windowIcon,
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: ACTION_SHADOW_PADDING + 12, y: ACTION_SHADOW_PADDING + 10 },
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    const wcId = win.webContents.id
    win.on('close', (event) => {
      // The "close action" setting: hide keeps the
      // pooled window alive for instant reuse (S1's reuse predicate picks it
      // up); destroy keeps the pre-S2 behavior. All close entries funnel
      // through this handler — the X button and blur-close arrive via
      // IPC.WindowClose → win.close(), Alt+F4/taskbar via the OS — so the
      // decision lives in exactly one place.
      const hideInsteadOfClose = !this.forceClose && this.getSettings().actionWindowClose === 'hide'
      if (hideInsteadOfClose) {
        event.preventDefault()
        win.hide()
        return
      }
      // Mark dying during the close→closed gap so openActionWindow skips it.
      this.closingWindows.add(win)
    })
    win.on('closed', () => {
      this.actionWindows.delete(win)
      this.pendingInitialPayload.delete(wcId)
    })
    win.on('resized', () => {
      if (this.getSettings().rememberWindowSize && !win.isDestroyed()) {
        const bounds = win.getBounds()
        this.lastActionSize = {
          width: Math.max(320, bounds.width - ACTION_SHADOW_PADDING * 2),
          height: Math.max(240, bounds.height - ACTION_SHADOW_PADDING * 2)
        }
      }
    })
    this.actionWindows.add(win)
    loadRenderer(win, this.rendererDir, 'selectionAction.html')
    return win
  }

  // Startup prebuild: create the pooled window up
  // front so the first trigger lands on the openActionWindow reuse branch.
  //
  // The show-callback for ready-to-show is normally hung by openActionWindow's
  // creation path; a precreated window never goes through it. The bell is hung
  // here instead: on ready, if a payload already arrived (an early trigger hit
  // the reuse branch while this window was still loading), show it following
  // the trigger's own display path; otherwise stay hidden on standby.
  private precreateActionWindow(): void {
    const existing = Array.from(this.actionWindows).find(
      (win) => !win.isDestroyed() && !this.closingWindows.has(win)
    )
    if (existing) return

    const win = this.createActionWindow()
    win.once('ready-to-show', () => {
      this.readyWindows.add(win)
      if (win.isDestroyed()) return
      const payload = this.pendingInitialPayload.get(win.webContents.id)
      if (!payload) return
      const settings = this.getSettings()
      if (payload.mode === 'input') {
        this.positionActionWindowCenter(win, settings)
        win.show()
        win.focus()
      } else {
        this.positionAndShowActionWindow(win, settings)
      }
    })
  }

  private handleSelection = (selection: TextSelectionData): void => {
    const text = selection.text?.trim()
    if (!text) return
    // Selections inside our own windows are in-app edits (marking in the
    // pre-selection panel, copying answers) — not global selections. Banned by
    // the hook's event-time program name, NOT focus queries: Windows delivers
    // focus-change messages later than the selection event, so a fast
    // own-window → external-app switch used to read as "own window focused"
    // and silently dropped the selection ("toolbar works intermittently").
    // A missing programName passes through (by design: no defensive
    // focus fallback) — shouldProcessProgram passes unknown programs too.
    if (isOwnProgram(selection.programName, this.ownProgramName)) return
    const settings = this.getSettings()
    if (!settings.enabled || !shouldProcessProgram(selection.programName, settings.filterMode, settings.filterList)) {
      return
    }
    if (this.toolbarWindow?.isVisible()) return
    if (!this.toolbarReady) return

    this.createToolbarWindow()
    const { point, orientation } = this.resolveSelectionAnchor(selection)
    this.showToolbar(point, orientation, {
      text,
      programName: selection.programName,
      isFullscreen: selection.isFullscreen,
      hwnd: selection.hwnd
    })
    // The chat context follows the selection THIS toolbar attach represents —
    // not the globally latest selection. While the toolbar is visible, newer
    // selections leave it in place (early returns above), so the chat button
    // must carry exactly the selection the toolbar is attached to.
    setLastSelection({ text, programName: selection.programName })
  }

  private resolveSelectionAnchor(selection: TextSelectionData): { point: Point; orientation: Orientation } {
    const positionLevel = this.hookCtor?.PositionLevel
    let point: Point = screen.getCursorScreenPoint()
    let orientation: Orientation = 'bottomMiddle'
    let isLogical = true

    if (positionLevel && selection.posLevel === positionLevel.MOUSE_SINGLE) {
      point = { x: selection.mousePosEnd.x, y: selection.mousePosEnd.y + 16 }
      isLogical = false
    } else if (positionLevel && selection.posLevel === positionLevel.MOUSE_DUAL) {
      const yDistance = selection.mousePosEnd.y - selection.mousePosStart.y
      const xDistance = selection.mousePosEnd.x - selection.mousePosStart.x
      if (Math.abs(yDistance) > 14) {
        orientation = yDistance > 0 ? 'bottomLeft' : 'topRight'
        point = { x: selection.mousePosEnd.x, y: selection.mousePosEnd.y + (yDistance > 0 ? 16 : -16) }
      } else {
        orientation = xDistance > 0 ? 'bottomLeft' : 'bottomRight'
        point = { x: selection.mousePosEnd.x, y: Math.max(selection.mousePosEnd.y, selection.mousePosStart.y) + 16 }
      }
      isLogical = false
    } else if (
      positionLevel &&
      (selection.posLevel === positionLevel.SEL_FULL || selection.posLevel === positionLevel.SEL_DETAILED)
    ) {
      const sameLine =
        selection.startTop.y === selection.endTop.y && selection.startBottom.y === selection.endBottom.y
      const mouseDirectionY = selection.mousePosEnd.y - selection.mousePosStart.y
      if (sameLine) {
        const direction = selection.mousePosEnd.x - selection.mousePosStart.x
        orientation = direction >= 0 ? 'bottomLeft' : 'bottomRight'
        point = direction >= 0 ? selection.endBottom : selection.startBottom
      } else {
        orientation = mouseDirectionY >= 0 ? 'bottomLeft' : 'topRight'
        point = mouseDirectionY >= 0 ? selection.endBottom : selection.startTop
      }
      point = { x: point.x, y: point.y + (orientation === 'topRight' ? -4 : 4) }
      isLogical = false
    }

    if (!isLogical && isWin) point = screen.screenToDipPoint(point)
    return { point: { x: Math.round(point.x), y: Math.round(point.y) }, orientation }
  }

  private showToolbar(anchor: Point, orientation: Orientation, payload: SelectedTextPayload): void {
    if (!this.toolbarWindow || this.toolbarWindow.isDestroyed()) return
    const position = this.calculateToolbarPosition(anchor, orientation)
    this.toolbarWindow.setBounds({
      x: position.x - TOOLBAR_SHADOW_PADDING,
      y: position.y - TOOLBAR_SHADOW_PADDING,
      width: this.getToolbarWindowWidth(),
      height: this.getToolbarWindowHeight()
    })
    this.toolbarWindow.setAlwaysOnTop(true, 'screen-saver')
    this.toolbarWindow.webContents.send(IPC.SelectionSelected, payload)
    this.toolbarWindow.webContents.send(IPC.SelectionVisibility, true)
    if (isMac || isWin) {
      this.toolbarWindow.showInactive()
    } else {
      this.toolbarWindow.show()
    }
    this.startHideListeners()
  }

  private calculateToolbarPosition(anchor: Point, orientation: Orientation): Point {
    const display = screen.getDisplayNearestPoint(anchor)
    const area = display.workArea
    this.toolbarWidth = this.clampToolbarWidthForArea(this.toolbarWidth, area.width)
    let x = anchor.x - this.toolbarWidth / 2
    let y = anchor.y

    if (orientation === 'topLeft') {
      x = anchor.x - this.toolbarWidth
      y = anchor.y - TOOLBAR_HEIGHT
    } else if (orientation === 'topRight') {
      x = anchor.x
      y = anchor.y - TOOLBAR_HEIGHT
    } else if (orientation === 'topMiddle') {
      y = anchor.y - TOOLBAR_HEIGHT
    } else if (orientation === 'bottomLeft') {
      x = anchor.x - this.toolbarWidth
    } else if (orientation === 'bottomRight') {
      x = anchor.x
    }

    return {
      x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - this.toolbarWidth))),
      y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - TOOLBAR_HEIGHT)))
    }
  }

  private clampToolbarWidth(width: number): number {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    return this.clampToolbarWidthForArea(width, display.workArea.width)
  }

  private clampToolbarWidthForArea(width: number, areaWidth: number): number {
    const maxWidth = Math.max(120, areaWidth - TOOLBAR_SCREEN_MARGIN * 2)
    return Math.min(width, maxWidth)
  }

  private getToolbarWindowWidth(): number {
    return this.toolbarWidth + TOOLBAR_SHADOW_PADDING * 2
  }

  private getToolbarWindowHeight(): number {
    return TOOLBAR_HEIGHT + TOOLBAR_SHADOW_PADDING * 2
  }

  private getActionWindowWidth(width: number): number {
    return width + ACTION_SHADOW_PADDING * 2
  }

  private getActionWindowHeight(height: number): number {
    return height + ACTION_SHADOW_PADDING * 2
  }

  private positionAndShowActionWindow(win: BrowserWindow, settings: AppSettings): void {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const area = display.workArea
    const width = settings.rememberWindowSize ? this.lastActionSize.width : settings.actionWindowWidth
    const height = settings.rememberWindowSize ? this.lastActionSize.height : settings.actionWindowHeight
    let x = Math.round(area.x + (area.width - width) / 2)
    let y = Math.round(area.y + (area.height - height) / 2)

    if (settings.followToolbar && this.toolbarWindow && !this.toolbarWindow.isDestroyed()) {
      const toolbar = this.toolbarWindow.getBounds()
      x = Math.round(toolbar.x + TOOLBAR_SHADOW_PADDING + (this.toolbarWidth - width) / 2)
      y = Math.round(toolbar.y + TOOLBAR_SHADOW_PADDING + TOOLBAR_HEIGHT + 8)
      x = Math.max(area.x + 8, Math.min(x, area.x + area.width - width - 8))
      y = Math.max(area.y + 8, Math.min(y, area.y + area.height - height - 8))
    }

    win.setBounds({
      x: x - ACTION_SHADOW_PADDING,
      y: y - ACTION_SHADOW_PADDING,
      width: this.getActionWindowWidth(width),
      height: this.getActionWindowHeight(height)
    })
    if (settings.autoPin) win.setAlwaysOnTop(true)
    if (isMac && settings.autoPin) win.showInactive()
    else win.show()
  }

  private positionActionWindowCenter(win: BrowserWindow, settings: AppSettings): void {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const area = display.workArea
    const width = settings.rememberWindowSize ? this.lastActionSize.width : settings.actionWindowWidth
    const height = settings.rememberWindowSize ? this.lastActionSize.height : settings.actionWindowHeight
    const x = Math.round(area.x + (area.width - width) / 2)
    const y = Math.round(area.y + (area.height - height) / 2)
    win.setBounds({
      x: x - ACTION_SHADOW_PADDING,
      y: y - ACTION_SHADOW_PADDING,
      width: this.getActionWindowWidth(width),
      height: this.getActionWindowHeight(height)
    })
    if (settings.autoPin) win.setAlwaysOnTop(true)
  }

  private startHideListeners(): void {
    if (!this.hook || this.hideListenerActive) return
    this.hook.on('mouse-down', this.handleMouseDownHide)
    this.hook.on('mouse-wheel', this.handleHide)
    this.hook.on('key-down', this.handleKeyDownHide)
    this.hideListenerActive = true
  }

  private stopHideListeners(): void {
    if (!this.hook || !this.hideListenerActive) return
    this.hook.off('mouse-down', this.handleMouseDownHide)
    this.hook.off('mouse-wheel', this.handleHide)
    this.hook.off('key-down', this.handleKeyDownHide)
    this.hideListenerActive = false
  }

  private handleHide = (): void => this.hideToolbar()

  // Ctrl+A select-all trigger (plan D1/D2): pure-function state machine in
  // selectAllTrigger.ts tracks Ctrl held-state; the 'A' key-up with Ctrl held
  // fires the trigger chain. The listeners live for the whole service lifetime
  // (independent of toolbar visibility), unlike the hide listeners above.
  private handleSelectAllKeyDown = (event: KeyboardEventData): void => {
    this.selectAllState = stepSelectAllTrigger(this.selectAllState, event, isMac, true).state
  }

  private handleSelectAllKeyUp = (event: KeyboardEventData): void => {
    const step = stepSelectAllTrigger(this.selectAllState, event, isMac, false)
    this.selectAllState = step.state
    if (step.trigger) this.triggerSelectAllSelection()
  }

  private triggerSelectAllSelection(): void {
    const settings = this.getSettings()
    if (!settings.enabled || !settings.selectAllTrigger) return
    setTimeout(() => {
      if (!this.started || !this.hook) return
      // handleSelection drops incoming selections while the toolbar is
      // visible; hide first so Ctrl+A reads as "refresh onto the new
      // selection" instead of being silently discarded.
      this.hideToolbar()
      const selection = this.hook.getCurrentSelection()
      if (selection) this.handleSelection(selection)
    }, SELECT_ALL_READ_DELAY_MS)
  }

  private handleMouseDownHide = (event: MouseEventData): void => {
    if (!this.toolbarWindow || this.toolbarWindow.isDestroyed()) return
    const point = isWin ? screen.screenToDipPoint({ x: event.x, y: event.y }) : { x: event.x, y: event.y }
    const bounds = this.toolbarWindow.getBounds()
    const inside =
      point.x >= bounds.x + TOOLBAR_SHADOW_PADDING &&
      point.x <= bounds.x + TOOLBAR_SHADOW_PADDING + this.toolbarWidth &&
      point.y >= bounds.y + TOOLBAR_SHADOW_PADDING &&
      point.y <= bounds.y + TOOLBAR_SHADOW_PADDING + TOOLBAR_HEIGHT
    if (!inside) this.hideToolbar()
  }

  private handleKeyDownHide = (event: KeyboardEventData): void => {
    if (this.isModifierKey(event.vkCode)) return
    this.hideToolbar()
  }

  private isModifierKey(vkCode: number): boolean {
    return this.isCtrlKey(vkCode) || this.isShiftKey(vkCode) || this.isAltKey(vkCode)
  }

  private isCtrlKey(vkCode: number): boolean {
    return isCtrlKeyCode(vkCode, isMac)
  }

  private isShiftKey(vkCode: number): boolean {
    return isMac ? vkCode === 56 || vkCode === 60 : vkCode === 160 || vkCode === 161
  }

  private isAltKey(vkCode: number): boolean {
    return isMac ? vkCode === 58 || vkCode === 61 : vkCode === 164 || vkCode === 165
  }
}
