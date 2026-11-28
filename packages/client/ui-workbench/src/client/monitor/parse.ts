/**
 * Fold Codex rollout JSONL and Antigravity transcript JSONL into monitor sessions.
 * The last line of a growing file may be incomplete and is returned unparsed.
 */
import type {
  MonitorAction, MonitorAgent, MonitorFile, MonitorSession, MonitorStatus, MonitorStep, MonitorSurface,
} from './model.ts'

/** One product log the fold is reading. */
export interface LogSource {
  /** Stable file identity. */
  readonly path: string
  /** Owning product. */
  readonly product: 'codex' | 'antigravity' | 'antigravity-cli'
}

/** Mutable session accumulated from one log. */
export interface LogDraft {
  /** Product-scoped id, stable for the file. */
  id: string
  agent: MonitorAgent
  surface: MonitorSurface
  title: string
  cwd: string
  startedAt: number
  status: MonitorStatus
  prompt: string
  /** Codex session id used only to nest subagents. */
  metaId: string
  /** Parent Codex session id from the log, not yet resolved. */
  parentMetaId: string
  /** Later session_meta lines are a parent's replay and must not replace this file. */
  sawMeta: boolean
  steps: MonitorStep[]
  files: MonitorFile[]
  reads: { path: string; name: string; content: string; at: number }[]
  /** An explicit thread name from the log. A later prompt must not replace it. */
  titleLocked: boolean
  terminal: boolean
}

const STEP_CAP = 80
const READ_BINS = new Set(['cat', 'head', 'tail', 'bat', 'less', 'sed'])
const encoder = new TextEncoder()

/**
 * Split a chunk into complete JSONL lines and the unparsed tail.
 * @param text - bytes decoded as text, starting at a line boundary.
 * @param byteLength - how many file bytes `text` represents.
 * @param eof - whether the chunk reaches the current end of the file.
 * @returns complete text and how many bytes the caller should advance.
 */
export function splitChunk(text: string, byteLength: number, eof: boolean): { complete: string; advance: number } {
  if (eof || text.endsWith('\n')) return { complete: text, advance: byteLength }
  const newline = text.lastIndexOf('\n')
  if (newline < 0) return { complete: '', advance: byteLength > 900_000 ? byteLength : 0 }
  const complete = text.slice(0, newline + 1)
  return { complete, advance: byteLength - encoder.encode(text.slice(newline + 1)).length }
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) out[key] = item
  return out
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function timeOf(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || value === '') return fallback
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? fallback : parsed
}

function fileName(path: string): string {
  const parts = path.split(/[/\\]/u).filter(part => part !== '')
  return parts.at(-1) ?? path
}

function looksLikePath(token: string): boolean {
  return token !== '' && !token.startsWith('-') && (token.includes('/') || token.includes('.'))
}

/** Classify a shell command as a read, a write, or a plain command. */
export function classifyCommand(command: string): { action: MonitorAction; label: string } {
  const trimmed = command.trim()
  const redirect = /(?:^|[\s;])>{1,2}\s*([^\s;|&]+)/u.exec(trimmed)
  const target = redirect?.[1]
  if (target !== undefined && looksLikePath(target)) return { action: 'write', label: target }
  const tokens = trimmed.split(/\s+/u).filter(token => token !== '')
  const bin = fileName(tokens[0] ?? '')
  const file = tokens.find((token, index) => index > 0 && looksLikePath(token))
  if (READ_BINS.has(bin) && file !== undefined) return { action: 'read', label: file }
  return { action: 'command', label: trimmed.slice(0, 160) }
}

function commandText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.filter((item): item is string => typeof item === 'string').join(' ')
}

