/**
 * Fold a desktop Session event window into workbench steps, a trace, and a file.
 * The source is ordinary session activity (`todo/write`, `tool/call`, `tool/result`),
 * not the workflow engine. A `todo/write` list becomes the steps; otherwise each
 * turn is one step. `write`, `edit`, and an `apply_patch` add-file update the file.
 */

/** One durable session event the fold reads. Extra fields are ignored. */
export interface ActivityEvent {
  /** Event name. */
  readonly type: string
  /** Unix epoch milliseconds. */
  readonly time: number
  /** Event payload. */
  readonly data: unknown
}

/** One workflow step. An empty title uses the turn number or the waiting label. */
export interface ActivityStep {
  /** Stable row identity. */
  readonly id: string
  /** Model or user text. Empty when the shell should use a dictionary label. */
  readonly title: string
  /** Turn number used when `title` is empty and this step is a turn. */
  readonly turn?: number
  /** Row state. */
  readonly status: 'done' | 'active' | 'waiting' | 'error'
  /** Local clock `HH:mm`, present once the step has a timestamp. */
  readonly time?: string
  /** Detail line under the active step. */
  readonly detail?: 'writing' | 'editing'
  /** Path named by `detail`. */
  readonly path?: string
}

/** One execution-trace row. */
export interface ActivityTrace {
  /** Tool-call identity. */
  readonly id: string
  /** Tool name shown as the kind chip. */
  readonly kind: string
  /** Which dictionary template the shell uses. */
  readonly action: 'write' | 'edit' | 'todo' | 'call'
  /** File path, when the call names one. */
  readonly path?: string
  /** Edited line span, such as `18-42`. */
  readonly lines?: string
  /** Local clock `HH:mm:ss`. */
  readonly time: string
  /** Whether the matching result has arrived. */
  readonly status: 'running' | 'done' | 'error'
}

/** File the editor shows. */
export interface ActivityFile {
  /** Path from the tool call. */
  readonly path: string
  /** Path segments for the breadcrumb. */
  readonly crumbs: readonly string[]
  /** Short extension label. */
  readonly badge: string
  /** File text split into lines, capped for the pane. */
  readonly lines: readonly string[]
  /** 1-based lines marked as just written. */
  readonly annotated: readonly number[]
  /** 1-based cursor line. */
  readonly cursorLine: number
  /** 1-based cursor column. */
  readonly cursorColumn: number
}

/** Workbench projection of one event window. */
export interface ActivityModel {
  /** Steps. A session with no turns yet has one waiting step. */
  readonly steps: readonly ActivityStep[]
  /** Tool calls in log order, newest calls kept when the log is long. */
  readonly trace: readonly ActivityTrace[]
  /** Latest written file, absent before the first write or add-file. */
  readonly file: ActivityFile | null
}

/** Activity projection plus the composer's in-flight send state. */
export interface WorkbenchView extends ActivityModel {
  /** A prompt call is waiting for acceptance. */
  readonly sending: boolean
  /** The last prompt was refused or could not start. */
  readonly failed: boolean
}

const TRACE_LIMIT = 80
const LINE_LIMIT = 800
const TITLE_LIMIT = 80

interface CallDraft {
  id: string
  name: string
  time: number
  action: ActivityTrace['action']
  path?: string
  lines?: string
  status: ActivityTrace['status']
}

interface TurnDraft {
  turn: number
  title: string
  time: number
  status: 'active' | 'done' | 'error'
}

interface FileDraft {
  text: string
  annotated: number[]
  cursorLine: number
}

interface TodoDraft {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** Format a local clock. @param time - epoch milliseconds. @param seconds - include seconds. @returns `HH:mm` or `HH:mm:ss`. */
export function formatClock(time: number, seconds: boolean): string {
  const date = new Date(time)
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  if (!seconds) return `${hour}:${minute}`
  return `${hour}:${minute}:${String(date.getSeconds()).padStart(2, '0')}`
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) out[key] = item
  return out
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function argsOf(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined
  try {
    return record(JSON.parse(raw))
  } catch {
    // Model tool arguments are not always finished JSON. A bad payload stays off the file.
    return undefined
  }
}

function userText(data: unknown): string {
  const content = record(data)?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) {
    const row = record(block)
    if (row?.type === 'text' && typeof row.text === 'string') text += row.text
  }
  return text
}

