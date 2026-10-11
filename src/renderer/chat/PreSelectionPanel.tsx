import React from 'react'
import type { LastSelection, PreWindowEntry, PreWindowMark } from '@shared/types'
import { Icon } from '../icons'

// Pre-selection panel: pooled entries as chips (expandable for marking),
// plus a dismissible paper slip for the latest raw selection (统一规则：AI 默认
// 看最后一次划词的内容——进过池带池条，没进池带纸条).

export interface NumberedMark {
  number: number
  entryId: string
  markId: string
  start: number
  end: number
  snippet: string
}

/** Number every mark across the pool in creation order (first marked = ①, crossing entries). Used by both highlight rendering and the @ picker so numbers always agree. */
export function numberAllMarks(
  entries: PreWindowEntry[],
  marksByEntry: Record<string, PreWindowMark[]>
): NumberedMark[] {
  const flat: { entry: PreWindowEntry; mark: PreWindowMark }[] = []
  for (const entry of entries) {
    for (const mark of marksByEntry[entry.id] ?? []) flat.push({ entry, mark })
  }
  // Creation time decides; same-millisecond marks fall back to text position.
  flat.sort((a, b) => a.mark.createdAt - b.mark.createdAt || a.mark.start - b.mark.start)
  return flat.map(({ entry, mark }, index) => ({
    number: index + 1,
    entryId: entry.id,
    markId: mark.id,
    start: mark.start,
    end: mark.end,
    snippet: entry.text.slice(mark.start, mark.end)
  }))
}

/** ①②… up to 20, then [21] style. */
export function markNumberLabel(number_: number): string {
  const circled = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
  return number_ <= 20 ? circled[number_ - 1] : `[${number_}]`
}

/** Walk the container's text nodes and return the character offset of (node, offset). Keeps marks stable no matter how many <mark> spans the render introduces. */
function textOffsetInContainer(container: HTMLElement, node: Node, offset: number): number {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let total = 0
  let current = walker.nextNode()
  while (current) {
    if (current === node) return total + offset
    total += current.textContent?.length ?? 0
    current = walker.nextNode()
  }
  return total
}

interface Segment {
  text: string
  mark?: PreWindowMark
}

function buildSegments(text: string, marks: PreWindowMark[]): Segment[] {
  const sorted = [...marks].sort((a, b) => a.start - b.start)
  const segments: Segment[] = []
  let cursor = 0
  for (const mark of sorted) {
    if (mark.start < cursor || mark.start > mark.end) continue
    if (mark.start > cursor) segments.push({ text: text.slice(cursor, mark.start) })
    segments.push({ text: text.slice(mark.start, mark.end), mark })
    cursor = mark.end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) })
  return segments
}

interface EntryViewProps {
  entry: PreWindowEntry
  marks: PreWindowMark[]
  numbersByMarkId: Map<string, number>
  checked: boolean
  expanded: boolean
  isLatest: boolean
  onToggleChecked: () => void
  onRemove: () => void
  onToggleExpanded: () => void
  onAddMark: (start: number, end: number) => boolean
  onRemoveMark: (markId: string) => void
  isZh: boolean
}

