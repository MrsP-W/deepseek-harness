/**
 * Desktop workbench: session rail, live workflow column, and the file being written.
 * Steps and the trace come from the current Session. The official InputBar starts a turn.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import {
  IconBranchOutlineMedium, IconChecklistOutlineMedium,
  IconChevronRightOutlineMedium, IconCodeOutlineMedium,
  IconEditOutlineMedium, IconFilesDiffOutlineMedium, IconFolderCloseMedium,
  IconLayersOutlineMedium, IconNewChatOutlineMedium, IconSettingsOutlineMedium,
  IconCheckCircleFillMedium, IconSearchOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ActivityFile, ActivityStep, ActivityTrace, WorkbenchView } from './activity.ts'
import type { MonitorSession, MonitorSnapshot } from './monitor/model.ts'
import { abbreviateConversation } from './monitor/parse.ts'
import type { WorkbenchKey } from './locales/workbench.ts'
import css from './WorkbenchShell.module.css'

/** Translate a workbench dictionary key, with `{name}` substitution. */
export type WorkbenchText = (key: WorkbenchKey, params?: Record<string, unknown>) => string

/** Props for the workbench shell. */
export type WorkbenchShellProps = {
  /** Active-locale workbench copy. */
  t: WorkbenchText
  /** Current Session projection and send state. */
  useActivity: SnapshotSelectorHook<WorkbenchView>
  /**
   * The Session the official composer should bind, when one is open.
   * @returns the followed Session reference, or absence.
   */
  sessionOf: () => SessionReference | undefined
  /**
   * Start an official new Session in the current or recent Workspace.
   */
  startSession?: () => void
  /**
   * Show or hide the official session list (the official sidebar).
   * @param open - whether the official sidebar should be visible.
   */
  openSessions?: (open: boolean) => void
  /**
   * Show or hide official workspace files in the right column.
   * @param open - whether the official files UI should be visible.
   */
  openFiles?: (open: boolean) => void
  /** Open the official Settings dialog, the same path as Cmd+,. */
  openSettings?: () => void
  /** Local Codex and Antigravity logs. Absent in the activity-only shell. */
  useMonitor?: SnapshotSelectorHook<MonitorSnapshot>
} & PropsRenderSlots<'workbench.composer'>

const RAIL_WIDTH = 56
const PANE_MIN = 200
const PREFERRED = 440

/**
 * Workflow width that leaves the code column usable inside the measured shell.
 * @param preference - Dragged or default workflow width in px.
 * @param container - Shell width in px. Zero means the shell has not been measured.
 * @returns The width to apply, in px.
 */
function fitWorkflow(preference: number, container: number): number {
  const room = Math.max(0, container - RAIL_WIDTH)
  if (room === 0) return 0
  const editorFloor = Math.min(PANE_MIN, room / 2)
  const floor = Math.min(PANE_MIN, Math.max(0, room - editorFloor))
  const ceiling = Math.max(floor, room - editorFloor)
  return Math.min(ceiling, Math.max(floor, preference))
}

const KEYWORDS = new Set(['export', 'interface', 'type', 'async', 'function', 'const', 'let', 'if', 'for', 'switch', 'case', 'throw', 'new', 'return', 'of', 'break'])

const RAIL = [
  { id: 'workflow', nameKey: 'rail.workflow', Icon: IconLayersOutlineMedium, current: true },
  { id: 'chat', nameKey: 'rail.chat', Icon: IconNewChatOutlineMedium, current: false },
  { id: 'files', nameKey: 'rail.files', Icon: IconFolderCloseMedium, current: false },
] as const

const STATUS_KEY = {
  done: 'status.done',
  active: 'status.active',
  waiting: 'status.waiting',
  error: 'status.error',
} as const

const TRACE_ICON = {
  write: IconEditOutlineMedium,
  edit: IconFilesDiffOutlineMedium,
  todo: IconChecklistOutlineMedium,
  call: IconCodeOutlineMedium,
} as const

type TokenKind = 'comment' | 'string' | 'keyword' | 'number' | 'plain'

function sourceTokens(line: string): string[] {
  const keyword
    = String.raw`\b(?:export|interface|type|async|function|const|let|if|for|switch|case|throw|new|return|of|break)\b`
  const pattern = new RegExp(String.raw`//.*|'(?:[^'\n])*'|` + keyword + String.raw`|\d+|[A-Za-z_]\w*|.`, 'gu')
  return [...line.matchAll(pattern)].map(match => match[0])
}

function tokenKind(token: string): TokenKind {
  if (token.startsWith('//')) return 'comment'
  if (token.startsWith("'")) return 'string'
  if (KEYWORDS.has(token)) return 'keyword'
  const first = token.charAt(0)
  if (first >= '0' && first <= '9') return 'number'
  return 'plain'
}

function stepTitle(step: ActivityStep, t: WorkbenchText): string {
  if (step.title !== '') return step.title
  if (step.turn !== undefined) return t('step.turn', { n: step.turn })
  return t('step.waiting.title')
}

function traceBody(event: ActivityTrace, t: WorkbenchText): string {
  if (event.action === 'write' && event.path !== undefined) return t('trajectory.write', { path: event.path })
  if (event.action === 'edit' && event.path !== undefined) return t('trajectory.edit', { path: event.path, lines: event.lines ?? '' })
  if (event.action === 'todo') return t('trajectory.todo')
  return t('trajectory.call', { name: event.kind })
}

