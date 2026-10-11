import { BrowserWindow } from 'electron'
import { join } from 'node:path'

// Single copy of the "load a renderer page into a window" wiring — formerly
// duplicated in index.ts, SelectionService and ScreenshotService. All windows
// resolve the dev-server URL vs the packaged file identically; keeping one
// copy means a change to that resolution happens in exactly one place.
export function loadRenderer(win: BrowserWindow, rendererDir: string, page: string): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}`)
  } else {
    void win.loadFile(join(rendererDir, page))
  }
}
