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
  IconCheckCircleFillMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ActivityFile, ActivityStep, ActivityTrace, WorkbenchView } from './activity.ts'
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

function visibleFile(activity: WorkbenchView, selectedPath: string | undefined): ActivityFile | null {
  if (selectedPath !== undefined) {
    const chosen = activity.files.find(file => file.path === selectedPath)
    if (chosen !== undefined) return chosen
  }
  return activity.file
}

function openablePath(event: ActivityTrace, files: readonly ActivityFile[]): string | undefined {
  return event.path !== undefined && files.some(file => file.path === event.path) ? event.path : undefined
}

/**
 * Render the two-column workbench shell.
 * @param props - Copy, the Session projection, and the official composer seat.
 * @returns The rail, workflow column, editor column, and the column separator.
 */

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

export function WorkbenchShell({
  t, useActivity, sessionOf, startSession = () => {}, openSessions = () => {}, openFiles = () => {},
  openSettings = () => {}, SessionProvider, renderSlot,
}: WorkbenchShellProps) {
  const [preference, setPreference] = useState(PREFERRED)
  const [container, setContainer] = useState(0)
  const [stepsOpen, setStepsOpen] = useState(true)
  const [traceOpen, setTraceOpen] = useState(true)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined)
  const activity = useActivity(view => view)
  const file = visibleFile(activity, selectedPath)
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
    <div ref={shellRef} className={css.shell} data-workbench-shell="" data-dsh-workbench="" style={widthStyle}>
      <nav className={css.rail} aria-label={t('rail.label')}>
        <div className={css.railGroup}>
          {RAIL.map((item) => {
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
                    openSessions(false)
                    openFiles(false)
                    return
                  }
                  if (item.id === 'chat') {
                    startSession()
                    openSessions(true)
                    return
                  }
                  openFiles(!filesOpen)
                }}
              >
                <Icon size={18} />
              </button>
            )
          })}
        </div>
        <button type="button" className={`${css.railButton} ${css.railSettings}`} aria-label={t('rail.settings')} onClick={openSettings}>
          <IconSettingsOutlineMedium size={18} />
        </button>
      </nav>
      <section className={css.workflow} aria-label={t('section.workflow')}>
        <h2 className={`${css.workflowHead} ${css.paneTop}`} data-window-drag>
          <IconBranchOutlineMedium size={16} />
          {t('section.workflow')}
        </h2>
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
        <div className={css.composer} data-workbench-composer="">
          <SessionProvider session={session} empty={() => renderSlot('workbench.composer', {})}>
            {renderSlot('workbench.composer', {})}
          </SessionProvider>
        </div>
      </section>
      <section className={css.editor} aria-label={t('editor.label')} data-workbench-editor-file={file?.path ?? ''}>
        <div className={`${css.editorHead} ${css.tabBar} ${css.paneTop}`} data-window-drag>
          {activity.files.length > 1 ? (
            <div className={css.tabs} role="tablist" aria-label={t('editor.tabs')}>
              {activity.files.map(item => (
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
    </div>
  )
}
