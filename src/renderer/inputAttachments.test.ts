import { describe, expect, it } from 'vitest'
import { historyTurnMessages, imageFilesFromItems, userMessageWithImages } from './inputAttachments'

function fakeItem(kind: string, type: string, file: File | null) {
  return { kind, type, getAsFile: () => file }
}

const fakePngFile = () => new File(['fake-png-bytes'], 'shot.png', { type: 'image/png' })

describe('imageFilesFromItems', () => {
  it('collects image file items and skips text items', () => {
    const png = fakePngFile()
    const items = [
      fakeItem('string', 'text/plain', null),
      fakeItem('file', 'image/png', png),
      fakeItem('file', 'text/html', null)
    ]
    expect(imageFilesFromItems(items)).toEqual([png])
  })

  it('skips file items whose getAsFile yields null', () => {
    const items = [fakeItem('file', 'image/png', null)]
    expect(imageFilesFromItems(items)).toEqual([])
  })

  it('returns empty for null/undefined/empty item lists', () => {
    expect(imageFilesFromItems(null)).toEqual([])
    expect(imageFilesFromItems(undefined)).toEqual([])
    expect(imageFilesFromItems([])).toEqual([])
  })
})

describe('userMessageWithImages', () => {
  it('omits the images field entirely for a text-only message', () => {
    expect(userMessageWithImages('hello', [])).toEqual({ role: 'user', text: 'hello' })
  })

  it('attaches a copied image list when images are present', () => {
    const message = userMessageWithImages('hello', ['data:image/png;base64,AAA'])
    expect(message).toEqual({
      role: 'user',
      text: 'hello',
      images: ['data:image/png;base64,AAA']
    })
  })

  it('copies the image list so later caller mutation cannot alter the message', () => {
    const pending = ['data:image/png;base64,AAA']
    const message = userMessageWithImages('hello', pending)
    pending.push('data:image/png;base64,BBB')
    expect(message.images).toEqual(['data:image/png;base64,AAA'])
  })

  it('allows an image-only send with empty text', () => {
    const message = userMessageWithImages('', ['data:image/png;base64,AAA'])
    expect(message.text).toBe('')
    expect(message.images).toEqual(['data:image/png;base64,AAA'])
  })
})

describe('historyTurnMessages', () => {
  it('re-sends images attached to earlier turns', () => {
    const messages = historyTurnMessages([
      { role: 'user', text: 'first', images: ['data:image/png;base64,AAA'] },
      { role: 'assistant', text: 'answer' },
      { role: 'user', text: 'follow-up' }
    ])
    expect(messages).toEqual([
      { role: 'user', text: 'first', images: ['data:image/png;base64,AAA'] },
      { role: 'assistant', text: 'answer' },
      { role: 'user', text: 'follow-up' }
    ])
  })

  it('omits the images field for turns without images (text-only request unchanged)', () => {
    const messages = historyTurnMessages([{ role: 'user', text: 'plain' }])
    expect(messages).toEqual([{ role: 'user', text: 'plain' }])
    expect('images' in messages[0]).toBe(false)
  })

  it('omits images when a turn carries an empty image list', () => {
    const messages = historyTurnMessages([{ role: 'user', text: 'plain', images: [] }])
    expect('images' in messages[0]).toBe(false)
  })

  it('prefers fullText over text (chat context block)', () => {
    const messages = historyTurnMessages([{ role: 'user', text: 'shown', fullText: 'context+shown' }])
    expect(messages[0].text).toBe('context+shown')
  })

  it('does not copy or mutate the stored turn image arrays', () => {
    const images = ['data:image/png;base64,AAA']
    const messages = historyTurnMessages([{ role: 'user', text: 'first', images }])
    images.push('data:image/png;base64,BBB')
    expect(messages[0].images).toBe(images)
  })
})