function firstLine(text: string): string {
  const breakAt = text.indexOf('\n')
  const line = (breakAt === -1 ? text : text.slice(0, breakAt)).trim()
  return line.length > TITLE_LIMIT ? `${line.slice(0, TITLE_LIMIT - 1)}…` : line
}

function todosOf(data: unknown): TodoDraft[] | undefined {
  const todos = record(data)?.todos
  if (!Array.isArray(todos)) return undefined
  const items: TodoDraft[] = []
  for (const item of todos) {
    const row = record(item)
    const content = row === undefined ? undefined : textOf(row.content)
    const status = row?.status
    if (content === undefined) return undefined
    if (status !== 'pending' && status !== 'in_progress' && status !== 'completed') return undefined
    items.push({ content, status })
  }
  return items
}

function lineSpan(before: string, index: number, inserted: string): string {
  const start = before.slice(0, index).split('\n').length
  const end = start + inserted.split('\n').length - 1
  return start === end ? String(start) : `${start}-${end}`
}

function numbered(start: number, count: number): number[] {
  const lines: number[] = []
  const capped = Math.min(count, 4)
  for (let offset = 0; offset < capped; offset += 1) lines.push(start + offset)
  return lines
}

function remember(files: Map<string, FileDraft>, path: string, text: string, annotated: number[], cursorLine: number): void {
  files.set(path, { text, annotated, cursorLine })
}

function applyEdit(current: string, oldString: string, newString: string, replaceAll: boolean): { text: string; lines: string; annotated: number[]; cursorLine: number } | undefined {
  if (oldString === '') return undefined
  const index = current.indexOf(oldString)
  if (index < 0) {
    if (current !== '') return undefined
    const annotated = numbered(1, newString.split('\n').length)
    return { text: newString, lines: lineSpan('', 0, newString), annotated, cursorLine: annotated.length }
  }
  const next = replaceAll
    ? current.split(oldString).join(newString)
    : current.slice(0, index) + newString + current.slice(index + oldString.length)
  const span = lineSpan(current, index, newString)
  const start = Number(span.split('-')[0])
  const annotated = numbered(start, newString === '' ? 1 : newString.split('\n').length)
  return { text: next, lines: span, annotated, cursorLine: start + annotated.length - 1 }
}

function addedFiles(patch: string): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = []
  let current: { path: string; content: string[] } | undefined
  for (const line of patch.split('\n')) {
    if (line.startsWith('*** Add File:')) {
      if (current !== undefined) files.push({ path: current.path, content: current.content.join('\n') })
      current = { path: line.slice('*** Add File:'.length).trim(), content: [] }
      continue
    }
    if (current !== undefined && line.startsWith('*** ')) {
      files.push({ path: current.path, content: current.content.join('\n') })
      current = undefined
      continue
    }
    if (current !== undefined && line.startsWith('+')) current.content.push(line.slice(1))
  }
  if (current !== undefined) files.push({ path: current.path, content: current.content.join('\n') })
  return files.filter(file => file.path !== '')
}

function fileView(path: string, draft: FileDraft): ActivityFile {
  const crumbs = path.split(/[/\\]/u).filter(part => part !== '')
  const extension = crumbs.at(-1)?.split('.').at(-1) ?? ''
  const lines = draft.text.split('\n').slice(0, LINE_LIMIT)
  const cursorLine = Math.min(Math.max(draft.cursorLine, 1), Math.max(lines.length, 1))
  return {
    path,
    crumbs,
    badge: extension.slice(0, 4).toUpperCase(),
    lines,
    annotated: draft.annotated.filter(line => line >= 1 && line <= lines.length),
    cursorLine,
    cursorColumn: 1,
  }
}

function stepStatus(status: TodoDraft['status']): ActivityStep['status'] {
  if (status === 'completed') return 'done'
  if (status === 'in_progress') return 'active'
  return 'waiting'
}

/**
 * Project session events into the workbench model.
 * @param events - durable events in log order.
 * @returns steps, trace, and the latest written file.
 */
