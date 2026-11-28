/** Codex and Antigravity logs become sessions, and a second poll only reads new bytes. */
import { describe, expect, it, vi } from 'vitest'
import type { MonitorBridge, MonitorLog } from '../src/client/monitor/model.ts'
import { createDraft, ingestLines, publishDrafts, splitChunk } from '../src/client/monitor/parse.ts'
import { pollMonitor, type LogCursor } from '../src/client/monitor/poll.ts'
import { startMonitor } from '../src/client/index.ts'

const NOW = Date.parse('2026-11-28T04:10:00.000Z')
const PARENT = '00000000-0000-4000-8000-0000000000aa'
const CHILD = '00000000-0000-4000-8000-0000000000bb'

function line(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

describe('splitChunk', () => {
  it('keeps an unfinished last line for the next read', () => {
    const text = `${line({ type: 'session_meta' })}{"type":"event_msg"`
    const split = splitChunk(text, text.length, false)
    expect(split.complete.endsWith('\n')).toBe(true)
    expect(split.advance).toBeLessThan(text.length)
    const rest = splitChunk(`${text.slice(split.advance)}{"payload":{}}\n`, 20, true)
    expect(rest.complete).toContain('event_msg')
    const huge = splitChunk('{"partial"', 900_001, false)
    expect(huge.complete).toBe('')
    expect(huge.advance).toBe(900_001)
  })
})

describe('Codex and Antigravity folds', () => {
  it('nests a Codex subagent and keeps the first session_meta', () => {
    const parent = createDraft({ path: `/tmp/rollout-2026-11-28T12-01-00-${PARENT}.jsonl`, product: 'codex' })
    ingestLines(parent, [
      line({ timestamp: '2026-11-28T04:01:00.000Z', type: 'session_meta', payload: { id: PARENT, cwd: '/Projects/aurora-sync', originator: 'Codex Desktop', source: 'vscode' } }),
      line({ timestamp: '2026-11-28T04:01:05.000Z', type: 'session_meta', payload: { id: 'parent-replay', cwd: '/elsewhere' } }),
      line({ timestamp: '2026-11-28T04:01:06.000Z', type: 'event_msg', payload: { type: 'user_message', message: '为 aurora-sync 补充单元测试' } }),
      line({ timestamp: '2026-11-28T04:01:20.000Z', type: 'event_msg', payload: { type: 'exec_command_end', command: ['cat', 'README.md'], exit_code: 0 } }),
      line({ timestamp: '2026-11-28T04:01:30.000Z', type: 'event_msg', payload: { type: 'patch_apply_end', changes: { 'src/cli.ts': { type: 'update' } } } }),
      line({ timestamp: '2026-11-28T04:02:00.000Z', type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ command: 'ls src/sync' }) } }),
    ].join(''), NOW)
    const child = createDraft({ path: `/tmp/rollout-2026-11-28T12-02-00-${CHILD}.jsonl`, product: 'codex' })
    ingestLines(child, line({
      type: 'session_meta',
      payload: { id: CHILD, cwd: '/Projects/aurora-sync', originator: 'Codex Desktop', source: { subagent: { thread_spawn: { parent_thread_id: PARENT, depth: 1 } } } },
    }), NOW)
    const view = publishDrafts([parent, child], NOW)
    expect(parent.cwd).toBe('/Projects/aurora-sync')
    expect(parent.metaId).toBe(PARENT)
    expect(parent.title).toBe('为 aurora-sync 补充单元测试')
    expect(parent.steps.map(step => step.action)).toEqual(['read', 'edit', 'command'])
    expect(child.surface).toBe('subagent')
    expect(view.sessions.find(session => session.id === child.id)?.parentId).toBe(parent.id)
  })

  it('reads an Antigravity transcript, including a still-running write', () => {
    const draft = createDraft({ path: '/brain/conv/.system_generated/logs/transcript_full.jsonl', product: 'antigravity' })
    ingestLines(draft, [
      line({ step_index: 0, source: 'USER', type: 'user', status: 'DONE', created_at: '2026-11-28T04:06:00.000Z', content: '给 aurora-sync 加上本机文件监听' }),
      line({ step_index: 1, source: 'MODEL', type: 'tool', status: 'DONE', created_at: '2026-11-28T04:06:10.000Z', tool_calls: [{ name: 'view_file', args: { AbsolutePath: 'README.md' } }] }),
      line({ step_index: 2, source: 'MODEL', type: 'tool', status: 'DONE', created_at: '2026-11-28T04:08:00.000Z', tool_calls: [{ name: 'write_to_file', args: { TargetFile: 'src/sync/manifest.ts', Content: 'export const n = 1\n' } }] }),
      line({ step_index: 3, source: 'MODEL', type: 'tool', status: 'RUNNING', created_at: '2026-11-28T04:09:00.000Z', tool_calls: [{ name: 'write_file', args: { Path: 'src/sync/watcher.ts', Content: 'export {}\n' } }] }),
    ].join(''), NOW)
    expect(draft.surface).toBe('app')
    expect(draft.status).toBe('running')
    expect(draft.files.map(file => file.path)).toEqual(['src/sync/manifest.ts', 'src/sync/watcher.ts'])
    expect(draft.files[1]?.fresh).toBe(true)
    expect(draft.files[0]?.content).toContain('export const n')
    const replaced = createDraft({ path: '/cli/brain/conv/transcript_full.jsonl', product: 'antigravity-cli' })
    ingestLines(replaced, line({ step_index: 1, source: 'MODEL', type: 'tool', status: 'DONE', tool_calls: [{ name: 'replace_file_content', args: { TargetFile: 'src/cli.ts' } }] }), NOW)
    expect(replaced.surface).toBe('cli')
    expect(replaced.steps[0]?.action).toBe('edit')
  })

  it('keeps the conversation title, read text, and the text before an edit', () => {
    const titled = (title: string, message: string) => {
      const draft = createDraft({ path: `/tmp/rollout-${PARENT}.jsonl`, product: 'codex' })
      ingestLines(draft, [
        line({
          type: 'session_meta',
          payload: { id: PARENT, cwd: '/Projects/taskmarket-tsk-brk611an', title, originator: 'Codex Desktop' },
        }),
        line({ type: 'event_msg', payload: { type: 'user_message', message } }),
      ].join(''), NOW)
      return draft.title
    }
    expect(titled('补同步监听', '请改 app.js')).toBe('补同步监听')
    expect(titled('notes.jsonl', '请改 app.js')).toBe('请改 app.js')
    expect(titled('/tmp/x', '请改 app.js')).toBe('请改 app.js')
    expect(titled('C:\\temp', '请改 app.js')).toBe('请改 app.js')
    const named = createDraft({ path: `/tmp/rollout-${PARENT}.jsonl`, product: 'codex' })
    ingestLines(named, line({ type: 'session_meta', payload: { id: PARENT, name: '从名字来' } }), NOW)
    expect(named.title).toBe('从名字来')
    const draft = createDraft({ path: `/tmp/rollout-${CHILD}.jsonl`, product: 'codex' })
    const file = '/Users/wei/Documents/CodexProjects/demo/public/app.js'
    ingestLines(draft, [
      line({ type: 'session_meta', payload: { id: CHILD, cwd: '/Projects/taskmarket-tsk-brk611an', thread_name: '补同步监听' } }),
      line({ type: 'event_msg', payload: { type: 'user_message', message: '请改 app.js' } }),
      line({ type: 'response_item', payload: { type: 'function_call', name: 'read_file', arguments: JSON.stringify({ path: file }) } }),
      line({ type: 'response_item', payload: { type: 'function_call_output', output: 1 } }),
      line({ type: 'response_item', payload: { type: 'function_call_output', output: {} } }),
    ].join(''), NOW)
    expect(draft.title).toBe('补同步监听')
    expect(draft.prompt).toBe('请改 app.js')
    expect(draft.reads).toEqual([])
    ingestLines(draft, line({ type: 'response_item', payload: { type: 'function_call_output', output: { text: 'from text\n' } } }), NOW)
    expect(draft.reads[0]?.content).toBe('from text\n')
    expect(draft.reads[0]?.name).toBe('app.js')
    ingestLines(draft, line({ type: 'response_item', payload: { type: 'tool_result', output: '' } }), NOW)
    expect(draft.reads[0]?.content).toBe('from text\n')
    ingestLines(draft, line({
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'edit',
        arguments: JSON.stringify({ path: file, old_string: 'const before = 1', new_string: 'const after = 2\n' }),
      },
    }), NOW)
    expect(draft.reads[0]?.content).toBe('const before = 1')
    expect(draft.files[0]?.content).toContain('const after')
    ingestLines(draft, line({
      type: 'event_msg',
      payload: { type: 'exec_command_end', command: `cat ${file}`, aggregated_output: 'const before = 1\n', exit_code: 0 },
    }), NOW)
    expect(draft.reads[0]?.content).toBe('const before = 1\n')
    const long = 'x'.repeat(80_001)
    ingestLines(draft, line({
      type: 'response_item',
      payload: { type: 'function_call', name: 'read_file', arguments: JSON.stringify({ path: 'long.js', content: long }) },
    }), NOW)
    expect(draft.reads.find(item => item.name === 'long.js')?.content).toHaveLength(80_000)
    const published = publishDrafts([draft], NOW)
    expect(published.sessions[0]?.reads?.[0]?.name).toBe('app.js')
    const writeOnly = createDraft({ path: '/tmp/rollout-write.jsonl', product: 'codex' })
    ingestLines(writeOnly, [
      line({
        type: 'response_item',
        payload: { type: 'function_call', name: 'write', arguments: JSON.stringify({ path: 'a.ts', content: 'z\n' }) },
      }),
      line({ type: 'response_item', payload: { type: 'custom_tool_call_output', output: 'should not attach\n' } }),
    ].join(''), NOW)
    expect(writeOnly.reads).toEqual([])
    const ag = createDraft({ path: '/brain/conv/.system_generated/logs/transcript_full.jsonl', product: 'antigravity' })
    ingestLines(ag, line({
      source: 'USER', content: '请改 app.js', title: '监听任务', tool_calls: [
        { name: 'view_file', args: { AbsolutePath: file }, result: '# read\n' },
        { name: 'replace_file_content', args: { TargetFile: 'src/cli.ts', old_content: 'legacy\n', new_string: 'next\n' } },
      ],
    }), NOW)
    expect(ag.title).toBe('监听任务')
    expect(ag.reads.map(item => item.content)).toEqual(['# read\n', 'legacy\n'])
    expect(ag.files[0]?.content).toContain('next')
  })
})

