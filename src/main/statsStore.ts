import { app } from 'electron'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { StatsDetailLevel } from '@shared/types'

/**
 * One usage record: metadata plus full original content. Append-only
 * JSONL — the store has no read API on purpose, keeping the stats store out of
 * the request path entirely.
 */
export interface StatsRecord {
  /** ISO timestamp taken when the request entered the AI handler. */
  timestamp: string
  programName?: string
  actionName: string
  actionType: string
  textLength: number
  outcome: 'complete' | 'truncated'
  durationMs: number
  selectedText: string
  responseText: string
}

function statsFilePath(): string {
  return join(app.getPath('userData'), 'stats.jsonl')
}

/**
 * Append one record as a single JSON line. Failures are logged and swallowed:
 * stats are a background nicety and must never disturb the action that
 * produced them. 'noSource' detail drops the source app name before writing.
 */
export async function appendStatsRecord(record: StatsRecord, detail: StatsDetailLevel): Promise<void> {
  try {
    const entry: StatsRecord =
      detail === 'noSource' ? { ...record, programName: undefined } : record
    await appendFile(statsFilePath(), `${JSON.stringify(entry)}\n`, 'utf8')
  } catch (error) {
    console.warn('[stats] append failed:', error instanceof Error ? error.message : error)
  }
}