function pushStep(draft: LogDraft, step: MonitorStep): void {
  const previous = draft.steps.at(-1)
  if (previous !== undefined && previous.action === step.action && previous.label === step.label && previous.status === step.status) return
  draft.steps.push(step)
  if (draft.steps.length > STEP_CAP) draft.steps.splice(0, draft.steps.length - STEP_CAP)
  if (step.action !== 'write' && step.action !== 'edit') return
  const next: MonitorFile = {
    path: step.label,
    name: fileName(step.label),
    content: '',
    fresh: step.status === 'running',
    action: step.action,
    at: step.at,
  }
  const current = draft.files.find(item => item.path === step.label)
  if (current === undefined) draft.files.push(next)
  else {
    const index = draft.files.indexOf(current)
    draft.files[index] = { ...current, ...next, content: current.content }
  }
}

function rememberContent(draft: LogDraft, path: string, content: string): void {
  const file = draft.files.find(item => item.path === path)
  if (file === undefined || content === '') return
  const index = draft.files.indexOf(file)
  draft.files[index] = { ...file, content }
}

function toolAction(name: string): MonitorAction | undefined {
  const normalized = name.toLowerCase()
  if (normalized === 'read_file' || normalized === 'read' || normalized === 'view_file' || normalized === 'grep_search' || normalized === 'list_dir') return 'read'
  if (normalized === 'run_command' || normalized === 'shell' || normalized === 'exec' || normalized === 'bash'
    || normalized === 'local_shell' || normalized === 'exec_command' || normalized === 'container.exec') return 'command'
  if (normalized === 'write_file' || normalized === 'write_to_file' || normalized === 'write') return 'write'
  if (normalized === 'edit_file' || normalized === 'replace_file_content' || normalized === 'multi_replace_file_content'
    || normalized === 'edit' || normalized === 'apply_patch') return 'edit'
  return undefined
}

function argPath(args: Record<string, unknown>): string {
  return textOf(args.Path) || textOf(args.path) || textOf(args.AbsolutePath) || textOf(args.TargetFile)
    || textOf(args.file_path) || textOf(args.filePath) || textOf(args.target_file) || textOf(args.SearchPath) || textOf(args.DirectoryPath)
}

function argContent(args: Record<string, unknown>): string {
  return textOf(args.Content) || textOf(args.content) || textOf(args.contents) || textOf(args.new_string)
}

function firstFilled(read: (key: string) => string, keys: readonly string[]): string {
  for (const key of keys) {
    const value = read(key)
    if (value !== '') return value
  }
  return ''
}

function argOld(args: Record<string, unknown>): string {
  return firstFilled(key => textOf(args[key]), ['old_string', 'old_content'])
}

function clipText(value: string): string {
  return value.length > 80_000 ? value.slice(0, 80_000) : value
}

function outputText(value: unknown): string {
  if (typeof value === 'string') return value
  const body = record(value)
  if (body === undefined) return ''
  return firstFilled(key => textOf(body[key]), ['text', 'content', 'output'])
}

function rememberRead(draft: LogDraft, path: string, content: string, at: number): void {
  if (content === '') return
  const next = { path, name: fileName(path), content: clipText(content), at }
  const index = draft.reads.findIndex(item => item.path === path)
  if (index >= 0) draft.reads[index] = next
  else draft.reads.push(next)
}

function blockText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const parts: string[] = []
    for (const item of value) {
      const text = blockText(item)
      if (text !== '') parts.push(text)
    }
    return parts.join('\n')
  }
  const body = record(value)
  if (body === undefined) return ''
  return firstFilled(key => textOf(body[key]), ['text', 'message'])
}

function isLogFile(name: string): boolean {
  return /\.jsonl$/iu.test(name) || /^rollout-/iu.test(name)
}

function isOnlyPath(value: string): boolean {
  return value !== '' && !/\s/u.test(value) && (value.includes('/') || value.includes('\\'))
}

function isContextDump(text: string): boolean {
  const head = text.trim().slice(0, 64).toLowerCase()
  for (const marker of ['<environment_context', '<permissions', '# agents.md']) {
    if (head.startsWith(marker)) return true
  }
  return false
}

