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

function firstLine(message: string): string {
  const newline = message.indexOf('\n')
  const head = newline < 0 ? message : message.slice(0, newline)
  return head.trim().slice(0, 80)
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

function addTool(draft: LogDraft, name: string, args: Record<string, unknown>, at: number, status: MonitorStatus, id: string): void {
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
  if (kind === 'user_message' || kind === 'user') {
    const message = textOf(payload.message) || textOf(payload.content) || textOf(payload.text)
    if (message !== '' && draft.prompt === '') {
      draft.prompt = message
      draft.title = firstLine(message)
    }
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
  if (kind === 'function_call' || kind === 'custom_tool_call' || kind === 'tool_call') {
    const name = textOf(payload.name)
    const raw = payload.arguments ?? payload.input ?? payload.args
    const args = typeof raw === 'string' ? record(parseJson(raw)) ?? {} : record(raw) ?? {}
    addTool(draft, name, args, at, 'done', `${draft.id}:${sequence}`)
  }
}

function applyAntigravity(draft: LogDraft, value: Record<string, unknown>, at: number, sequence: number): void {
  const content = textOf(value.content)
  const source = textOf(value.source).toUpperCase()
  if ((source === 'USER' || textOf(value.type) === 'user') && content !== '' && draft.prompt === '') {
    draft.prompt = content
    draft.title = firstLine(content)
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
    addTool(draft, name, args, at, status, `${draft.id}:${sequence}:${index}`)
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
    }
  })
  sessions.sort((left, right) => right.startedAt - left.startedAt)
  const running = sessions.filter(session => session.parentId === undefined && session.status === 'running').length
  return { sessions, running }
}
