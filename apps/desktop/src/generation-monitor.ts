/**
 * Read-only listing of local Codex and Antigravity JSONL logs.
 * Refuses credentials, browser state, and archived session databases.
 */
import { watch, type FSWatcher } from 'node:fs'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, normalize, sep } from 'node:path'

/** One JSONL log the page may tail. */
export interface ListedLog {
  /** Absolute path. */
  readonly path: string
  /** Product that owns the file. */
  readonly product: 'codex' | 'antigravity' | 'antigravity-cli'
}

const DENIED = [
  /(?:^|[/\\])auth\.json$/iu,
  /[/\\]cookies([/\\]|$)/iu,
  /[/\\]application support[/\\]/iu,
  /[/\\]archived_sessions[/\\]/iu,
  /thread_history/iu,
  /\.sqlite(-wal|-shm)?$/iu,
]

/**
 * Whether a path may be read for the monitor.
 * @param path - candidate absolute path.
 * @param roots - home and any configured Codex home.
 * @returns true when the path stays under a root and is not a secret.
 */
export function monitorPathAllowed(path: string, roots: readonly string[]): boolean {
  const resolved = normalize(path)
  if (DENIED.some(pattern => pattern.test(resolved))) return false
  return roots.some((root) => {
    const base = normalize(root)
    return resolved === base || resolved.startsWith(base.endsWith(sep) ? base : base + sep)
  })
}

/**
 * Codex home from the environment, then config.toml, then ~/.codex.
 * @param home - user home.
 * @param env - process environment.
 * @param configText - ~/.codex/config.toml text, when it exists.
 * @returns the directory that contains sessions/.
 */
export function codexHomeCandidates(home: string, env: NodeJS.ProcessEnv, configText: string | undefined): string[] {
  const match = /^\s*CODEX_HOME\s*=\s*"?([^"\n#]+)"?\s*$/mu.exec(configText ?? '')
  const configured = match?.[1]?.trim()
  const xdg = env.XDG_CONFIG_HOME
  return [
    env.CODEX_HOME,
    configured,
    xdg !== undefined && xdg !== '' ? join(xdg, 'codex') : undefined,
    join(home, '.codex'),
    join(home, '.config', 'codex'),
  ].filter((dir): dir is string => dir !== undefined && dir !== '')
}

export function resolveCodexHome(home: string, env: NodeJS.ProcessEnv, configText: string | undefined): string {
  return codexHomeCandidates(home, env, configText)[0] ?? join(home, '.codex')
}

function dayStamp(date: Date): { year: string; month: string; day: string } {
  return {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    day: String(date.getDate()).padStart(2, '0'),
  }
}

async function rollouts(root: string, date: Date): Promise<ListedLog[]> {
  const stamp = dayStamp(date)
  const dir = join(root, 'sessions', stamp.year, stamp.month, stamp.day)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error: unknown) {
    // A missing day directory means there is no local session yet.
    if (error instanceof Error) return []
    return []
  }
  return names
    .filter(name => name.startsWith('rollout-') && name.endsWith('.jsonl'))
    .map(name => ({ path: join(dir, name), product: 'codex' as const }))
}

async function transcripts(root: string, product: ListedLog['product']): Promise<ListedLog[]> {
  let names: string[]
  try {
    names = await readdir(root)
  } catch (error: unknown) {
    if (error instanceof Error) return []
    return []
  }
  const logs: ListedLog[] = []
  for (const name of names) {
    const dir = join(root, name, '.system_generated', 'logs')
    let files: string[]
    try {
      files = await readdir(dir)
    } catch (error: unknown) {
      if (error instanceof Error) continue
      continue
    }
    const full = files.includes('transcript_full.jsonl')
      ? 'transcript_full.jsonl'
      : files.includes('transcript.jsonl') ? 'transcript.jsonl' : ''
    if (full !== '') logs.push({ path: join(dir, full), product })
  }
  return logs
}

/**
 * Today's and yesterday's Codex rollouts, plus Antigravity app and CLI transcripts.
 * @param now - clock for the day folders.
 * @param env - environment, including optional CODEX_HOME.
 * @returns logs that exist. Missing homes are skipped.
 */
export async function listGenerationLogs(
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env,
  homeDir = homedir(),
): Promise<ListedLog[]> {
  let config: string | undefined
  try {
    config = await readFile(join(homeDir, '.codex', 'config.toml'), 'utf8')
  } catch (error: unknown) {
    if (error instanceof Error) config = undefined
  }
  let codex = resolveCodexHome(homeDir, env, config)
  for (const candidate of codexHomeCandidates(homeDir, env, config)) {
    try {
      if ((await stat(join(candidate, 'sessions'))).isDirectory()) {
        codex = candidate
        break
      }
    } catch (error: unknown) {
      if (error instanceof Error) continue
    }
  }
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const logs = [
    ...await rollouts(codex, now),
    ...await rollouts(codex, yesterday),
    ...await transcripts(join(homeDir, '.gemini', 'antigravity', 'brain'), 'antigravity'),
    ...await transcripts(join(homeDir, '.gemini', 'antigravity-cli', 'brain'), 'antigravity-cli'),
  ]
  const roots = [homeDir, codex]
  return logs.filter(log => monitorPathAllowed(log.path, roots))
}

/**
 * Read a slice of a permitted file.
 * @param path - absolute path.
 * @param offset - byte offset.
 * @param max - maximum bytes.
 * @param roots - allowed roots.
 * @returns decoded text, or null when the path is refused or missing.
 */
export async function readGenerationSlice(
  path: string,
  offset: number,
  max: number,
  roots: readonly string[],
): Promise<{ text: string; size: number; bytes: number } | null> {
  if (!monitorPathAllowed(path, roots) || offset < 0 || max <= 0) return null
  let file: Awaited<ReturnType<typeof open>>
  try {
    file = await open(path, 'r')
  } catch (error: unknown) {
    if (error instanceof Error) return null
    return null
  }
  try {
    const info = await file.stat()
    if (!info.isFile() || offset >= info.size) return { text: '', size: info.size, bytes: 0 }
    const length = Math.min(max, info.size - offset)
    const buffer = Buffer.alloc(length)
    const result = await file.read(buffer, 0, length, offset)
    return { text: buffer.subarray(0, result.bytesRead).toString('utf8'), size: info.size, bytes: result.bytesRead }
  } finally {
    await file.close()
  }
}

/** Directories whose changes should wake the page. */
export function watchGeneration(onChange: () => void, env: NodeJS.ProcessEnv = process.env): () => void {
  const home = homedir()
  const roots = [join(home, '.codex', 'sessions'), join(home, '.gemini', 'antigravity', 'brain'), join(home, '.gemini', 'antigravity-cli', 'brain')]
  if (env.CODEX_HOME !== undefined && env.CODEX_HOME !== '') roots.push(join(env.CODEX_HOME, 'sessions'))
  const watchers: FSWatcher[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  const fire = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(onChange, 300)
  }
  for (const root of roots) {
    try {
      watchers.push(watch(root, { persistent: false }, fire))
    } catch (error: unknown) {
      // A home that is not on this machine has nothing to watch.
      if (error instanceof Error) continue
    }
  }
  return () => {
    if (timer !== undefined) clearTimeout(timer)
    for (const item of watchers) item.close()
  }
}

/** Allowed roots for the current user. */
export async function generationRoots(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const home = homedir()
  let config: string | undefined
  try {
    config = await readFile(join(home, '.codex', 'config.toml'), 'utf8')
  } catch (error: unknown) {
    if (error instanceof Error) config = undefined
  }
  return [home, resolveCodexHome(home, env, config)]
}