/** First human line. Paths, log names, and the cwd slug are skipped. */
function titleFrom(text: string, cwd: string): string {
  const folder = fileName(cwd)
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (isLogFile(line)) continue
    if (isOnlyPath(line)) continue
    if (folder !== '' && line === folder) continue
    if (line !== '') return line.slice(0, 80)
  }
  return ''
}

function conversationTitle(payload: Record<string, unknown>): string {
  return firstFilled(key => textOf(payload[key]), ['title', 'name', 'thread_name', 'thread_title'])
}

const INJECTED_PROVENANCE = new Set(['developer_instructions', 'skills', 'agents_md', 'harness', 'tool'])

/** True when the message is a person, or the log does not say otherwise. */
function authoredByUser(payload: Record<string, unknown>): boolean {
  const meta = record(payload.internal_chat_message_metadata_passthrough)
  const items = meta?.content_item_metadata
  if (!Array.isArray(items)) return true
  let marked = false
  for (const item of items) {
    const type = textOf(record(record(item)?.provenance)?.type)
    if (type === '') continue
    marked = true
    if (!INJECTED_PROVENANCE.has(type)) return true
  }
  return !marked
}

function lockTitle(draft: LogDraft, text: string): void {
  const title = titleFrom(text, draft.cwd)
  if (title === '') return
  draft.title = title
  draft.titleLocked = true
}

function rememberUser(draft: LogDraft, message: string): void {
  const text = message.trim()
  if (text === '' || isContextDump(text)) return
  if (draft.prompt !== '') return
  draft.prompt = clipText(text)
  if (!draft.titleLocked) {
    const title = titleFrom(text, draft.cwd)
    if (title !== '') draft.title = title
  }
}

function addTool(
  draft: LogDraft, name: string, args: Record<string, unknown>, at: number, status: MonitorStatus, id: string, captured = '',
): void {
  const action = toolAction(name)
  if (action === undefined) return
  if (action === 'command') {
    const command = commandText(args.command) || textOf(args.cmd) || textOf(args.Command)
    const classified = classifyCommand(command === '' ? name : command)
    pushStep(draft, { id, at, action: classified.action, label: classified.label, status })
    return
  }
  const path = argPath(args)
  if (path === '') return
  pushStep(draft, { id, at, action, label: path, status })
  if (action === 'read') {
    const readText = argContent(args)
    rememberRead(draft, path, readText !== '' ? readText : captured, at)
  }
  if (action === 'edit') rememberRead(draft, path, argOld(args), at)
  rememberContent(draft, path, argContent(args))
}

function surfaceOf(originator: string, source: unknown): MonitorSurface {
  if (typeof source === 'object' && source !== null) return 'subagent'
  if (source === 'subagent') return 'subagent'
  if (source === 'exec' || originator === 'codex_exec') return 'exec'
  return 'desktop'
}

function parentFromMeta(payload: Record<string, unknown>): string {
  const direct = textOf(payload.parent_thread_id)
  const source = record(payload.source)
  const subagent = record(source?.subagent)
  const spawn = record(subagent?.thread_spawn)
  return textOf(spawn?.parent_thread_id) || direct
}