function fileName(file: ActivityFile): string {
  return file.crumbs.at(-1) ?? file.path
}

function ignoreSession(): void {}

function ignoreOpen(open: boolean): void {
  void open
}

function clock(at: number): string {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function actionKey(action: MonitorSession['steps'][number]['action']): WorkbenchKey {
  if (action === 'read') return 'monitor.read'
  if (action === 'command') return 'monitor.command'
  if (action === 'write') return 'monitor.write'
  return 'monitor.edit'
}

function monitorFile(file: MonitorSession['files'][number]): ActivityFile {
  const lines = file.content.split('\n').slice(0, 800)
  const crumbs = file.path.split(/[/\\]/u).filter(part => part !== '')
  const dot = file.name.lastIndexOf('.')
  const extension = dot > 0 ? file.name.slice(dot + 1) : ''
  const annotated = file.fresh ? lines.map((_, index) => index + 1).slice(-7) : []
  return {
    path: file.path,
    crumbs: crumbs.length > 0 ? crumbs : [file.name],
    badge: extension.slice(0, 4).toUpperCase(),
    lines,
    annotated,
    cursorLine: Math.max(lines.length, 1),
    cursorColumn: 1,
  }
}

function visibleFile(activity: WorkbenchView, selectedPath: string | undefined): ActivityFile | null {
  return activity.files.find(file => file.path === selectedPath) ?? activity.file
}

function openablePath(event: ActivityTrace, files: readonly ActivityFile[]): string | undefined {
  return event.path !== undefined && files.some(file => file.path === event.path) ? event.path : undefined
}

/**
 * Render the two-column workbench shell.
 * @param props - Copy, the Session projection, and the official composer seat.
 * @returns The rail, workflow column, editor column, and the column separator.
 */

const MINUTE_MS = 60_000

function pathTail(path: string): string {
  const parts = path.split(/[/\\]/u).filter(part => part !== '')
  return parts.at(-1) ?? ''
}

function isLogName(name: string): boolean {
  return /\.jsonl$/iu.test(name) || /^rollout-/iu.test(name)
}

function isOnlyPath(value: string): boolean {
  return value !== '' && !/\s/u.test(value) && (value.includes('/') || value.includes('\\'))
}

/** A display title. Paths, log filenames, tags, and the working-directory slug are not titles. */
function acceptedTitle(value: string, folder: string): string {
  const trimmed = abbreviateConversation(value)
  if (trimmed === '' || isLogName(trimmed) || isOnlyPath(trimmed) || trimmed === folder) return ''
  return trimmed
}

function ownTitle(session: MonitorSession): string {
  const folder = pathTail(session.cwd)
  const titled = acceptedTitle(session.title, folder)
  if (titled !== '') return titled
  for (const raw of session.prompt.split('\n')) {
    const line = acceptedTitle(raw, folder)
    if (line !== '') return line
  }
  return acceptedTitle(session.prompt, folder)
}

/**
 * Short conversation name. A subagent with only a directory slug uses its parent's name.
 * The project folder is used only when the log has neither.
 * @param sessions - sibling sessions, used to inherit a parent title.
 */
function displayName(session: MonitorSession, sessions: readonly MonitorSession[] = []): string {
  const own = ownTitle(session)
  if (own !== '') return own
  const parent = session.parentId === undefined ? undefined : sessions.find(item => item.id === session.parentId)
  if (parent !== undefined) {
    const inherited = ownTitle(parent)
    if (inherited !== '') return inherited
  }
  const folder = pathTail(session.cwd)
  if (folder !== '' && !isLogName(folder)) return folder
  return session.agent === 'codex' ? 'Codex' : 'Antigravity'
}

/** Final filename when a label is a path. Commands stay as written. */
function labelName(label: string): string {
  const trimmed = label.trim()
  if (!trimmed.includes('/') && !trimmed.includes('\\')) return trimmed
  return pathTail(trimmed) || trimmed
}

type SessionLane = 'running' | 'waiting' | 'idle' | 'expired'

function laneOf(session: MonitorSession, now: number): SessionLane {
  const latest = session.steps.at(-1)?.at ?? session.startedAt
  const age = now - latest
  if (session.status === 'running') {
    if (session.steps.some(step => step.status === 'running') || (age >= 0 && age < 3 * MINUTE_MS)) return 'running'
    return 'waiting'
  }
  if (session.status === 'error' && age >= 0 && age < 15 * MINUTE_MS) return 'waiting'
  if (age > 60 * MINUTE_MS) return 'expired'
  return 'idle'
}

function laneKey(lane: SessionLane): WorkbenchKey {
  if (lane === 'running') return 'monitor.lane.running'
  if (lane === 'waiting') return 'monitor.lane.waiting'
  if (lane === 'idle') return 'monitor.lane.idle'
  return 'monitor.lane.expired'
}

function originKey(surface: MonitorSession['surface']): WorkbenchKey {
  if (surface === 'exec' || surface === 'cli') return 'monitor.origin.exec'
  if (surface === 'app') return 'monitor.origin.ide'
  if (surface === 'subagent') return 'monitor.origin.subagent'
  return 'monitor.origin.desktop'
}

function elapsedFigure(at: number, now: number): { clock: string; minutes: number } {
  const delta = Math.max(0, now - Math.max(0, at))
  const minutes = Math.floor(delta / MINUTE_MS)
  const seconds = Math.floor((delta % MINUTE_MS) / 1000)
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    return { clock: `${hours}h ${minutes % 60}m`, minutes }
  }
  return { clock: `${minutes}m ${String(seconds).padStart(2, '0')}s`, minutes }
}

