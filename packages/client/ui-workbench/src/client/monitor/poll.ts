/**
 * Tail listed JSONL logs and publish a monitor snapshot.
 * Callers pass the clock and a cursor map so a second poll only reads new bytes.
 */
import type { MonitorBridge, MonitorSnapshot } from './model.ts'
import { EMPTY_MONITOR, MONITOR_FILE_MAX, MONITOR_READ_MAX } from './model.ts'
import { createDraft, ingestLines, publishDrafts, splitChunk, type LogDraft } from './parse.ts'

/** Byte cursor and draft for one log file. */
export interface LogCursor {
  /** Next byte to read. */
  offset: number
  /** Session accumulated from this file. */
  draft: LogDraft
}

/**
 * Read newly appended log bytes and refresh file text.
 * @param bridge - read-only host bridge.
 * @param cursors - per-file cursors retained between polls.
 * @param now - clock for freshness and running detection.
 * @returns the current snapshot. A failed poll returns the last good picture.
 */
export async function pollMonitor(
  bridge: MonitorBridge,
  cursors: Map<string, LogCursor>,
  now: number,
): Promise<MonitorSnapshot> {
  const listed = await bridge.files()
  const live = new Set(listed.map(file => file.path))
  for (const path of cursors.keys()) {
    if (!live.has(path)) cursors.delete(path)
  }
  for (const file of listed) {
    let cursor = cursors.get(file.path)
    if (cursor === undefined) {
      cursor = { offset: 0, draft: createDraft({ path: file.path, product: file.product }) }
      cursors.set(file.path, cursor)
    }
    let chunk = await bridge.read(file.path, cursor.offset, MONITOR_READ_MAX)
    if (chunk !== null && chunk.size < cursor.offset) {
      cursor.offset = 0
      cursor.draft = createDraft({ path: file.path, product: file.product })
      chunk = await bridge.read(file.path, 0, MONITOR_READ_MAX)
    }
    if (chunk === null || chunk.bytes === 0) continue
    const eof = cursor.offset + chunk.bytes >= chunk.size
    const split = splitChunk(chunk.text, chunk.bytes, eof)
    if (split.advance === 0) continue
    ingestLines(cursor.draft, split.complete, now)
    cursor.offset += split.advance
  }
  const drafts = [...cursors.values()].map(cursor => cursor.draft)
  for (const draft of drafts) {
    for (const file of draft.files) {
      if (file.content !== '') continue
      const text = await bridge.readText(file.path, MONITOR_FILE_MAX)
      if (text === null || text === '') continue
      const index = draft.files.indexOf(file)
      draft.files[index] = { ...file, content: text }
    }
  }
  if (drafts.length === 0) return EMPTY_MONITOR
  return publishDrafts(drafts, now)
}
