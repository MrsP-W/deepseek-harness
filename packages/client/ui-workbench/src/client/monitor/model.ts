/**
 * Read-only view of local Codex and Antigravity code-generation logs.
 * Sessions from the two products stay separate even when their ids look alike.
 */

/** Which product wrote the session. */
export type MonitorAgent = 'codex' | 'antigravity'

/** Where that product was running. */
export type MonitorSurface = 'desktop' | 'exec' | 'subagent' | 'app' | 'cli'

/** One trace row. */
export type MonitorAction = 'read' | 'command' | 'write' | 'edit'

/** Whether a session or step is still moving. */
export type MonitorStatus = 'running' | 'done' | 'error'

/** One read, command, write, or edit. */
export interface MonitorStep {
  /** Stable identity inside the session. */
  readonly id: string
  /** Unix epoch milliseconds. */
  readonly at: number
  /** What the row shows. */
  readonly action: MonitorAction
  /** File path or command text. */
  readonly label: string
  /** Step lifecycle. */
  readonly status: MonitorStatus
}

/** A file written or edited during the session. */
export interface MonitorFile {
  /** Path as recorded by the agent. */
  readonly path: string
  /** Last path segment. */
  readonly name: string
  /** Current text, empty until a read succeeds. */
  readonly content: string
  /** The file changed a few seconds ago, or its write is still running. */
  readonly fresh: boolean
  /** Whether the latest touch created or edited it. */
  readonly action: 'write' | 'edit'
  /** Unix epoch milliseconds of the latest touch. */
  readonly at: number
}

/** Text the session read, or the file text before an edit. */
export interface MonitorRead {
  /** Path from the log. The label uses only the final filename. */
  readonly path: string
  /** Final filename. */
  readonly name: string
  /** Read result or pre-edit text captured from the log. */
  readonly content: string
  /** Unix epoch milliseconds of the read, when the log has one. */
  readonly at?: number
}

/** One local agent session, including a nested subagent. */
export interface MonitorSession {
  /** Product-scoped identity. */
  readonly id: string
  /** Codex or Antigravity. */
  readonly agent: MonitorAgent
  /** Desktop, exec, subagent, app, or CLI. */
  readonly surface: MonitorSurface
  /** First user request, or a short fallback. */
  readonly title: string
  /** Working directory, possibly empty. */
  readonly cwd: string
  /** Unix epoch milliseconds. */
  readonly startedAt: number
  /** Session lifecycle. */
  readonly status: MonitorStatus
  /** The user request shown above the trace. */
  readonly prompt: string
  /** Parent session id when this row is a subagent. */
  readonly parentId?: string
  /** Trace rows, oldest first, capped. */
  readonly steps: readonly MonitorStep[]
  /** Files touched by write or edit steps. */
  readonly files: readonly MonitorFile[]
  /** Read results and pre-edit text. Omitted when the log has none. */
  readonly reads?: readonly MonitorRead[]
}

/** The page's current local picture. */
export interface MonitorSnapshot {
  /** Newest sessions first. Running count ignores nested subagents. */
  readonly sessions: readonly MonitorSession[]
  /** Top-level sessions that are still running. */
  readonly running: number
}

/** Snapshot used before the first successful read. */
export const EMPTY_MONITOR: MonitorSnapshot = { sessions: [], running: 0 }

/** How much of one log file a single read may pull. */
export const MONITOR_READ_MAX = 1_500_000

/** How much of a generated source file the page may show. */
export const MONITOR_FILE_MAX = 120_000

/** A listed log the host is willing to read. */
export interface MonitorLog {
  /** Absolute path of a JSONL log. */
  readonly path: string
  /** Product that owns the file. */
  readonly product: 'codex' | 'antigravity' | 'antigravity-cli'
}

/** Host file bridge. Every method is read-only and already path-filtered. */
export interface MonitorBridge {
  /** JSONL logs worth tailing. */
  files(): Promise<readonly MonitorLog[]>
  /**
   * Read bytes from a log as text.
   * @param path - log path returned by {@link MonitorBridge.files}.
   * @param offset - byte offset.
   * @param max - maximum bytes.
   * @returns the decoded slice, or null when the file cannot be read.
   */
  read(path: string, offset: number, max: number): Promise<{ text: string; size: number; bytes: number } | null>
  /**
   * Read a generated source file.
   * @param path - project path named by a write or edit.
   * @param max - maximum characters.
   * @returns text, or null when the file cannot be read.
   */
  readText(path: string, max: number): Promise<string | null>
  /**
   * Hear that a watched log directory changed.
   * @param listener - called after a filesystem event.
   * @returns unsubscribe.
   */
  subscribe(listener: () => void): () => void
}
