import '../styles.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { buildSearchUrl } from '@shared/actions'
import { APP_ICON_SVG } from '@shared/brand'
import type { ActionItem, SelectedTextPayload } from '@shared/types'
import { Icon } from '../icons'
import { useSettings } from '../useSettings'
import { useThemeMode } from '../useThemeMode'
import { getActionLabel } from '../i18n'

function ToolbarApp() {
  const { settings } = useSettings()
  const [selection, setSelection] = React.useState<SelectedTextPayload | null>(null)
  const rootRef = React.useRef<HTMLDivElement>(null)
  useThemeMode(settings.theme)

  React.useEffect(() => {
    document.documentElement.classList.add('toolbar-page-root')
    document.body.classList.add('toolbar-page')
    return () => {
      document.documentElement.classList.remove('toolbar-page-root')
      document.body.classList.remove('toolbar-page')
    }
  }, [])

  React.useEffect(() => window.assistantLite.selection.onSelected(setSelection), [])
  React.useEffect(() => {
    const measure = () => {
      const root = rootRef.current
      if (!root) return
      const width = Math.max(root.scrollWidth, root.getBoundingClientRect().width)
      if (width > 0) void window.assistantLite.selection.determineToolbarSize(width)
    }

    const frame = window.requestAnimationFrame(measure)
    return () => window.cancelAnimationFrame(frame)
  }, [settings.compactToolbar, settings.showToolbarAppIcon, settings.actions])

  const enabledActions = settings.actions.filter((action) => action.enabled)

  // The pre-select ("quote") action gives brief saved feedback on the
  // button itself, then the toolbar goes away — no result window opens.
  const [quotedActionId, setQuotedActionId] = React.useState<string | null>(null)

  const handleAction = async (action: ActionItem) => {
    const selectedText = selection?.text ?? ''
    if (!selectedText) return

    if (action.type === 'quote') {
      await window.assistantLite.preWindow.save({
        text: selectedText,
        programName: selection?.programName
      })
      // Feedback keys on the action id (what the button renders), not the
      // pool entry id — the two id spaces never intersect.
      setQuotedActionId(action.id)
      setTimeout(() => {
        setQuotedActionId(null)
        void window.assistantLite.selection.hideToolbar()
      }, 500)
      return
    }

    if (action.type === 'copy') {
      await window.assistantLite.selection.writeClipboard(selectedText)
      return
    }

    if (action.type === 'search') {
      const url = buildSearchUrl(action, selectedText)
      if (url) await window.assistantLite.app.openExternal(url)
      await window.assistantLite.selection.hideToolbar()
      return
    }

    if (action.type === 'speak') {
      await window.assistantLite.speech.speak(selectedText)
      await window.assistantLite.selection.hideToolbar()
      return
    }

    await window.assistantLite.selection.processAction({
      action,
      selectedText,
      programName: selection?.programName,
      isFullscreen: selection?.isFullscreen,
      hwnd: selection?.hwnd
    })
    await window.assistantLite.selection.hideToolbar()
  }

  return (
    <div className="toolbar-root" ref={rootRef}>
      {settings.showToolbarAppIcon && <div className="toolbar-logo" dangerouslySetInnerHTML={{ __html: APP_ICON_SVG }} />}
      {enabledActions.map((action) => (
        <button
          className={`toolbar-button${quotedActionId === action.id ? ' toolbar-button--quoted' : ''}`}
          key={action.id}
          title={getActionLabel(action, settings.language)}
          onClick={() => void handleAction(action)}>
          <Icon name={action.icon} />
          {!settings.compactToolbar && <span>{getActionLabel(action, settings.language)}</span>}
        </button>
      ))}
      {/* Fixed entry, not part of the configurable action list: pools the
          triggering selection (so it survives as a chip with marks) and opens
          the chat window — the unified rule's "point at it and ask". */}
      <button
        className="toolbar-button"
        title={settings.language === 'zh-CN' ? '对话' : 'Chat'}
        onClick={() => {
          void (async () => {
            const selectedText = selection?.text ?? ''
            if (selectedText) {
              await window.assistantLite.preWindow.save({
                text: selectedText,
                programName: selection?.programName
              })
            }
            await window.assistantLite.chat.open()
            await window.assistantLite.selection.hideToolbar()
          })()
        }}>
        <Icon name="message-circle" />
        {!settings.compactToolbar && <span>{settings.language === 'zh-CN' ? '对话' : 'Chat'}</span>}
      </button>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToolbarApp />
  </React.StrictMode>
)