describe('more log shapes', () => {
  it('covers redirects, terminal events, tool names, and a rewritten file', async () => {
    const draft = createDraft({ path: '/tmp/rollout-2026-11-28T12-01-00-00000000-0000-4000-8000-0000000000cc.jsonl', product: 'codex' })
    const steps = Array.from({ length: 81 }, (_, index) => line({
      timestamp: 1_700_000_000_000 + index,
      type: 'event_msg',
      payload: { type: 'exec_command_end', command: `echo ${index} > out/${index}.txt`, exit_code: 0 },
    }))
    ingestLines(draft, [
      line({ type: 'event_msg', payload: { type: 'task_started' } }),
      line({ type: 'event_msg', payload: { type: 'exec_command_end', status: 'running', command: 'sleep 1' } }),
      line({ type: 'event_msg', payload: { type: 'exec_command_end', command: '' } }),
      line({ type: 'event_msg', payload: { type: 'exec_command_end', command: ['cat', 'README.md'], exit_code: 0 } }),
      line({ type: 'event_msg', payload: { type: 'exec_command_end', command: ['cat', 'README.md'], exit_code: 0 } }),
      line({ type: 'response_item', payload: { type: 'function_call', name: 'unknown_tool', arguments: '{}' } }),
      line({ type: 'response_item', payload: { type: 'function_call', name: 'write', arguments: '{}' } }),
      line({ type: 'event_msg', payload: { type: 'patch_apply_end' } }),
      line({ type: 'event_msg', payload: { type: 'task_complete' } }),
      line({ type: 'not-json' }),
      ...steps,
      line({ type: 'session_meta', payload: { id: 'exec', originator: 'codex_exec', source: 'exec', cwd: '/tmp' } }),
    ].join(''), NOW)
    expect(draft.steps.length).toBeLessThanOrEqual(80)
    expect(draft.status).toBe('done')
    const failed = createDraft({ path: '/tmp/other.jsonl', product: 'codex' })
    ingestLines(failed, line({ type: 'event_msg', payload: { type: 'turn_aborted' } }), NOW)
    expect(failed.status).toBe('error')
    const errored = createDraft({ path: '/tmp/err.jsonl', product: 'codex' })
    ingestLines(errored, [
      line({ timestamp: '2020-01-01T00:00:00.000Z', type: 'event_msg', payload: { type: 'exec_command_end', command: 1, exit_code: 1 } }),
      line({ type: 'session_meta', payload: { id: 'obj', source: { subagent: {} } } }),
      line({ type: 'event_msg', payload: { type: 'patch_apply_end', changes: { 'src/a.ts': { type: 'add', content: 'a' }, 'src/a.ts2': { type: 'modify' } } } }),
      line({ type: 'response_item', payload: { type: 'function_call', name: 'write_file', arguments: JSON.stringify({ Path: 'src/a.ts', Content: 'one' }) } }),
      line({ type: 'response_item', payload: { type: 'function_call', name: 'write_file', arguments: JSON.stringify({ Path: 'src/a.ts', Content: 'two' }) } }),
      line({ type: 'response_item', payload: { type: 'function_call', name: 'exec', arguments: { command: 'pwd' } } }),
      line({ type: 'event_msg', payload: { type: 'user_message', content: '第二段\n更多' } }),
    ].join(''), NOW)
    const ag = createDraft({ path: '/ag/t.jsonl', product: 'antigravity' })
    ingestLines(ag, [
      line({ content: '一行标题\n第二行', source: 'USER', status: 'DONE' }),
      line({ step_index: 1, source: 'MODEL', type: 'tool', status: 'ERROR', tool_calls: [null, { tool: 'run_command', arguments: { cmd: 'ls' } }, { name: 'grep_search', SearchPath: 'src' }] }),
    ].join(''), NOW)
    expect(ag.steps[0]?.action).toBe('command')
    expect(ag.steps[1]?.action).toBe('read')
    expect(ag.title).toBe('一行标题')
    const odd = createDraft({ path: '/tmp/odd.jsonl', product: 'codex' })
    ingestLines(odd, [
      line({ timestamp: 'not-a-date', type: 'event_msg', payload: { type: 'user_message', message: '' } }),
      line({ type: 'event_msg', payload: { type: 'user_message', text: '只用 text' } }),
      line({ type: 'event_msg', payload: { type: 'user_message', message: '第二句' } }),
      line({ type: 'session_meta', payload: { session_id: 'sid-1', cwd: '/work' } }),
      line({ type: 'event_msg', payload: { type: 'exec_command_end', command: '   ' } }),
      line({ type: 'event_msg', payload: { type: 'exec_command_end', command: 'false', exit_code: 1 } }),
      line({ type: 'response_item', payload: { type: 'function_call', name: 'write_file', arguments: JSON.stringify({ Path: '/' }) } }),
      line({ type: 'response_item', payload: { type: 'function_call', name: 'shell', input: { Command: 'pwd' } } }),
      line({ type: 'response_item', payload: { type: 'function_call', name: 'exec', args: {} } }),
      line({ type: 'response_item', payload: { type: 'function_call', name: 'write', arguments: 'null' } }),
      line({ type: 'response_item', payload: { type: 'function_call', name: 'read', arguments: [1] } }),
    ].join(''), NOW)
    expect(odd.metaId).toBe('sid-1')
    expect(odd.prompt).toBe('只用 text')
    expect(odd.steps.some(step => step.status === 'error')).toBe(true)
    expect(odd.files.some(file => file.path === '/')).toBe(true)
    const sub = createDraft({ path: '/tmp/sub.jsonl', product: 'codex' })
    ingestLines(sub, line({ type: 'session_meta', payload: { id: 's', source: 'subagent' } }), NOW)
    expect(sub.surface).toBe('subagent')

    await pollMonitor({
      files: () => Promise.resolve([{ path: '/stuck.jsonl', product: 'codex' }]),
      read: () => Promise.resolve({ text: '{"partial"', size: 100, bytes: 10 }),
      readText: () => Promise.resolve(''),
      subscribe: () => () => {},
    }, new Map(), NOW)
    await pollMonitor({
      files: () => Promise.resolve([{ path: '/missing.jsonl', product: 'codex' }]),
      read: () => Promise.resolve(null),
      readText: () => Promise.resolve(null),
      subscribe: () => () => {},
    }, new Map(), NOW)
    const blank = new Map<string, LogCursor>()
    const written = line({ type: 'response_item', payload: { type: 'function_call', name: 'write_file', arguments: JSON.stringify({ Path: 'a.ts' }) } })
    let textReads = 0
    const blankBridge: MonitorBridge = {
      files: () => Promise.resolve([{ path: '/blank.jsonl', product: 'codex' }]),
      read: (_path, offset) => offset === 0
        ? Promise.resolve({ text: written, size: written.length, bytes: written.length })
        : Promise.resolve({ text: '', size: written.length, bytes: 0 }),
      readText: () => {
        textReads += 1
        return Promise.resolve(textReads === 1 ? null : '')
      },
      subscribe: () => () => {},
    }
    await pollMonitor(blankBridge, blank, NOW)
    await pollMonitor(blankBridge, blank, NOW)
    expect(blank.get('/blank.jsonl')?.draft.files[0]?.content).toBe('')
    let text = '{"step_index":1}\n{"truncated"'
    const log = { path: '/ag/transcript_full.jsonl', product: 'antigravity' as const }
    const encoder = new TextEncoder()
    const cursors = new Map<string, LogCursor>()
    const bridge = {
      files: () => Promise.resolve([log]),
      read: (_path: string, offset: number, max: number) => {
        const bytes = encoder.encode(text)
        if (offset > bytes.length) return Promise.resolve({ text: '', size: 3, bytes: 0 })
        const slice = bytes.slice(offset, offset + max)
        return Promise.resolve({ text: new TextDecoder().decode(slice), size: bytes.length, bytes: slice.length })
      },
      readText: () => Promise.resolve(null),
      subscribe: () => () => {},
    }
    await pollMonitor(bridge, cursors, NOW)
    text = '{"step_index":1}\n'
    await pollMonitor(bridge, cursors, NOW)
    text = ''
    await pollMonitor(bridge, cursors, NOW)
    bridge.files = () => Promise.resolve([])
    expect((await pollMonitor(bridge, cursors, NOW)).sessions).toEqual([])
  })
})

