import { describe, expect, test } from 'claude-code/testing'

import type { AddddTicket, AddddWorker } from '../types'
import { parseStatus } from './parse'
import { pick, weightOf } from './pick'
import { atCapacity, nowCard, openWorktrees, overlapsOf, safeKey, statusLine } from './registry'
import { priorityOfLabels, toTicket as ghTicket } from './sources/github'
import { parseIssueList, toTicket as linearTicket } from './sources/linear'
import { NUDGES, makeLifeSquirrel, pickNudge, timeOfDay } from './life'
import { parseBullets, parseCuration, parseDevto, parseGithub, parseHn, stripHtml, topicsFromFiles, topicsFromPackageJson } from './squirrel'
import { parseConversations, parseHistory, parseMentions, plainText, tsNewer } from './slack'
import { parseList } from './suggest'
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
  test('open worktrees count against the cap, dismissed ones do not', () => {
    const ws = [worker('A', 'running'), worker('B', 'done'), worker('C', 'needs-human'), worker('D', 'dismissed')]
    expect(openWorktrees(ws).map(w => w.key)).toEqual(['A', 'B', 'C'])
    expect(atCapacity(ws, 3)).toBe(true)
    expect(atCapacity(ws, 4)).toBe(false)
    expect(atCapacity(ws, 0)).toBe(false)
    expect(statusLine({ workers: ws, backlogCount: 2, paused: false, capacity: { open: 3, max: 6 } })).toBe('adddd · 1 in flight · 3/6 worktrees · 1 needs you · 1 done · 2 in backlog')
  })
  test('safeKey strips what git dislikes', () => {
    expect(safeKey('ENG-12')).toBe('ENG-12')
    expect(safeKey('#12 weird/key')).toBe('12-weird-key')
  })
})

describe('squirrels', () => {
  test('topics come from dependencies and file extensions', () => {
    expect(topicsFromPackageJson(JSON.stringify({ dependencies: { next: '1', '@supabase/supabase-js': '2' }, devDependencies: { vitest: '3' } }))).toEqual(['nextjs', 'supabase', 'testing'])
    expect(topicsFromPackageJson('nope')).toEqual([])
    expect(topicsFromFiles(['a.ts', 'b.tsx', 'c.py', 'README.md'])).toEqual(['typescript', 'python'])
  })
  test('feeds parse into candidates', () => {
    expect(parseHn({ hits: [{ title: 'T', url: 'https://x', points: 99, num_comments: 3, objectID: '1' }, { title: '', url: 'https://y' }] })).toHaveLength(1)
    expect(parseHn({ hits: [{ title: 'Ask HN', objectID: '42', points: 10 }] })[0]?.url).toBe('https://news.ycombinator.com/item?id=42')
    expect(parseGithub({ items: [{ full_name: 'a/b', html_url: 'https://g', description: 'd', stargazers_count: 5 }] })[0]?.score).toBe(5)
    expect(parseDevto([{ title: 'x', url: 'https://d', description: 'e', positive_reactions_count: 7 }])).toHaveLength(1)
    expect(parseDevto({})).toEqual([])
  })
  test('curation JSON is read defensively', () => {
    expect(parseCuration('sure: {"pick": 2, "why": "because"}', 3)).toEqual({ pick: 2, why: 'because' })
    expect(parseCuration('{"pick": 9, "why": "no"}', 3)).toBeUndefined()
    expect(parseCuration('nothing', 3)).toBeUndefined()
  })
  test('html strips and bullets parse', () => {
    expect(stripHtml('<h1>Hi</h1><script>x()</script> there &amp; you')).toBe('Hi there & you')
    expect(parseBullets('- one\n* two\n3. three\n- four')).toEqual(['one', 'two', 'three'])
  })
  test('a squirrel sits between a worker and a ticket', () => {
    const squirrel = { id: 's', title: 'S', url: 'https://s', blurb: '', source: 'hn' as const, topic: 't', why: 'w', foundAt: 0 }
    expect(nowCard({ workers: [worker('B', 'needs-human')], picked: ticket('C'), squirrel }).kind).toBe('worker')
    expect(nowCard({ workers: [worker('A', 'running')], picked: ticket('C'), squirrel }).kind).toBe('squirrel')
    expect(nowCard({ workers: [], picked: ticket('C'), squirrel: null }).kind).toBe('ticket')
  })
})

