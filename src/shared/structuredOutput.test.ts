import { describe, expect, it } from 'vitest'
import {
  extractPartialReplacement,
  parseStructuredReplacement,
  REPLACEMENT_SCHEMA,
  buildStructuredOutputPrompt
} from './structuredOutput'

describe('parseStructuredReplacement', () => {
  it('parses a clean JSON payload with replacement and note', () => {
    const raw = '{"replacement":"改写后的文本","note":"第 2 句改为主动语态"}'
    const parsed = parseStructuredReplacement(raw)
    expect(parsed).toEqual({
      replacement: '改写后的文本',
      note: '第 2 句改为主动语态',
      degraded: false
    })
  })

  it('normalizes an empty or whitespace-only note to null', () => {
    const parsed = parseStructuredReplacement('{"replacement":"text","note":"   "}')
    expect(parsed.note).toBeNull()
    expect(parsed.degraded).toBe(false)
  })

  it('rejects a payload whose replacement is not a string', () => {
    const parsed = parseStructuredReplacement('{"replacement":42,"note":null}')
    expect(parsed.degraded).toBe(true)
    expect(parsed.replacement).toBe('{"replacement":42,"note":null}')
  })

  it('recovers JSON wrapped in a markdown fence (fence packaging)', () => {
    const raw = '```json\n{"replacement":"clean text","note":null}\n```'
    const parsed = parseStructuredReplacement(raw)
    expect(parsed).toEqual({ replacement: 'clean text', note: null, degraded: false })
  })

  it('recovers JSON followed by trailing chatter (话痨尾巴 failure mode)', () => {
    const raw = '{"replacement":"clean text","note":null}\\n\\n以上就是改写结果，希望对你有帮助！'
    const parsed = parseStructuredReplacement(raw)
    expect(parsed).toEqual({ replacement: 'clean text', note: null, degraded: false })
  })

  it('falls back to the raw text verbatim when no JSON can be recovered', () => {
    const raw = '这是纯粹的散文回答，没有任何 JSON 结构。'
    const parsed = parseStructuredReplacement(raw)
    expect(parsed).toEqual({ replacement: raw, note: null, degraded: true })
  })

  it('falls back verbatim on truncated JSON (unbalanced braces)', () => {
    const raw = '{"replacement":"被截断的输出'
    const parsed = parseStructuredReplacement(raw)
    expect(parsed).toEqual({ replacement: raw, note: null, degraded: true })
  })

  it('keeps braces inside string literals from breaking balanced extraction', () => {
    const raw = '前缀废话 {"replacement":"文本里有 { 花括号 } 也没事","note":null} 尾巴}'
    const parsed = parseStructuredReplacement(raw)
    expect(parsed).toEqual({
      replacement: '文本里有 { 花括号 } 也没事',
      note: null,
      degraded: false
    })
  })
})

describe('extractPartialReplacement', () => {
  it('returns null before the replacement key appears', () => {
    expect(extractPartialReplacement('{"repl')).toBeNull()
    expect(extractPartialReplacement('{"note": "x", ')).toBeNull()
  })

  it('returns the partial value while the string is streaming', () => {
    const acc = '{"replacement":"正在流式输出的文'
    expect(extractPartialReplacement(acc)).toBe('正在流式输出的文')
  })

  it('returns the complete value once the closing quote lands', () => {
    const acc = '{"replacement":"完整文本","note":"理由"}'
    expect(extractPartialReplacement(acc)).toBe('完整文本')
  })

  it('resolves simple escapes inside the streaming value', () => {
    const acc = '{"replacement":"第一行\\n第二行 \\"引话\\"'
    expect(extractPartialReplacement(acc)).toBe('第一行\n第二行 "引话"')
  })

  it('degrades to null on an incomplete unicode escape', () => {
    expect(extractPartialReplacement('{"replacement":"换行\\u00')).toBeNull()
  })

  it('degrades to null on an unknown escape sequence', () => {
    expect(extractPartialReplacement('{"replacement":"奇怪\\q转义')).toBeNull()
  })
})

describe('schema and prompt contract', () => {
  it('declares both fields required with replacement first (stream order)', () => {
    const keys = Object.keys(REPLACEMENT_SCHEMA.properties)
    expect(keys[0]).toBe('replacement')
    expect(REPLACEMENT_SCHEMA.required).toEqual(['replacement', 'note'])
    expect(REPLACEMENT_SCHEMA.additionalProperties).toBe(false)
  })

  it('prompt instructs JSON-only output without consumer-side vocabulary', () => {
    const prompt = buildStructuredOutputPrompt()
    expect(prompt).toContain('"replacement"')
    expect(prompt).toContain('"note"')
    expect(prompt).not.toContain('paste-back')
    expect(prompt).not.toContain('替换')
  })
})