function sourceLabel(sessions: readonly MonitorSession[], t: WorkbenchText): string {
  const codex = sessions.some(session => session.agent === 'codex')
  const antigravity = sessions.some(session => session.agent === 'antigravity')
  if (codex && antigravity) return t('monitor.sourceJoin', { a: t('monitor.codex'), b: t('monitor.ag') })
  if (codex) return t('monitor.codex')
  if (antigravity) return t('monitor.ag')
  return ''
}

function latestAt(sessions: readonly MonitorSession[], now: number): number {
  let latest = 0
  for (const session of sessions) {
    const at = Math.max(session.startedAt, session.steps.at(-1)?.at ?? 0, ...session.files.map(file => file.at))
    if (at > latest && at <= now) latest = at
  }
  return latest
}

/** One local Codex or Antigravity session inside the session list. */
function SessionRow({
  session, sessions, selected, nested = false, now, t, onSelect,
}: {
  session: MonitorSession
  sessions: readonly MonitorSession[]
  selected: boolean
  nested?: boolean
  now: number
  t: WorkbenchText
  onSelect: () => void
}) {
  const lane = laneOf(session, now)
  const elapsed = elapsedFigure(session.startedAt, now)
  return (
    <button
      type="button"
      className={[css.session, selected ? css.sessionOn : '', nested ? css.sessionNested : ''].filter(part => part !== '').join(' ')}
      data-workbench-session={session.id}
      data-status={session.status}
      data-lane={lane}
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
    >
      <span className={css.laneDot} data-lane={lane} />
      <span className={css.sessionTitle}>{displayName(session, sessions)}</span>
      <span className={css.sessionMeta}>{t(session.agent === 'codex' ? 'monitor.codex' : 'monitor.ag')}</span>
      <span className={css.sessionMeta}>{t(originKey(session.surface))}</span>
      <span className={css.sessionMeta}>{t(laneKey(lane))}</span>
      <span className={css.sessionDuration}>{elapsed.clock}</span>
    </button>
  )
}

/** Header button that expands or collapses a workflow pane. */
function PaneToggle({ open, label, onToggle }: { open: boolean; label: string; onToggle: () => void }) {
  return (
    <h3 className={css.sectionTitle}>
      <button type="button" className={css.paneToggle} aria-expanded={open} onClick={onToggle}>
        <span className={css.chevron} aria-hidden="true">
          <IconChevronRightOutlineMedium size={16} />
        </span>
        {label}
      </button>
    </h3>
  )
}

interface TableRow {
  key: string
  at: number
  name: string
  path: string
  content: string
}

function previewText(text: string): string {
  const line = text.replace(/\s+/gu, ' ').trim()
  return line.length > 96 ? `${line.slice(0, 96)}…` : line
}