describe('slack', () => {
  test('history keeps only new messages from others', () => {
    const data = { messages: [
      { type: 'message', user: 'U1', text: 'old', ts: '10.000' },
      { type: 'message', user: 'U1', text: 'new', ts: '20.000' },
      { type: 'message', user: 'ME', text: 'mine', ts: '21.000' },
      { type: 'message', subtype: 'channel_join', user: 'U2', text: 'joined', ts: '22.000' },
      { type: 'message', bot_id: 'B1', text: 'bot', ts: '23.000' },
    ] }
    expect(parseHistory(data, '15.000', 'ME').map(m => m.text)).toEqual(['new'])
    expect(tsNewer('20.5', '20.4')).toBe(true)
  })
  test('mentions parse with channel and permalink', () => {
    const data = { messages: { matches: [
      { user: 'U1', username: 'jane', text: 'hey <@ME>', ts: '30.000', channel: { id: 'C1', name: 'eng' }, permalink: 'https://p' },
      { user: 'ME', text: 'me', ts: '31.000', channel: { id: 'C1', name: 'eng' } },
      { user: 'U1', text: 'older', ts: '5.000', channel: { id: 'C1', name: 'eng' } },
    ] } }
    const m = parseMentions(data, '10.000', 'ME')
    expect(m).toHaveLength(1)
    expect(m[0]?.channelName).toBe('#eng')
    expect(m[0]?.permalink).toBe('https://p')
  })
  test('conversations and markup', () => {
    expect(parseConversations({ channels: [{ id: 'D1', is_im: true, user: 'U1' }, { id: 'G1', is_mpim: true, name: 'mpdm-a--b' }] }).map(c => c.kind)).toEqual(['dm', 'mpim'])
    expect(plainText('hey <@U1> see <https://x.y|the doc> in <#C1|eng> &amp; more', { U1: 'jane' })).toBe('hey @jane see the doc (https://x.y) in #eng & more')
  })
  test('a slack message outranks a squirrel', () => {
    const msg = { channel: 'D1', channelName: 'DM from jane', kind: 'dm' as const, user: 'U1', userName: 'jane', text: 'hi', ts: '1.0' }
    const squirrel = { id: 's', title: 'S', url: 'https://s', blurb: '', source: 'hn' as const, topic: 't', why: 'w', foundAt: 0 }
    expect(nowCard({ workers: [], picked: ticket('C'), squirrel, slackMsg: msg }).kind).toBe('slack')
    expect(nowCard({ workers: [worker('B', 'needs-human')], picked: null, squirrel: null, slackMsg: msg }).kind).toBe('worker')
  })
})

describe('suggestions', () => {
  test('a JSON array, a numbered list and junk all parse to three lines', () => {
    expect(parseList('["Fix it", "Look first", "Add a test"]')).toEqual(['Fix it', 'Look first', 'Add a test'])
    expect(parseList('Sure, options:\n1. Fix it\n2) Look first\n- Add a test\n4. extra')).toEqual(['Fix it', 'Look first', 'Add a test'])
    expect(parseList('["dup", "Dup", "x"]')).toEqual(['dup', 'x'])
    expect(parseList('')).toEqual([])
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

describe('off-screen squirrels', () => {
  test('a nudge fits the hour and skips what was seen', () => {
    const seen = new Set(NUDGES.filter(n => !n.when).map(n => `life:${n.slug}`))
    for (let i = 0; i < 20; i++) {
      const n = pickNudge(seen, 8, Math.random)!
      expect(n.when === undefined || n.when === 'morning').toBe(true)
      expect(seen.has(`life:${n.slug}`)).toBe(false)
    }
  })
  test('banned nudges never come back, even when everything else was seen', () => {
    const all = new Set(NUDGES.map(n => `life:${n.slug}`))
    const banned = new Set(NUDGES.filter(n => n.slug !== 'water').map(n => `life:${n.slug}`))
    for (let i = 0; i < 20; i++) expect(pickNudge(all, 13, Math.random, banned)?.slug).toBe('water')
    expect(pickNudge(all, 13, Math.random, all)).toBeUndefined()
  })
  test('a life squirrel has no url and says who is busy', () => {
    const s = makeLifeSquirrel({ slug: 'x', title: 'text your mom', why: 'w' }, 5, 2)
    expect(s.url).toBe('')
    expect(s.source).toBe('life')
    expect(s.blurb).toBe('2 workers are busy. you are not.')
    expect(makeLifeSquirrel({ slug: 'x', title: 't', why: 'w' }, 5, 0).blurb).toBe('nothing is waiting on you.')
  })
  test('time of day buckets', () => {
    expect([timeOfDay(7), timeOfDay(13), timeOfDay(19), timeOfDay(1)]).toEqual(['morning', 'day', 'evening', 'late'])
  })
})