function applyCodex(draft: LogDraft, value: Record<string, unknown>, at: number, sequence: number): void {
  const payload = record(value.payload) ?? value
  const kind = textOf(payload.type) || textOf(value.type)
  if (kind === 'session_meta') {
    if (draft.sawMeta) return
    draft.sawMeta = true
    draft.metaId = textOf(payload.id) || textOf(payload.session_id)
    draft.cwd = textOf(payload.cwd) || draft.cwd
    lockTitle(draft, conversationTitle(payload))
    const parent = parentFromMeta(payload)
    if (parent !== '' && parent !== draft.metaId) {
      draft.parentMetaId = parent
      draft.surface = 'subagent'
    } else {
      draft.surface = surfaceOf(textOf(payload.originator), payload.source)
    }
    return
  }
  if (kind === 'task_started') {
    draft.terminal = false
    draft.status = 'running'
    return
  }
  if (kind === 'thread_name_updated') {
    lockTitle(draft, firstFilled(key => textOf(payload[key]), ['thread_name', 'name']))
    return
  }
  if (kind === 'user_message' || kind === 'user') {
    rememberUser(draft, firstFilled(key => blockText(payload[key]), ['message', 'content', 'text', 'text_elements']))
    return
  }
  if (kind === 'item_completed') {
    const item = record(payload.item)
    if (item !== undefined && textOf(item.type) === 'UserMessage') {
      rememberUser(draft, firstFilled(key => blockText(item[key]), ['content', 'text']))
    }
    return
  }
  if (kind === 'message' && textOf(payload.role) === 'user' && authoredByUser(payload)) {
    rememberUser(draft, blockText(payload.content))
    return
  }
  if (kind === 'task_complete' || kind === 'turn_complete' || kind === 'shutdown') {
    draft.terminal = true
    draft.status = 'done'
    return
  }
  if (kind === 'turn_aborted' || kind === 'error') {
    draft.terminal = true
    draft.status = 'error'
    return
  }
  if (kind === 'exec_command_end' || kind === 'command_execution' || kind === 'CommandExecution') {
    if (textOf(payload.status).toLowerCase() === 'running') return
    const command = commandText(payload.command)
    if (command === '') return
    const classified = classifyCommand(command)
    const failed = payload.exit_code !== undefined && payload.exit_code !== 0
    pushStep(draft, { id: `${draft.id}:${sequence}`, at, action: classified.action, label: classified.label, status: failed ? 'error' : 'done' })
    if (classified.action === 'read') {
      const stdout = firstFilled(key => outputText(payload[key]), ['stdout', 'aggregated_output', 'output'])
      if (stdout !== '') rememberRead(draft, classified.label, stdout, at)
    }
    return
  }
  if (kind === 'patch_apply_end' || kind === 'file_change' || kind === 'FileChange') {
    const changes = record(payload.changes) ?? record(payload.files)
    if (changes === undefined) return
    for (const [path, change] of Object.entries(changes)) {
      const body = record(change)
      const changeType = textOf(body?.type)
      const action: MonitorAction = changeType === 'update' || changeType === 'modify' ? 'edit' : 'write'
      pushStep(draft, { id: `${draft.id}:${sequence}:${path}`, at, action, label: path, status: 'done' })
      rememberContent(draft, path, textOf(body?.content))
    }
    return
  }
  if (new Set(['function_call_output', 'custom_tool_call_output', 'tool_result']).has(kind)) {
    const output = firstFilled(key => outputText(payload[key]), ['output', 'content', 'result'])
    const lastRead = [...draft.steps].reverse().find(step => step.action === 'read')
    if (output !== '' && lastRead !== undefined) rememberRead(draft, lastRead.label, output, at)
    return
  }
  if (kind === 'function_call' || kind === 'custom_tool_call' || kind === 'tool_call') {
    const name = textOf(payload.name)
    const raw = payload.arguments ?? payload.input ?? payload.args
    const args = typeof raw === 'string' ? record(parseJson(raw)) ?? {} : record(raw) ?? {}
    addTool(draft, name, args, at, 'done', `${draft.id}:${sequence}`)
  }
}

function applyAntigravity(draft: LogDraft, value: Record<string, unknown>, at: number, sequence: number): void {
  const source = textOf(value.source).toUpperCase()
  const typeName = textOf(value.type).toUpperCase()
  lockTitle(draft, conversationTitle(value))
  if (source === 'USER' || source.startsWith('USER_') || typeName === 'USER' || typeName === 'USER_INPUT') {
    rememberUser(draft, blockText(value.content))
  }
  const statusText = textOf(value.status).toUpperCase()
  const status: MonitorStatus = statusText === 'RUNNING' ? 'running' : statusText === 'ERROR' ? 'error' : 'done'
  if (status === 'running') draft.status = 'running'
  const calls = value.tool_calls ?? value.toolCalls
  if (!Array.isArray(calls)) return
  calls.forEach((call, index) => {
    const body = record(call)
    if (body === undefined) return
    const name = textOf(body.name) || textOf(body.tool)
    const args = record(body.args) ?? record(body.arguments) ?? body
    const captured = firstFilled(key => textOf(body[key]), ['result', 'output'])
    addTool(draft, name, args, at, status, `${draft.id}:${sequence}:${index}`, captured)
  })
}

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

