import React from 'react'
import type { AiMessageInput } from '@shared/types'
import { Icon } from './icons'

// Image attachments. Shared by three input boxes (chat, action
// follow-up, screenshot follow-up). Two entry paths feed the same state:
// paste (ClipboardEvent items, read here in the renderer) and the attach
// button (main-side clipboard.readImage via IPC). Attachments are dataURL
// strings — the same shape AiMessageInput.images and the screenshot preview
// already use downstream.

/** Minimal structural view of clipboard items so tests can pass plain objects. */
interface ClipboardItemView {
  kind: string
  type: string
  getAsFile: () => File | null
}

/** Collect image files from clipboard item data. Non-image items are ignored. */
export function imageFilesFromItems(items: ClipboardItemView[] | null | undefined): File[] {
  const imageFiles: File[] = []
  if (!items) return imageFiles
  for (const item of items) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) imageFiles.push(file)
  }
  return imageFiles
}

/** Renderer entry: image files from a paste event. Empty when the paste is text-only. */
export function imageFilesFromPaste(event: React.ClipboardEvent): File[] {
  const items = event.clipboardData?.items
  if (!items) return []
  const itemList: ClipboardItemView[] = []
  for (let index = 0; index < items.length; index++) {
    itemList.push(items[index])
  }
  return imageFilesFromItems(itemList)
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function filesToDataUrls(files: File[]): Promise<string[]> {
  return Promise.all(files.map((file) => fileToDataUrl(file)))
}

/**
 * Build the outgoing user message. Images are copied (not referenced) so a
 * later mutation of the caller's attachment state cannot alter sent history.
 * An empty image list omits the field entirely — the request is then
 * byte-identical to the text-only message.
 */
export function userMessageWithImages(text: string, images: string[]): AiMessageInput {
  if (images.length === 0) return { role: 'user', text }
  return { role: 'user', text, images: [...images] }
}

/**
 * Translate stored conversation turns into request messages. Images attached
 * to an earlier turn ride again so follow-up requests can still see them;
 * turns without images omit the field (byte-identical to the text-only
 * request). `fullText` (chat-only context block included) wins over `text`
 * when present. Does not cover the screenshot window's first-turn image —
 * that one rides on the payload, not on stored turns.
 */
export function historyTurnMessages(
  turns: { role: 'user' | 'assistant'; text: string; fullText?: string; images?: string[] }[]
): AiMessageInput[] {
  return turns.map((turn) => ({
    role: turn.role,
    text: turn.fullText ?? turn.text,
    ...(turn.images?.length ? { images: turn.images } : {})
  }))
}

/** Thumbnail row for pending attachments, rendered above the input box. */
export function AttachmentStrip({
  images,
  onRemove,
  isZh
}: {
  images: string[]
  onRemove: (index: number) => void
  isZh: boolean
}) {
  if (images.length === 0) return null
  return (
    <div className="attachment-strip">
      {images.map((dataUrl, index) => (
        <div key={index} className="attachment-thumb">
          <img src={dataUrl} alt="" />
          <button
            className="attachment-remove"
            title={isZh ? '移除' : 'Remove'}
            onClick={() => onRemove(index)}>
            <Icon name="x" size={11} />
          </button>
        </div>
      ))}
    </div>
  )
}
