// Shared contract for structured LLM output on the replace-capable action
// (issue #7 follow-up: the paste-back surface must be exactly the rewritten
// text, never the model's commentary mixed in).

/** Server-side structuring strength, user-selectable in settings. No single
 * mechanism works across providers (Zhipu silently ignores
 * json_schema, DeepSeek chat rejects it with 400), so the choice is explicit
 * and failures are loud — there is deliberately no automatic downgrade. */
export type StructuredOutputMode = 'off' | 'json_object' | 'json_schema'

export const DEFAULT_STRUCTURED_OUTPUT_MODE: StructuredOutputMode = 'json_schema'

/** Only the polish action is replace-capable today. Single source of truth for
 * the renderer request flag; main-side prompt injection keys off the flag, not
 * this list. */
export const STRUCTURED_OUTPUT_ACTION_IDS: readonly string[] = ['polish']

// OpenAI strict-style schema: every field required, optionality expressed via
// a nullable type (strict mode rejects "sometimes absent" fields). The
// `replacement` key is placed first because providers preserve key order — that
// lets the renderer stream the replacement value out before `note` arrives.
export const REPLACEMENT_SCHEMA = {
  type: 'object',
  properties: {
    replacement: {
      type: 'string',
      description:
        'The rewritten/translated text, exactly as it should appear in place of the original text.'
    },
    note: {
      type: ['string', 'null'],
      description:
        'Brief reason for the changes you made (word choices, structural adjustments), or null when nothing is worth pointing out.'
    }
  },
  required: ['replacement', 'note'],
  additionalProperties: false
} as const

// Prompt-layer instruction (works on every provider, unlike response_format).
// Worded from the model's perspective — it never needs to know about the
// paste-back consumer on the other side.
export function buildStructuredOutputPrompt(): string {
  return [
    'Output format: respond with a single JSON object and nothing else — no markdown fences, no prose before or after it.',
    'Shape: {"replacement": string, "note": string | null}',
    '- "replacement": your rewritten/translated text, exactly as it should replace the original text. Never include explanations, labels, prefixes like "Rewritten:" or any commentary inside it.',
    '- "note": optional. When your rewriting involved choices worth knowing (why you changed something, term choices, structural adjustments), state them briefly here. Use null when there is nothing worth saying — do not invent filler.'
  ].join('\n')
}

export interface ReplacementPayload {
  replacement: string
  note: string | null
}

export interface ParsedReplacement extends ReplacementPayload {
  // true = the model did not return the expected JSON shape; replacement holds
  // the raw output verbatim, identical to the legacy full-text behavior.
  degraded: boolean
}

// Parse the final model output into the replacement payload. Repair attempts
// only strip JSON *packaging* (fences, trailing prose) — the replacement string
// itself is never touched: this is structural recovery, not semantic cleanup.
export function parseStructuredReplacement(raw: string): ParsedReplacement {
  const direct = tryParseReplacementObject(raw)
  if (direct) return { ...direct, degraded: false }
  const candidate = extractBalancedJsonObject(raw)
  if (candidate) {
    const repaired = tryParseReplacementObject(candidate)
    if (repaired) return { ...repaired, degraded: false }
  }
  return { replacement: raw, note: null, degraded: true }
}

// Incrementally pull the visible `replacement` value out of a partially
// streamed JSON text, so the renderer can show the rewritten text as it
// arrives instead of raw JSON. Returns null when the value cannot be
// determined yet (key not reached, unsupported escape) — callers then fall
// back to showing the raw stream.
export function extractPartialReplacement(acc: string): string | null {
  const keyIndex = acc.indexOf('"replacement"')
  if (keyIndex === -1) return null
  const colonIndex = acc.indexOf(':', keyIndex + '"replacement"'.length)
  if (colonIndex === -1) return null
  let i = colonIndex + 1
  while (i < acc.length && /\s/.test(acc[i])) i++
  if (i >= acc.length || acc[i] !== '"') return null
  i++ // step past the opening quote into the value
  let visible = ''
  while (i < acc.length) {
    const ch = acc[i]
    if (ch === '"') return visible // closing quote: value complete
    if (ch === '\\') {
      const resolved = resolveJsonEscape(acc, i)
      if (!resolved) return null // incomplete or unknown escape → degrade
      visible += resolved.text
      i = resolved.nextIndex
      continue
    }
    visible += ch
    i++
  }
  return visible // value still streaming (no closing quote yet)
}

// Resolves the escape sequence starting at acc[start] (the backslash itself).
// Returns null while the sequence is incomplete mid-stream or unknown.
function resolveJsonEscape(acc: string, start: number): { text: string; nextIndex: number } | null {
  const kind = acc[start + 1]
  if (kind === undefined) return null
  const simpleEscapes: Record<string, string> = {
    '"': '"',
    '\\': '\\',
    '/': '/',
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t'
  }
  const simpleText = simpleEscapes[kind]
  if (simpleText !== undefined) return { text: simpleText, nextIndex: start + 2 }
  if (kind === 'u') {
    const hex = acc.slice(start + 2, start + 6)
    if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) return null
    return { text: String.fromCharCode(parseInt(hex, 16)), nextIndex: start + 6 }
  }
  return null
}

// Finds the first balanced {...} object in raw text, ignoring braces inside
// string literals. Recovers JSON wrapped in markdown fences or followed by
// prose (the "trailing chatter" failure mode seen in provider-acceptance
// experiments).
function extractBalancedJsonObject(raw: string): string | null {
  const start = raw.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (inString) {
      if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return raw.slice(start, i + 1)
    }
  }
  return null
}

function tryParseReplacementObject(text: string): ReplacementPayload | null {
  try {
    const value = JSON.parse(text) as unknown
    if (typeof value !== 'object' || value === null) return null
    const record = value as Record<string, unknown>
    if (typeof record.replacement !== 'string') return null
    const note = typeof record.note === 'string' && record.note.trim().length > 0 ? record.note : null
    return { replacement: record.replacement, note }
  } catch {
    return null
  }
}
