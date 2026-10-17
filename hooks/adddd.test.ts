import { describe, expect, test } from 'claude-code/testing'

import type { AddddTicket, AddddWorker } from '../types'
import { parseStatus } from './parse'
import { pick, weightOf } from './pick'
import { nowCard, overlapsOf, safeKey, statusLine } from './registry'
import { priorityOfLabels, toTicket as ghTicket } from './sources/github'
import { parseIssueList, toTicket as linearTicket } from './sources/linear'
import { buildWorkerPrompt } from './worker-prompt'

const ticket = (key: string, priority = 0): AddddTicket => ({ key, id: key, title: `do ${key}`, url: '', source: 'linear', priority, createdAt: 0 })
const worker = (key: string, status: AddddWorker['status'], extra: Partial<AddddWorker> = {}): AddddWorker => ({
  key,
  ticket: ticket(key),
  prompt: 'fix',
  branch: `adddd/${key}`,
  worktree: `/tmp/${key}`,
  base: 'main',
  agentId: `agent-${key}`,
  status,
  touched: [],
  dispatchedAt: 0,
  updatedAt: 0,
  ...extra,
})

describe('parseStatus', () => {
  test('reads a done block', () => {
    const p = parseStatus('Did the thing.\n\nADDDD: done\nsummary: added a test and committed\n')
    expect(p.status).toBe('done')
    expect(p.summary).toBe('added a test and committed')
  })
  test('reads a question', () => {
    const p = parseStatus('ADDDD: needs-human\nsummary: two ways to do it\nquestion: exponential or fixed backoff?')
    expect(p.status).toBe('needs-human')
    expect(p.question).toBe('exponential or fixed backoff?')
  })
  test('takes the last block when several', () => {
    const p = parseStatus('ADDDD: needs-human\nquestion: a?\n\nlater\n\nADDDD: done\nsummary: fine')
    expect(p.status).toBe('done')
  })
  test('no block means the human has to read it', () => {
    const p = parseStatus('I poked around.\n\nI am not sure whether to delete the table.')
    expect(p.status).toBe('needs-human')
    expect(p.question).toBe('I am not sure whether to delete the table.')
  })
})

describe('pick', () => {
  test('weights urgent over low', () => {
    expect(weightOf(1)).toBeGreaterThan(weightOf(4))
    const t = [ticket('LOW', 4), ticket('URGENT', 1)]
    expect(pick(t, 'weighted', () => 0.05)?.key).toBe('LOW')
    expect(pick(t, 'weighted', () => 0.5)?.key).toBe('URGENT')
  })
  test('priority mode is deterministic', () => {
    expect(pick([ticket('B', 3), ticket('A', 1), ticket('C', 0)], 'priority')?.key).toBe('A')
  })
  test('empty backlog picks nothing', () => {
    expect(pick([], 'random')).toBeUndefined()
  })
})

describe('registry', () => {
  test('a worker that needs you beats a fresh ticket', () => {
    const card = nowCard({ workers: [worker('A', 'running'), worker('B', 'needs-human')], picked: ticket('C') })
    expect(card.kind).toBe('worker')
    expect(card.kind === 'worker' && card.worker.key).toBe('B')
  })
  test('a picked ticket shows when nobody needs you', () => {
    const card = nowCard({ workers: [worker('A', 'running')], picked: ticket('C') })
    expect(card.kind).toBe('ticket')
  })
  test('overlaps are symmetric', () => {
    const o = overlapsOf([worker('A', 'running', { touched: ['x.ts', 'y.ts'] }), worker('B', 'running', { touched: ['y.ts'] }), worker('C', 'dismissed', { touched: ['y.ts'] })])
    expect(o.A?.B).toEqual(['y.ts'])
    expect(o.B?.A).toEqual(['y.ts'])
    expect(o.C).toBeUndefined()
  })
  test('status line counts', () => {
    expect(statusLine({ workers: [worker('A', 'running'), worker('B', 'needs-human')], backlogCount: 3, paused: false })).toBe('adddd · 1 in flight · 1 needs you · 3 in backlog')
  })
  test('safeKey strips what git dislikes', () => {
    expect(safeKey('ENG-12')).toBe('ENG-12')
    expect(safeKey('#12 weird/key')).toBe('12-weird-key')
  })
})

describe('sources', () => {
  test('linear issues parse from a JSON array or a wrapper', () => {
    const issue = { id: 'uuid', identifier: 'ENG-1', title: 'T', url: 'u', priority: 2, state: { name: 'Todo' }, createdAt: '2026-01-01T00:00:00Z' }
    expect(parseIssueList(JSON.stringify([issue]))).toHaveLength(1)
    expect(parseIssueList(JSON.stringify({ issues: [issue] }))).toHaveLength(1)
    expect(parseIssueList('here you go: ' + JSON.stringify([issue]))).toHaveLength(1)
    expect(linearTicket(issue)?.key).toBe('ENG-1')
  })
  test('github labels map to priorities', () => {
    expect(priorityOfLabels(['bug', 'P0'])).toBe(1)
    expect(priorityOfLabels(['enhancement'])).toBe(0)
    expect(ghTicket({ number: 7, title: 'x', labels: [{ name: 'high' }] })?.key).toBe('GH-7')
  })
})

describe('worker prompt', () => {
  test('names the others in flight and the contract', () => {
    const text = buildWorkerPrompt({ ticket: ticket('ENG-9', 1), operatorPrompt: 'just fix it', branch: 'adddd/ENG-9', worktree: '/wt', base: 'origin/main', others: [{ key: 'ENG-2', title: 'other', branch: 'adddd/ENG-2', touched: ['a.ts'] }] })
    expect(text).toContain('ENG-2')
    expect(text).toContain('a.ts')
    expect(text).toContain('just fix it')
    expect(text).toContain('ADDDD status block')
  })
})

describe('pane', () => {
  test('draws an empty board on every surface', async $ => {
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'adddd',
        surface,
        component: 'Pane',
        requestId: 'adddd',
        props: { title: 'adddd', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
      })
      expect(await ui.find({ type: 'Text', text: /no worktrees yet/ })).toBeDefined()
      await ui.unmount()
    }
  })
})
