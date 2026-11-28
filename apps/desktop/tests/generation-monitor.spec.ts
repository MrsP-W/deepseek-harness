/** Local log discovery stays read-only and skips secrets and compressed history. */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listGenerationLogs, monitorPathAllowed, readGenerationSlice, resolveCodexHome } from '../src/generation-monitor.ts'

describe('generation monitor paths', () => {
  it('prefers CODEX_HOME, then config.toml, then ~/.codex', () => {
    expect(resolveCodexHome('/Users/me', { CODEX_HOME: '/opt/codex' }, 'CODEX_HOME = "/ignored"')).toBe('/opt/codex')
    expect(resolveCodexHome('/Users/me', {}, 'CODEX_HOME = "/from/config"\n')).toBe('/from/config')
    expect(resolveCodexHome('/Users/me', {}, undefined)).toBe('/Users/me/.codex')
  })

  it('refuses credentials, browser state, archives, and paths outside the home', () => {
    const roots = ['/Users/me']
    expect(monitorPathAllowed('/Users/me/.codex/auth.json', roots)).toBe(false)
    expect(monitorPathAllowed('/Users/me/Library/Application Support/Google/Chrome/Cookies', roots)).toBe(false)
    expect(monitorPathAllowed('/Users/me/.codex/archived_sessions/old.jsonl', roots)).toBe(false)
    expect(monitorPathAllowed('/Users/me/.codex/thread_history_1.sqlite', roots)).toBe(false)
    expect(monitorPathAllowed('/etc/passwd', roots)).toBe(false)
    expect(monitorPathAllowed('/Users/me/Projects/aurora-sync/src/cli.ts', roots)).toBe(true)
  })

  it('lists today\'s rollout and the full transcript, and skips compressed history', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-monitor-'))
    const day = join(home, '.codex', 'sessions', '2026', '11', '28')
    await mkdir(day, { recursive: true })
    await writeFile(join(day, 'rollout-2026-11-28T12-06-00-00000000-0000-4000-8000-0000000000c1.jsonl'), '{}\n')
    await writeFile(join(day, 'rollout-old.jsonl.zst'), 'compressed')
    const brain = join(home, '.gemini', 'antigravity', 'brain', 'conv', '.system_generated', 'logs')
    await mkdir(brain, { recursive: true })
    await writeFile(join(brain, 'transcript_full.jsonl'), '{}\n')
    await writeFile(join(brain, 'transcript.jsonl'), '{}\n')
    const logs = await listGenerationLogs(new Date(2026, 10, 28, 12, 0, 0), {}, home)
    expect(logs.map(log => log.product).sort()).toEqual(['antigravity', 'codex'])
    expect(logs.some(log => log.path.endsWith('.zst'))).toBe(false)
    expect(logs.some(log => log.path.endsWith('transcript.jsonl') && !log.path.endsWith('transcript_full.jsonl'))).toBe(false)
    const text = await readGenerationSlice(logs.find(log => log.product === 'codex')?.path ?? '', 0, 20, [home])
    expect(text?.text).toBe('{}\n')
    expect(await readGenerationSlice(join(home, '.codex', 'auth.json'), 0, 20, [home])).toBeNull()
  })
})