/**
 * Create the draft for one log file.
 * @param source - the log being read.
 * @returns an empty draft identified by that file.
 */
export function createDraft(source: LogSource): LogDraft {
  const agent: MonitorAgent = source.product === 'codex' ? 'codex' : 'antigravity'
  const surface: MonitorSurface = source.product === 'antigravity-cli' ? 'cli' : source.product === 'antigravity' ? 'app' : 'desktop'
  return {
    id: `${source.product}:${source.path}`,
    agent,
    surface,
    title: '',
    cwd: '',
    startedAt: 0,
    status: 'done',
    prompt: '',
    metaId: /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/iu.exec(fileName(source.path))?.[1]?.toLowerCase() ?? '',
    parentMetaId: '',
    sawMeta: false,
    steps: [],
    files: [],
    reads: [],
    titleLocked: false,
    terminal: false,
  }
}

/**
 * Parse complete JSONL text into an existing draft.
 * @param draft - session accumulated so far.
 * @param text - complete lines, each ending in a newline except possibly the last at EOF.
 * @param now - clock used when a line has no timestamp.
 */
export function ingestLines(draft: LogDraft, text: string, now: number): void {
  const lines = text.split('\n')
  lines.forEach((line, sequence) => {
    if (line.trim() === '') return
    const value = record(parseJson(line))
    if (value === undefined) return
    const at = timeOf(value.timestamp ?? value.time ?? value.created_at ?? record(value.payload)?.timestamp, now)
    if (draft.startedAt === 0) draft.startedAt = at
    if (draft.agent === 'codex') applyCodex(draft, value, at, sequence)
    else applyAntigravity(draft, value, at, sequence)
  })
  const latest = draft.steps.at(-1)?.at ?? draft.startedAt
  if (!draft.terminal) {
    if (draft.steps.some(step => step.status === 'running') || (draft.agent === 'codex' && now - latest < 180_000)) draft.status = 'running'
    else if (draft.steps.some(step => step.status === 'error')) draft.status = 'error'
    else draft.status = 'done'
  }
  if (draft.title === '') draft.title = fileName(draft.id)
}

/**
 * Publish drafts, nesting Codex subagents by their meta id.
 * @param drafts - one per log file.
 * @param now - clock for the fresh-file mark.
 * @returns the page snapshot.
 */
export function publishDrafts(drafts: readonly LogDraft[], now: number): { sessions: MonitorSession[]; running: number } {
  const byMeta = new Map(drafts.filter(draft => draft.metaId !== '').map(draft => [draft.metaId, draft.id]))
  const sessions = drafts.map((draft): MonitorSession => {
    const parentId = draft.parentMetaId === '' ? undefined : byMeta.get(draft.parentMetaId)
    return {
      id: draft.id,
      agent: draft.agent,
      surface: draft.surface,
      title: draft.title,
      cwd: draft.cwd,
      startedAt: draft.startedAt,
      status: draft.status,
      prompt: draft.prompt,
      ...(parentId !== undefined ? { parentId } : {}),
      steps: draft.steps,
      files: draft.files.map(file => ({ ...file, fresh: file.fresh || now - file.at < 20_000 })),
      ...(draft.reads.length > 0 ? { reads: draft.reads } : {}),
    }
  })
  sessions.sort((left, right) => right.startedAt - left.startedAt)
  const running = sessions.filter(session => session.parentId === undefined && session.status === 'running').length
  return { sessions, running }
}