/** One input or output table. An empty side keeps its header and does not hide the other table. */
function IoTable({
  caption, rows, empty, streaming, t, onOpenFile,
}: {
  caption: string
  rows: readonly TableRow[]
  empty: string
  streaming: boolean
  t: WorkbenchText
  onOpenFile: (path: string) => void
}) {
  return (
    <div className={css.ioTableWrap}>
      <table className={css.ioTable}>
        <caption>
          <span>{caption}</span>
          {streaming && <span className={css.streaming}>{t('monitor.streaming')}</span>}
        </caption>
        <thead>
          <tr>
            <th>{t('monitor.col.time')}</th>
            <th>{t('monitor.col.file')}</th>
            <th>{t('monitor.col.text')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className={css.empty}>{empty}</td>
            </tr>
          ) : rows.map(row => (
            <tr key={row.key}>
              <td>{clock(row.at)}</td>
              <td>
                {row.path === '' ? row.name : (
                  <button type="button" className={css.ioFileButton} data-workbench-open-file={row.path} onClick={() => onOpenFile(row.path)}>
                    {row.name}
                  </button>
                )}
              </td>
              <td>{row.content === '' ? t('monitor.elapsed.none') : previewText(row.content)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MonitorBoard({
  t, sessions, catalog, selected, filter, page, viewMode, file, now,
  onFilter, onView, onSelect, onOpenFile,
}: {
  t: WorkbenchText
  sessions: readonly MonitorSession[]
  catalog: readonly MonitorSession[]
  selected: MonitorSession | undefined
  filter: 'all' | 'codex' | 'antigravity'
  page: 'overview' | 'sources'
  viewMode: 'list' | 'repo' | 'board'
  file: ActivityFile | null
  now: number
  onFilter: (next: 'all' | 'codex' | 'antigravity') => void
  onView: (next: 'list' | 'repo' | 'board') => void
  onSelect: (id: string) => void
  onOpenFile: (path: string) => void
}) {
  const tops = sessions.filter(session => session.parentId === undefined
    || !sessions.some(parent => parent.id === session.parentId))
  const current = selected?.steps.at(-1)
  const inputRows: TableRow[] = []
  if (selected !== undefined && selected.prompt !== '') {
    inputRows.push({
      key: 'prompt', at: selected.startedAt, name: t('monitor.promptName'), path: '', content: selected.prompt,
    })
  }
  if (selected !== undefined) {
    for (const read of selected.reads ?? []) {
      if (read.content === '') continue
      inputRows.push({
        key: `read:${read.path}`,
        at: read.at ?? selected.startedAt,
        name: read.name || labelName(read.path),
        path: read.path,
        content: read.content,
      })
    }
  }
  const outputRows: TableRow[] = (selected?.files ?? []).map(item => ({
    key: `file:${item.path}`,
    at: item.at,
    name: item.name || labelName(item.path),
    path: item.path,
    content: item.content,
  }))
  const catalogTops = catalog.filter(session => session.parentId === undefined
    || !catalog.some(parent => parent.id === session.parentId))
  const byLane = (lane: SessionLane) => catalogTops.filter(session => laneOf(session, now) === lane)
  const runningRows = byLane('running')
  const waitingRows = byLane('waiting')
  const idleRows = byLane('idle')
  const openCount = catalogTops.filter(session => session.status !== 'done').length
  const doneCount = catalogTops.filter(session => session.status === 'done').length
  const longest = (rows: readonly MonitorSession[]) => {
    let minutes = 0
    for (const row of rows) minutes = Math.max(minutes, elapsedFigure(row.startedAt, now).minutes)
    return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`
  }
  if (page === 'sources') {
    return (
      <section className={css.sources} data-monitor-region="sources">
        <p className={css.sourcesNote}>{t('monitor.sourcesNote')}</p>
        <ul className={css.sourceList}>
          <li>{t('monitor.badge.codex.desktop')}</li>
          <li>{t('monitor.badge.ag.app')}</li>
          <li>{t('monitor.badge.ag.cli')}</li>
        </ul>
      </section>
    )
  }
  return (
    <div className={css.board} data-monitor-region="overview">
      <article className={css.highlight} data-monitor-region="highlight">
        {selected === undefined ? <p className={css.empty}>{t('monitor.empty')}</p> : (
          <>
            <p className={css.eyebrow}>
              <span className={css.liveDot} data-status={selected.status} />
              {t('monitor.currentRun', { status: t(laneKey(laneOf(selected, now))) })}
            </p>
            <h3 className={css.projectTitle} title={selected.prompt === '' ? undefined : selected.prompt}>
              {displayName(selected, catalog)}
            </h3>
            <p className={css.projectSub}>
              <strong>{selected.steps.some(step => step.status === 'running' && step.action === 'write')
                || selected.steps.some(step => step.status === 'running' && step.action === 'edit')
                ? t('monitor.writing')
                : t(laneKey(laneOf(selected, now)))}</strong>
              {' · '}
              {t(selected.agent === 'codex' ? 'monitor.codex' : 'monitor.ag')}
              {' · '}
              {t(originKey(selected.surface))}
            </p>
            <div className={css.nowBox}>
              <p className={css.nowLabel}>{t('monitor.step')}</p>
              <p className={css.nowCmd}>
                {current === undefined ? t('monitor.elapsed.none') : `${t(actionKey(current.action))}  ${labelName(current.label)}`}
              </p>
              {selected.prompt !== '' && <p className={css.nowDesc}>{selected.prompt}</p>}
            </div>
            <div className={css.metaRow}>
              <div className={css.fileBars}>
                <p className={css.nowLabel}>{t('monitor.filesRun')}</p>
                {selected.files.map((item) => {
                  const lines = item.content === '' ? 0 : item.content.split('\n').filter(line => line !== '').length
                  const widest = Math.max(1, ...selected.files.map(entry => (
                    entry.content === '' ? 0 : entry.content.split('\n').filter(line => line !== '').length
                  )))
                  return (
                    <button
                      key={item.path}
                      type="button"
                      className={css.fileBar}
                      data-workbench-open-file={item.path}
                      onClick={() => onOpenFile(item.path)}
                    >
                      <span className={css.fileBarName}>{item.name || labelName(item.path)}</span>
                      <span className={css.barTrack}>
                        <i className={item.fresh ? css.barHot : css.barFill} style={{ width: `${Math.round((lines / widest) * 100)}%` }} />
                      </span>
                      <span className={css.fileBarCount}>{lines > 0 ? `+${lines}` : t('monitor.elapsed.none')}</span>
                    </button>
                  )
                })}
                <p className={css.readonly}>{t('monitor.readonly')}</p>
              </div>
              <div className={css.elapsed}>
                <p className={css.elapsedFigure}>{elapsedFigure(selected.startedAt, now).clock}</p>
                <p className={css.elapsedLabel}>{t('monitor.elapsedOngoing', { n: elapsedFigure(selected.startedAt, now).minutes })}</p>
              </div>
            </div>
          </>
        )}
        <div className={css.stats}>
          <div data-monitor-count="running">
            <p className={css.statValue}>{runningRows.length} <small>{t('monitor.lane.running')}</small></p>
            <p className={css.statHint}>{t('monitor.stat.longest', { time: longest(runningRows) })}</p>
          </div>
          <div data-monitor-count="idle">
            <p className={css.statValue}>{idleRows.length} <small>{t('monitor.lane.idle')}</small></p>
            <p className={css.statHint}>{t('monitor.stat.longest', { time: longest(idleRows) })}</p>
          </div>
          <div data-monitor-count="waiting">
            <p className={css.statValue}>{waitingRows.length} <small>{t('monitor.lane.waiting')}</small></p>
            <p className={css.statHint}>{t('monitor.stat.waitHint')}</p>
          </div>
          <div data-monitor-count="sessions">
            <p className={css.statValue}>{catalogTops.length} <small>{t('monitor.stat.sessions')}</small></p>
            <p className={css.statHint}>{t('monitor.stat.openDone', { open: openCount, done: doneCount })}</p>
          </div>
        </div>
      </article>
      <article className={css.outputCard} data-monitor-region="output" aria-label={t('editor.label')}>
        <div className={css.ioTables}>
          <IoTable
            caption={t('monitor.input')}
            rows={inputRows}
            empty={t('monitor.inputEmpty')}
            streaming={false}
            t={t}
            onOpenFile={onOpenFile}
          />
          <IoTable
            caption={t('monitor.outputPane')}
            rows={outputRows}
            empty={t('monitor.outputEmpty')}
            streaming={file !== null && file.annotated.length > 0}
            t={t}
            onOpenFile={onOpenFile}
          />
        </div>
      </article>
      <section className={css.listCard} data-monitor-region="sessions" data-view={viewMode}>
        <div className={css.cardHead}>
          <h3 className={css.cardHeading}>{t('monitor.sessionHead', { count: tops.length })}</h3>
          <div className={css.viewSwitch} role="tablist" aria-label={t('monitor.sessionHead', { count: tops.length })}>
            {(['list', 'repo', 'board'] as const).map(item => (
              <button
                key={item}
                type="button"
                className={css.viewButton}
                aria-pressed={viewMode === item}
                onClick={() => onView(item)}
              >
                {t(item === 'list' ? 'monitor.view.list' : item === 'repo' ? 'monitor.view.repo' : 'monitor.view.board')}
              </button>
            ))}
          </div>
        </div>
        <div className={css.filter} role="tablist" aria-label={t('monitor.filter')}>
          {(['all', 'codex', 'antigravity'] as const).map(item => (
            <button
              key={item}
              type="button"
              className={css.filterButton}
              aria-pressed={filter === item}
              onClick={() => onFilter(item)}
            >
              {t(item === 'all' ? 'monitor.all' : item === 'codex' ? 'monitor.codex' : 'monitor.ag')}
            </button>
          ))}
        </div>
        {sessions.length === 0 ? <p className={css.empty}>{t('monitor.empty')}</p> : viewMode === 'board' ? (
          <div className={css.boardColumns}>
            {(['running', 'waiting', 'idle', 'expired'] as const).map(lane => (
              <div key={lane}>
                <p className={css.groupLabel}>{t(laneKey(lane))}</p>
                {tops.filter(session => laneOf(session, now) === lane).map(session => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    sessions={catalog}
                    selected={selected?.id === session.id}
                    now={now}
                    t={t}
                    onSelect={() => onSelect(session.id)}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className={css.sessionScroll}>
            {(viewMode === 'list'
              ? (['running', 'waiting', 'idle', 'expired'] as const)
                .map(lane => ({
                  key: lane,
                  label: `${t(laneKey(lane))} ${tops.filter(session => laneOf(session, now) === lane).length}`,
                  rows: tops.filter(session => laneOf(session, now) === lane),
                }))
              : [...new Set(tops.map(session => displayName(session, catalog)))]
                .map(name => ({ key: name, label: name, rows: tops.filter(session => displayName(session, catalog) === name) })))
              .filter(group => group.rows.length > 0)
              .map(group => (
                <div key={group.key}>
                  <p className={css.groupLabel}>{group.label}</p>
                  <ul className={css.sessions}>
                    {group.rows.map(session => (
                      <li key={session.id}>
                        <SessionRow
                          session={session}
                          sessions={catalog}
                          selected={selected?.id === session.id}
                          now={now}
                          t={t}
                          onSelect={() => onSelect(session.id)}
                        />
                        {viewMode === 'list' && sessions.filter(child => child.parentId === session.id).map(child => (
                          <SessionRow
                            key={child.id}
                            session={child}
                            sessions={catalog}
                            selected={selected?.id === child.id}
                            nested
                            now={now}
                            t={t}
                            onSelect={() => onSelect(child.id)}
                          />
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        )}
      </section>
      <section className={css.eventCard} data-monitor-region="events">
        <div className={css.cardHead}>
          <h3 className={css.cardHeading}>{t('monitor.events')}</h3>
          <p className={css.cardHint}>{t('monitor.eventsSince', {
            time: clock(sessions.flatMap(session => session.steps.map(step => step.at)).sort((left, right) => left - right)[0] ?? now),
          })}</p>
        </div>
        <ol className={css.trace}>
          {sessions.flatMap(session => session.steps.map(step => ({ session, step })))
            .sort((left, right) => right.step.at - left.step.at)
            .slice(0, 24)
            .map(({ session, step }) => {
              const openPath = step.action === 'write' || step.action === 'edit' ? step.label : undefined
              const row = (
                <>
                  <time className={css.traceTime}>{clock(step.at)}</time>
                  <span className={css.sessionTitle}>{displayName(session, catalog)}</span>
                  <span className={css.kind}>{t(actionKey(step.action))}</span>
                  <span className={css.traceBody}>{labelName(step.label)}</span>
                </>
              )
              return (
                <li
                  key={`${session.id}:${step.id}`}
                  className={step.status === 'running' ? `${css.traceRow} ${css.traceLive}` : css.traceRow}
                  data-workbench-trace={step.id}
                  data-status={step.status}
                >
                  {openPath === undefined ? row : (
                    <button
                      type="button"
                      className={css.traceOpen}
                      data-workbench-open-file={openPath}
                      onClick={() => onOpenFile(openPath)}
                    >
                      {row}
                    </button>
                  )}
                </li>
              )
            })}
        </ol>
      </section>
    </div>
  )
}

export function WorkbenchShell({
  t, useActivity, sessionOf, startSession, openSessions, openFiles, openSettings, useMonitor, SessionProvider, renderSlot,
}: WorkbenchShellProps) {
  const beginSession = startSession ?? ignoreSession
  const showSessions = openSessions ?? ignoreOpen
  const showFiles = openFiles ?? ignoreOpen
  const showSettings = openSettings ?? ignoreSession
  const [preference, setPreference] = useState(PREFERRED)
  const [container, setContainer] = useState(0)
  const [stepsOpen, setStepsOpen] = useState(true)
  const [traceOpen, setTraceOpen] = useState(true)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined)
  const [filter, setFilter] = useState<'all' | 'codex' | 'antigravity'>('all')
  const [monitorId, setMonitorId] = useState<string | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState<'overview' | 'sources'>('overview')
  const [night, setNight] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'repo' | 'board'>('list')
  const activity = useActivity(view => view)
  const monitor = useMonitor?.(view => view)
  const monitorMode = useMonitor !== undefined
  const needle = query.trim().toLowerCase()
  const visibleSessions = (monitor?.sessions ?? []).filter(session => filter === 'all' || session.agent === filter)
    .filter(session => needle === '' || `${session.title}\n${session.cwd}\n${session.prompt}`.toLowerCase().includes(needle))
  const tops = visibleSessions.filter(session => session.parentId === undefined
    || !visibleSessions.some(parent => parent.id === session.parentId))
  const selectedMonitor = visibleSessions.find(session => session.id === monitorId)
    ?? tops[0]
    ?? visibleSessions[0]
  const monitorFiles = (selectedMonitor?.files ?? []).map(monitorFile)
  const shownFiles = monitorMode ? monitorFiles : activity.files
  const file = monitorMode
    ? shownFiles.find(item => item.path === selectedPath) ?? shownFiles.find(item => item.annotated.length > 0) ?? shownFiles.at(-1) ?? null
    : visibleFile(activity, selectedPath)
  const session = sessionOf()
  const shellRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef(0)
  const capture = useRef<{ element: HTMLDivElement; id: number; origin: number; base: number } | null>(null)
  const rendered = container > 0 ? fitWorkflow(preference, container) : preference
  useLayoutEffect(() => {
    const el = shellRef.current
    if (typeof ResizeObserver !== 'function') return
    /* v8 ignore next -- the shell div renders before this effect, so the ref is set */
    if (el === null) return
    const measure = () => {
      const next = el.getBoundingClientRect().width
      if (next <= 0) return
      containerRef.current = next
      setContainer(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  useEffect(() => () => {
    const active = capture.current
    if (active !== null && active.element.hasPointerCapture(active.id)) active.element.releasePointerCapture(active.id)
  }, [])
  useEffect(() => {
    const onSessions = (event: Event): void => {
      const open = (event as CustomEvent<{ open?: boolean }>).detail?.open
      if (typeof open === 'boolean') setSessionsOpen(open)
    }
    const onFiles = (event: Event): void => {
      const open = (event as CustomEvent<{ open?: boolean }>).detail?.open
      if (typeof open === 'boolean') setFilesOpen(open)
    }
    window.addEventListener('dsh:workbench-sessions', onSessions)
    window.addEventListener('dsh:workbench-files', onFiles)
    return () => {
      window.removeEventListener('dsh:workbench-sessions', onSessions)
      window.removeEventListener('dsh:workbench-files', onFiles)
    }
  }, [])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || capture.current !== null) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    capture.current = { element: event.currentTarget, id: event.pointerId, origin: event.clientX, base: rendered }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = capture.current
    if (active?.id !== event.pointerId) return
    setPreference(fitWorkflow(active.base + event.clientX - active.origin, containerRef.current))
  }
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const active = capture.current
    if (active?.id !== event.pointerId) return
    capture.current = null
    if (active.element.hasPointerCapture(active.id)) active.element.releasePointerCapture(active.id)
    setPreference(fitWorkflow(active.base + event.clientX - active.origin, containerRef.current))
  }
  const onLostPointerCapture = (event: PointerEvent<HTMLDivElement>) => {
    if (capture.current?.id !== event.pointerId) return
    capture.current = null
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const delta = event.key === 'ArrowRight' ? 16 : -16
    setPreference(current => fitWorkflow(current + delta, containerRef.current))
  }
  const widthStyle = container > 0
    ? { '--dsh-workbench-workflow': `${rendered}px` } as CSSProperties
    : undefined
  const room = Math.max(0, container - RAIL_WIDTH)
  const editorFloor = room === 0 ? 0 : Math.min(PANE_MIN, room / 2)
  const valueMin = room === 0 ? 0 : Math.min(PANE_MIN, Math.max(0, room - editorFloor))
  const valueMax = room === 0 ? rendered : Math.max(valueMin, room - editorFloor)

  return (
    <div
      ref={shellRef}
      className={css.shell}
      data-workbench-shell=""
      data-dsh-workbench=""
      data-monitor={monitor !== undefined ? '' : undefined}
      data-theme={night ? 'night' : undefined}
      style={widthStyle}
    >
      <nav className={css.rail} aria-label={t('rail.label')}>
        <div className={css.railGroup}>
          {monitor !== undefined && (
            <>
              <span className={css.mark}>{t('monitor.mark')}</span>
              <button
                type="button"
                className={css.navItem}
                aria-label={t('monitor.overview')}
                aria-current={page === 'overview' ? 'page' : undefined}
                onClick={() => setPage('overview')}
              >
                <IconLayersOutlineMedium size={18} />
                <span>{t('monitor.overview')}</span>
              </button>
              <button
                type="button"
                className={css.navItem}
                aria-label={t('monitor.sources')}
                aria-current={page === 'sources' ? 'page' : undefined}
                onClick={() => setPage('sources')}
              >
                <IconFolderCloseMedium size={18} />
                <span>{t('monitor.sources')}</span>
              </button>
              <button type="button" className={css.navItem} aria-label={t('rail.settings')} onClick={showSettings}>
                <IconSettingsOutlineMedium size={18} />
                <span>{t('rail.settings')}</span>
              </button>
            </>
          )}
          {monitor === undefined && RAIL.map((item) => {
            const Icon = item.Icon
            const pressed = item.id === 'chat' ? sessionsOpen : item.id === 'files' ? filesOpen : undefined
            return (
              <button
                key={item.id}
                type="button"
                className={css.railButton}
                aria-label={t(item.nameKey)}
                aria-current={item.current ? 'page' : undefined}
                aria-pressed={pressed}
                onClick={() => {
                  if (item.id === 'workflow') {
                    showSessions(false)
                    showFiles(false)
                    return
                  }
                  if (item.id === 'chat') {
                    beginSession()
                    showSessions(true)
                    return
                  }
                  showFiles(!filesOpen)
                }}
              >
                <Icon size={18} />
              </button>
            )
          })}
        </div>
        {monitor === undefined && (
          <button type="button" className={`${css.railButton} ${css.railSettings}`} aria-label={t('rail.settings')} onClick={showSettings}>
            <IconSettingsOutlineMedium size={18} />
          </button>
        )}
      </nav>
      <section className={css.workflow} aria-label={t('section.workflow')}>
        <header className={`${css.workflowHead} ${css.paneTop}`} data-window-drag>
          {monitor === undefined && <IconBranchOutlineMedium size={16} />}
          <h2 className={css.topTitle}>{monitor !== undefined ? t('monitor.title') : t('section.workflow')}</h2>
          {monitor !== undefined && (
            <>
              <span className={css.watching}>
                {t('monitor.watchingLine', { count: monitor.sessions.length, sources: sourceLabel(monitor.sessions, t) })}
                {' '}
                <span className={css.checked}>{t('monitor.updated', {
                  n: Math.max(0, Math.floor((Date.now() - latestAt(monitor.sessions, Date.now())) / 1000)),
                })}</span>
              </span>
              <label className={css.search}>
                <IconSearchOutlineMedium size={16} />
                <input
                  type="search"
                  aria-label={t('monitor.search')}
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                />
              </label>
              <div className={css.themeSeg}>
                <button type="button" className={css.themeButton} aria-pressed={night} onClick={() => setNight(true)}>
                  {t('monitor.night')}
                </button>
                <button type="button" className={css.themeButton} aria-pressed={!night} onClick={() => setNight(false)}>
                  {t('monitor.day')}
                </button>
              </div>
            </>
          )}
        </header>
        {monitor !== undefined && (
          <MonitorBoard
            t={t}
            sessions={visibleSessions}
            catalog={monitor.sessions}
            selected={selectedMonitor}
            filter={filter}
            page={page}
            viewMode={viewMode}
            file={file}
            now={Date.now()}
            onFilter={setFilter}
            onView={setViewMode}
            onSelect={(id) => { setMonitorId(id); setSelectedPath(undefined) }}
            onOpenFile={setSelectedPath}
          />
        )}
        {monitor === undefined && (
          <div className={css.workflowBody} data-all-collapsed={stepsOpen || traceOpen ? undefined : ''}>
            <div className={stepsOpen ? css.stepsPane : `${css.stepsPane} ${css.paneCollapsed}`} data-workbench-steps-pane="" data-collapsed={stepsOpen ? undefined : ''}>
              <PaneToggle open={stepsOpen} label={t('section.steps')} onToggle={() => setStepsOpen(open => !open)} />
              {stepsOpen && <ol className={css.steps}>
                {activity.steps.map((step, index) => {
                  const active = step.status === 'active'
                  const waiting = step.status === 'waiting'
                  return (
                    <li
                      key={step.id}
                      className={active ? css.stepActive : waiting ? `${css.step} ${css.stepWaiting}` : css.step}
                      data-workbench-step={step.id}
                      data-status={step.status}
                      aria-current={active ? 'step' : undefined}
                    >
                      <span className={css.marker} aria-hidden="true">
                        {step.status === 'done'
                          ? <IconCheckCircleFillMedium size={16} />
                          : <span className={step.status === 'active' ? css.dotActive : css.dotWaiting} />}
                      </span>
                      <div>
                        <div className={css.stepMain}>
                          <span className={css.stepIndex}>{index + 1}</span>
                          <span className={css.stepTitle}>{stepTitle(step, t)}</span>
                          <span className={css.stepStatus}>{t(STATUS_KEY[step.status])}</span>
                          {step.time !== undefined && <time className={css.stepTime} dateTime={step.time}>{step.time}</time>}
                        </div>
                        {step.detail !== undefined && step.path !== undefined && (
                          <p className={css.stepDetail}>{t(step.detail === 'writing' ? 'step.detail.writing' : 'step.detail.editing', { path: step.path })}</p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>}
            </div>
            <div className={traceOpen ? css.tracePane : `${css.tracePane} ${css.paneCollapsed}`} data-workbench-trace-pane="" data-collapsed={traceOpen ? undefined : ''}>
              <PaneToggle open={traceOpen} label={t('section.trajectory')} onToggle={() => setTraceOpen(open => !open)} />
              {traceOpen && <ol className={css.trace}>
                {activity.trace.map((event) => {
                  const Icon = TRACE_ICON[event.action]
                  const path = openablePath(event, activity.files)
                  const row = (
                    <>
                      <Icon size={14} />
                      <span className={css.kind}>{event.kind}</span>
                      <span className={css.traceBody}>{traceBody(event, t)}</span>
                      <time className={css.traceTime} dateTime={event.time}>{event.time}</time>
                    </>
                  )
                  return (
                    <li key={event.id} className={css.traceRow} data-workbench-trace={event.id} data-status={event.status}>
                      {path === undefined ? row : (
                        <button
                          type="button"
                          className={css.traceOpen}
                          aria-current={file?.path === path ? 'true' : undefined}
                          aria-label={t('trajectory.open', { path })}
                          data-workbench-open-file={path}
                          onClick={() => setSelectedPath(path)}
                        >
                          {row}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ol>}
            </div>
          </div>
        )}
        <div className={monitor !== undefined ? css.composerDock : css.composer} data-workbench-composer="">
          <SessionProvider session={session} empty={() => renderSlot('workbench.composer', {})}>
            {renderSlot('workbench.composer', {})}
          </SessionProvider>
        </div>
      </section>
      {monitor === undefined && (
        <section className={css.editor} aria-label={t('editor.label')} data-workbench-editor-file={file?.path ?? ''}>
          <div className={`${css.editorHead} ${css.tabBar} ${css.paneTop}`} data-window-drag>
            {shownFiles.length > 1 ? (
              <div className={css.tabs} role="tablist" aria-label={t('editor.tabs')}>
                {shownFiles.map(item => (
                  <button
                    key={item.path}
                    type="button"
                    role="tab"
                    className={css.tab}
                    aria-label={fileName(item)}
                    aria-selected={file?.path === item.path}
                    data-workbench-file-tab={item.path}
                    onClick={() => setSelectedPath(item.path)}
                  >
                    {item.badge !== '' && <span className={css.badge}>{item.badge}</span>}
                    <span className={css.tabPath}>{fileName(item)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <>
                {file !== null && file.badge !== '' && <span className={css.badge}>{file.badge}</span>}
                <span className={css.tabPath}>{file?.path ?? ''}</span>
              </>
            )}
          </div>
          {file === null ? (
            <p className={css.empty}>{t('editor.empty')}</p>
          ) : (
            <>
              <p className={css.crumbs}>
                {file.crumbs.map((crumb, index) => (
                  <span key={`${index}-${crumb}`} className={css.crumb}>
                    {index > 0 && <IconChevronRightOutlineMedium size={12} />}
                    {crumb}
                  </span>
                ))}
              </p>
              <div className={css.codeScroll}>
                {file.lines.map((line, index) => {
                  const lineNo = index + 1
                  return (
                    <div key={lineNo} className={css.codeLine}>
                      <span className={css.lineNo}>{lineNo}</span>
                      <code className={css.lineCode}>
                        {sourceTokens(line).map((value, tokenIndex) => (
                          <span key={tokenIndex} className={css[tokenKind(value)]}>{value}</span>
                        ))}
                      </code>
                      {file.annotated.includes(lineNo) && <span className={css.annotation}>{t('editor.written')}</span>}
                    </div>
                  )
                })}
              </div>
              <p className={css.statusBar}>
                <span className={css.statusCursor}>{t('editor.cursor', { line: file.cursorLine, column: file.cursorColumn })}</span>
                <span className={css.statusGroup}>
                  <span>{t('editor.encoding')}</span>
                  <span>{t('editor.newlines')}</span>
                  <span>{t('editor.indent')}</span>
                </span>
              </p>
            </>
          )}
        </section>
      )}
      {monitor === undefined && (
        <div
          className={css.handle}
          role="separator"
          aria-orientation="vertical"
          aria-label={t('resize.label')}
          aria-valuemin={valueMin}
          aria-valuemax={valueMax}
          aria-valuenow={rendered}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={onLostPointerCapture}
          onKeyDown={onKeyDown}
        />
      )}
    </div>
  )
}