function EntryView({
  entry,
  marks,
  numbersByMarkId,
  checked,
  expanded,
  isLatest,
  onToggleChecked,
  onRemove,
  onToggleExpanded,
  onAddMark,
  onRemoveMark,
  isZh
}: EntryViewProps) {
  const contentRef = React.useRef<HTMLDivElement>(null)

  const handleMouseUp = () => {
    const container = contentRef.current
    const selection = window.getSelection()
    if (!container || !selection || selection.isCollapsed) return
    const anchor = selection.anchorNode
    const focus = selection.focusNode
    if (!anchor || !focus || !container.contains(anchor) || !container.contains(focus)) return
    const startOffset = textOffsetInContainer(container, anchor, selection.anchorOffset)
    const endOffset = textOffsetInContainer(container, focus, selection.focusOffset)
    const start = Math.min(startOffset, endOffset)
    const end = Math.max(startOffset, endOffset)
    if (end > start) {
      // Clear the selection only when the mark was accepted — a refused
      // (overlapping) selection stays visible as natural feedback.
      if (onAddMark(start, end)) selection.removeAllRanges()
    }
  }

  const segments = buildSegments(entry.text, marks)
  const preview = entry.text.length > 48 ? `${entry.text.slice(0, 48)}…` : entry.text

  return (
    <div className={`pre-entry${expanded ? ' pre-entry--expanded' : ''}`}>
      <div className="pre-entry__row">
        <label className="pre-entry__check" title={isZh ? '引用此条' : 'Include this entry'}>
          <input type="checkbox" checked={checked} onChange={onToggleChecked} />
        </label>
        <button className="pre-entry__main" onClick={onToggleExpanded} title={isZh ? '展开标记' : 'Expand to mark'}>
          {isLatest && <span className="pre-entry__latest">{isZh ? '最新' : 'latest'}</span>}
          <span className="pre-entry__preview">{preview}</span>
        </button>
      </div>
      {expanded && (
        <div className="pre-entry__body">
          <div className="pre-entry__text" ref={contentRef} onMouseUp={handleMouseUp}>
            {segments.map((segment, index) =>
              segment.mark ? (
                // The number renders via CSS ::after(attr), NOT as text inside
                // <mark> — a real text node here would shift every later
                // textOffsetInContainer conversion (off-by-one on the marks
                // created after it).
                <mark key={index} className="pre-entry__mark" data-num={markNumberLabel(numbersByMarkId.get(segment.mark.id) ?? 0)}>
                  {segment.text}
                </mark>
              ) : (
                <React.Fragment key={index}>{segment.text}</React.Fragment>
              )
            )}
          </div>
          <div className="pre-entry__hint">
            {isZh ? '划选文字打标记' : 'Select text to mark it'}
            {marks.length > 0 && (
              <span className="pre-entry__marklist">
                {marks.map((mark) => (
                  <button
                    key={mark.id}
                    className="pre-entry__marktag"
                    title={isZh ? '移除标记' : 'Remove mark'}
                    onClick={() => onRemoveMark(mark.id)}>
                    {markNumberLabel(numbersByMarkId.get(mark.id) ?? 0)} {entry.text.slice(mark.start, mark.end).slice(0, 16)}
                    <Icon name="x" size={10} />
                  </button>
                ))}
              </span>
            )}
          </div>
          {/* Removal lives inside the expanded view (by design): expand =
              intentionally managing this entry, so a stray click can't delete
              it from the collapsed row. */}
          <button className="pre-entry__remove-entry" onClick={onRemove}>
            {isZh ? '移除此条' : 'Remove entry'}
          </button>
        </div>
      )}
    </div>
  )
}

interface PreSelectionPanelProps {
  entries: PreWindowEntry[]
  lastSelection: LastSelection | null
  paperDismissed: boolean
  marksByEntry: Record<string, PreWindowMark[]>
  /** Inverted: entries here do NOT ship; everything else ships by default. */
  uncheckedIds: Set<string>
  expandedId: string | null
  isZh: boolean
  onToggleChecked: (id: string) => void
  onRemoveEntry: (id: string) => void
  onToggleExpanded: (id: string | null) => void
  onAddMark: (entryId: string, start: number, end: number) => boolean
  onRemoveMark: (entryId: string, markId: string) => void
  onDismissPaper: () => void
}

export function PreSelectionPanel({
  entries,
  lastSelection,
  paperDismissed,
  marksByEntry,
  uncheckedIds,
  expandedId,
  isZh,
  onToggleChecked,
  onRemoveEntry,
  onToggleExpanded,
  onAddMark,
  onRemoveMark,
  onDismissPaper
}: PreSelectionPanelProps) {
  const numbered = numberAllMarks(entries, marksByEntry)
  const numbersByMarkId = new Map(numbered.map((item) => [item.markId, item.number]))
  const latestText = lastSelection?.text ?? ''
  // The paper slip shows the latest selection only while it is NOT pooled —
  // once pre-selected the entry itself carries it (统一规则).
  const pooledTexts = new Set(entries.map((entry) => entry.text))
  const showPaper = !paperDismissed && !!latestText && !pooledTexts.has(latestText)

  if (entries.length === 0 && !showPaper) return null

  return (
    <div className="pre-panel">
      {entries.map((entry) => (
        <EntryView
          key={entry.id}
          entry={entry}
          marks={marksByEntry[entry.id] ?? []}
          numbersByMarkId={numbersByMarkId}
          checked={!uncheckedIds.has(entry.id)}
          expanded={expandedId === entry.id}
          isLatest={latestText === entry.text}
          onToggleChecked={() => onToggleChecked(entry.id)}
          onRemove={() => onRemoveEntry(entry.id)}
          onToggleExpanded={() => onToggleExpanded(expandedId === entry.id ? null : entry.id)}
          onAddMark={(start, end) => onAddMark(entry.id, start, end)}
          onRemoveMark={(markId) => onRemoveMark(entry.id, markId)}
          isZh={isZh}
        />
      ))}
      {showPaper && (
        <div className="pre-paper">
          <span className="pre-paper__label">{isZh ? '上次划词' : 'Last selection'}</span>
          <span className="pre-paper__preview">
            {latestText.length > 48 ? `${latestText.slice(0, 48)}…` : latestText}
          </span>
          <button className="pre-entry__remove" onClick={onDismissPaper} title={isZh ? '不带这句' : 'Drop it'}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