describe('startMonitor', () => {
  it('does nothing without the desktop bridge and drops a result that arrives after stop', async () => {
    const stopIdle = startMonitor(() => {})
    stopIdle()
    vi.stubGlobal('dshDesktop', {
      generationMonitor: {
        files: () => Promise.reject(new Error('offline')),
        read: () => Promise.resolve(null),
        readText: () => Promise.resolve(null),
        subscribe: (listener: () => void) => { listener(); return () => {} },
      },
    })
    startMonitor(() => {})()
    let resolveFiles: (files: []) => void = () => {}
    vi.stubGlobal('dshDesktop', {
      generationMonitor: {
        files: () => new Promise<[]>((resolve) => { resolveFiles = resolve }),
        read: () => Promise.resolve(null),
        readText: () => Promise.resolve(null),
        subscribe: (listener: () => void) => { listener(); return () => {} },
      },
    })
    let published = 0
    const stop = startMonitor(() => { published += 1 })
    stop()
    resolveFiles([])
    await Promise.resolve()
    expect(published).toBe(0)
    vi.unstubAllGlobals()
  })
})

describe('pollMonitor', () => {
  it('appends a later line without rereading the first one', async () => {
    let body = line({ timestamp: '2026-11-28T04:06:00.000Z', type: 'event_msg', payload: { type: 'user_message', message: '先写一半' } })
    const log: MonitorLog = { path: '/logs/rollout-2026-11-28T12-06-00-00000000-0000-4000-8000-0000000000c1.jsonl', product: 'codex' }
    const encoder = new TextEncoder()
    const bridge: MonitorBridge = {
      files: () => Promise.resolve([log]),
      read: (_path, offset, max) => {
        const bytes = encoder.encode(body)
        const slice = bytes.slice(offset, offset + max)
        return Promise.resolve({ text: new TextDecoder().decode(slice), size: bytes.length, bytes: slice.length })
      },
      readText: () => Promise.resolve('export const watcher = true\n'),
      subscribe: () => () => {},
    }
    const cursors = new Map<string, LogCursor>()
    const first = await pollMonitor(bridge, cursors, NOW)
    expect(first.sessions[0]?.title).toBe('先写一半')
    const offset = cursors.get(log.path)?.offset ?? 0
    body += line({ timestamp: '2026-11-28T04:09:00.000Z', type: 'response_item', payload: { type: 'function_call', name: 'write_file', arguments: JSON.stringify({ Path: 'src/sync/watcher.ts', Content: '' }) } })
    const second = await pollMonitor(bridge, cursors, NOW)
    await pollMonitor(bridge, cursors, NOW)
    expect(cursors.get(log.path)?.offset).toBeGreaterThan(offset)
    expect(second.sessions[0]?.steps.some(step => step.label === 'src/sync/watcher.ts')).toBe(true)
    expect(second.sessions[0]?.files[0]?.content).toContain('watcher')
  })
})
