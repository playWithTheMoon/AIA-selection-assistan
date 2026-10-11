import React from 'react'
import { markNumberLabel, type NumberedMark } from './PreSelectionPanel'

// @ picker: typing "@" opens this list of pooled marks ("@ 选人" 的标记版).
// Standard mention keyboard model handled by the parent (arrows move the
// active row, Enter/Tab picks, Esc closes); this component renders rows and
// syncs hover with the active index.

interface MarkPickerProps {
  marks: NumberedMark[]
  activeIndex: number
  /** Shown when marks is empty (no marks / none citable / query mismatch). */
  emptyHint: string
  onHover: (index: number) => void
  onPick: (mark: NumberedMark) => void
  onClose: () => void
}

export function MarkPicker({ marks, activeIndex, emptyHint, onHover, onPick, onClose }: MarkPickerProps) {
  const listRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    listRef.current?.querySelector('.mark-picker__item--active')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (marks.length === 0) {
    return (
      <div className="mark-picker">
        <div className="mark-picker__empty">{emptyHint}</div>
      </div>
    )
  }

  return (
    <div className="mark-picker" ref={listRef}>
      {marks.map((mark, index) => (
        <button
          key={mark.markId}
          className={`mark-picker__item${index === activeIndex ? ' mark-picker__item--active' : ''}`}
          onMouseEnter={() => onHover(index)}
          onClick={() => {
            onPick(mark)
            onClose()
          }}>
          <span className="mark-picker__num">{markNumberLabel(mark.number)}</span>
          <span className="mark-picker__snippet">
            {mark.snippet.length > 32 ? `${mark.snippet.slice(0, 32)}…` : mark.snippet}
          </span>
        </button>
      ))}
    </div>
  )
}