export function projectActivity(events: readonly ActivityEvent[]): ActivityModel {
  const calls: CallDraft[] = []
  const byId = new Map<string, CallDraft>()
  const turns: TurnDraft[] = []
  const files = new Map<string, FileDraft>()
  let openTurn: TurnDraft | undefined
  let todos: TodoDraft[] | undefined
  let selected: string | undefined

  const touchFile = (path: string, text: string, annotated: number[], cursorLine: number): void => {
    remember(files, path, text, annotated, cursorLine)
    selected = path
  }

  for (const event of events) {
    if (event.type === 'turn/start') {
      const turn = record(event.data)?.turn
      if (typeof turn !== 'number') continue
      openTurn = { turn, title: '', time: event.time, status: 'active' }
      turns.push(openTurn)
      continue
    }
    if (event.type === 'user/message') {
      const title = firstLine(userText(event.data))
      if (openTurn !== undefined && openTurn.title === '' && title !== '') openTurn.title = title
      continue
    }
    if (event.type === 'turn/end') {
      if (openTurn === undefined) continue
      const kind = record(record(event.data)?.reason)?.kind
      openTurn.status = kind === 'error' || kind === 'aborted' ? 'error' : 'done'
      openTurn = undefined
      continue
    }
    if (event.type === 'todo/write') {
      const next = todosOf(event.data)
      if (next !== undefined) todos = next
      continue
    }
    if (event.type === 'tool/call') {
      const data = record(event.data)
      const id = textOf(data?.callId)
      const name = textOf(data?.name)
      if (id === undefined || name === undefined) continue
      const args = argsOf(data?.arguments)
      const call: CallDraft = { id, name, time: event.time, action: 'call', status: 'running' }
      if (name === 'write') {
        const path = textOf(args?.file_path)
        const content = textOf(args?.content)
        call.action = 'write'
        if (path !== undefined && content !== undefined) {
          call.path = path
          const cursorLine = content === '' ? 1 : content.split('\n').length
          touchFile(path, content, [cursorLine], cursorLine)
        }
      } else if (name === 'edit') {
        const path = textOf(args?.file_path)
        const oldString = textOf(args?.old_string)
        const newString = textOf(args?.new_string)
        call.action = 'edit'
        if (path !== undefined && oldString !== undefined && newString !== undefined) {
          call.path = path
          const edited = applyEdit(files.get(path)?.text ?? '', oldString, newString, args?.replace_all === true)
          if (edited !== undefined) {
            call.lines = edited.lines
            touchFile(path, edited.text, edited.annotated, edited.cursorLine)
          }
        }
      } else if (name === 'todo_write') {
        call.action = 'todo'
      } else if (name === 'apply_patch') {
        const patch = textOf(args?.input)
        const added = patch === undefined ? [] : addedFiles(patch)
        const last = added.at(-1)
        if (last !== undefined) {
          call.action = 'write'
          call.path = last.path
          for (const file of added) {
            const cursorLine = file.content === '' ? 1 : file.content.split('\n').length
            touchFile(file.path, file.content, [cursorLine], cursorLine)
          }
        }
      }
      calls.push(call)
      byId.set(id, call)
      continue
    }
    if (event.type === 'tool/result') {
      const data = record(event.data)
      const message = record(data?.message)
      const id = textOf(message?.toolCallId)
      const call = id === undefined ? undefined : byId.get(id)
      if (call === undefined) continue
      call.status = message?.isError === true ? 'error' : 'done'
    }
  }

  const openFile = calls.findLast(call => call.status === 'running' && call.path !== undefined)
  const detail = openFile?.path === undefined
    ? undefined
    : { action: openFile.action === 'edit' ? 'editing' as const : 'writing' as const, path: openFile.path }
  const steps: ActivityStep[] = todos !== undefined
    ? todos.map((item, index) => ({
      id: `todo-${index}`,
      title: firstLine(item.content),
      status: stepStatus(item.status),
      ...(item.status === 'in_progress' && detail !== undefined ? { detail: detail.action, path: detail.path } : {}),
    }))
    : turns.map(turn => ({
      id: `turn-${turn.turn}`,
      title: turn.title,
      turn: turn.turn,
      status: turn.status,
      time: formatClock(turn.time, false),
      ...(turn.status === 'active' && detail !== undefined ? { detail: detail.action, path: detail.path } : {}),
    }))
  const visible = steps.length > 0 ? steps : [{ id: 'waiting', title: '', status: 'waiting' as const }]
  const trace = calls.slice(-TRACE_LIMIT).map(call => ({
    id: call.id,
    kind: call.name,
    action: call.action,
    ...(call.path === undefined ? {} : { path: call.path }),
    ...(call.lines === undefined ? {} : { lines: call.lines }),
    time: formatClock(call.time, true),
    status: call.status,
  }))
  const chosen = selected === undefined ? undefined : files.get(selected)
  return { steps: visible, trace, file: selected === undefined || chosen === undefined ? null : fileView(selected, chosen) }
}
