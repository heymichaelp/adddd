import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { AddddBoard, AddddSource, AddddTicket, AddddWorker, PickMode } from '../types'
import { parseStatus } from './parse'
import { pick } from './pick'
import { ago, inFlight, isActive, nowCard, safeKey, statusLine } from './registry'
import { GH_LABEL_PROGRESS, GH_LABEL_REVIEW, labelGithubIssue, listGithubIssues } from './sources/github'
import { listLinearIssues, setLinearState } from './sources/linear'
import { drawBand } from './ui/band'
import { drawPane, type Actions } from './ui/pane'
import { buildWorkerPrompt, starterPrompt, WORKER_SYSTEM_PROMPT } from './worker-prompt'
import { baseBranch, ensureWorktree, isDirty, lastCommits, removeWorktree, touchedFiles } from './worktree'

const PANE = 'adddd'
const AGENT = 'adddd:worker'
const RECONCILE_MS = 20000

const EMPTY: AddddBoard = { workers: [], picked: null, paused: false, backlogCount: 0, source: 'linear', note: null, now: 0 }
const board = atom({ plugin: 'adddd', key: 'board' } as const, EMPTY)

type Options = {
  source: AddddSource
  linearServer: string
  linearTeam: string
  githubRepo: string
  pick: PickMode
  maxInFlight: number
  moveToReview: boolean
  sounds: boolean
}

function readOptions(options: PluginOptions): Options {
  const str = (k: string, d: string) => (typeof options[k] === 'string' ? (options[k] as string) : d)
  const bool = (k: string, d: boolean) => (typeof options[k] === 'boolean' ? (options[k] as boolean) : d)
  const num = (k: string, d: number) => (typeof options[k] === 'number' ? (options[k] as number) : d)
  const source = str('source', 'linear')
  const mode = str('pick', 'weighted')
  return {
    source: source === 'github' ? 'github' : 'linear',
    linearServer: str('linearServer', 'linear') || 'linear',
    linearTeam: str('linearTeam', ''),
    githubRepo: str('githubRepo', ''),
    pick: mode === 'random' || mode === 'priority' ? mode : 'weighted',
    maxInFlight: Math.max(0, Math.floor(num('maxInFlight', 0))),
    moveToReview: bool('moveToReview', true),
    sounds: bool('sounds', true),
  }
}

type Persisted = { workers?: AddddWorker[]; picked?: AddddTicket | null; source?: AddddSource }

const USAGE = [
  '/adddd            pick a ticket (or re-pick) and wait for your one prompt',
  '/adddd next       skip the picked ticket',
  '/adddd pane       open the board',
  '/adddd pause|resume',
  '/adddd status     what every worktree is doing',
  '/adddd source linear|github',
  '/adddd ok [KEY|all]  dismiss the card in front of you (or one, or every done one)',
  '/adddd open [KEY]    put that worker\'s transcript in the main view · /adddd back',
  '/adddd reply KEY …   answer a worker without switching views',
  '/adddd review KEY · retry KEY · dismiss KEY · cleanup',
].join('\n')

let opt: Options = readOptions({})

let workers: AddddWorker[] = []
let picked: AddddTicket | null = null
let paused = false
let backlog: AddddTicket[] = []
let source: AddddSource = opt.source
let note: string | null = null
let viewing: string | undefined
let root = ''
let storeKey = 'adddd:'
let loaded = false
let syncWarned = false

/** A dropped prompt stays in the composer; wipe it once the drop has landed. */
function clearComposer($: EngineInterface): void {
  $.clock.after(150, () => void $.prompt.fill({ text: '', mode: 'replace' }).catch(() => undefined))
}

const sound = ($: EngineInterface, name: 'dispatch' | 'resurface' | 'done') => {
  if (opt.sounds) void $.audio.play({ asset: `sounds/${name}.wav` }).catch(() => undefined)
}

async function publish($: EngineInterface): Promise<AddddBoard> {
  const now = await $.clock.now()
  const snap: AddddBoard = { workers: [...workers], picked, paused, backlogCount: backlog.length, source, note, now }
  await update($, board, () => snap)
  const busy = workers.some(isActive) || picked !== null
  $.ui.status(busy ? statusLine(snap) : undefined)
  if (loaded) await $.store.set(storeKey, { workers, picked, source } satisfies Persisted)
  return snap
}

async function fetchBacklog($: EngineInterface): Promise<AddddTicket[]> {
  const list =
    source === 'github' ? await listGithubIssues($, root, opt.githubRepo) : await listLinearIssues($, opt.linearServer, opt.linearTeam)
  const taken = new Set(workers.map(w => w.key))
  return list.filter(t => !taken.has(t.key))
}

async function pickNext($: EngineInterface, skipping?: string): Promise<AddddTicket | null> {
  try {
    backlog = await fetchBacklog($)
    note = null
  } catch (err) {
    note = `backlog: ${(err as Error)?.message ?? String(err)}`.slice(0, 160)
    $.ui.toast(`adddd · ${note}`, { timeoutMs: 8000 })
    backlog = []
  }
  const candidates = skipping ? backlog.filter(t => t.key !== skipping) : backlog
  picked = pick(candidates, opt.pick) ?? null
  if (picked) void $.prompt.suggest({ text: starterPrompt() })
  return picked
}

async function markTicket($: EngineInterface, ticket: AddddTicket, phase: 'start' | 'review'): Promise<void> {
  if (!opt.moveToReview) return
  let err: string | undefined
  try {
    err =
      ticket.source === 'github'
        ? await labelGithubIssue($, root, opt.githubRepo, ticket, phase === 'start' ? GH_LABEL_PROGRESS : GH_LABEL_REVIEW, phase === 'start' ? undefined : GH_LABEL_PROGRESS)
        : await setLinearState($, opt.linearServer, ticket, phase === 'start' ? 'In Progress' : 'In Review')
  } catch (e) {
    err = (e as Error)?.message ?? String(e)
  }
  if (err && !syncWarned) {
    syncWarned = true
    $.ui.toast(`adddd · could not move ${ticket.key}: ${err.slice(0, 120)}`, { timeoutMs: 8000 })
  }
}

async function dispatch($: EngineInterface, ticket: AddddTicket, prompt: string): Promise<AddddWorker> {
  if (opt.maxInFlight > 0 && inFlight(workers).length >= opt.maxInFlight) {
    throw new Error(`${opt.maxInFlight} workers already in flight (maxInFlight)`)
  }
  const key = safeKey(ticket.key)
  const base = await baseBranch($, root)
  const branch = `adddd/${key}`
  const worktree = await ensureWorktree($, root, key, branch, base)
  const others = workers.filter(w => isActive(w) && w.key !== ticket.key).map(w => ({ key: w.key, title: w.ticket.title, branch: w.branch, touched: w.touched }))
  const text = buildWorkerPrompt({ ticket, operatorPrompt: prompt, branch, worktree, base, others })
  const spawned = await $.agent.spawn({
    subagentType: AGENT,
    prompt: text,
    description: `${ticket.key} ${ticket.title}`.slice(0, 60),
    name: `adddd-${key}`,
    cwd: worktree,
  })
  if (spawned.deny !== undefined) throw new Error(spawned.deny)
  const now = await $.clock.now()
  const worker: AddddWorker = {
    key: ticket.key,
    ticket,
    prompt,
    branch,
    worktree,
    base,
    agentId: spawned.agentId,
    status: 'running',
    touched: [],
    dispatchedAt: now,
    updatedAt: now,
  }
  workers = [...workers.filter(w => w.key !== worker.key), worker]
  return worker
}

function findWorker(key: string): AddddWorker | undefined {
  const k = key.trim().toLowerCase()
  return workers.find(x => x.key.toLowerCase() === k || x.key.toLowerCase() === `gh-${k}`)
}

/** Sends the operator's words to a stopped worker, which resumes under the same agent id. */
async function reply($: EngineInterface, w: AddddWorker, text: string): Promise<string | undefined> {
  if (!w.agentId) return `${w.key} has no live worker (it belonged to another session). /adddd retry ${w.key} runs it again.`
  const sent = await $.session.send({
    to: { agentId: w.agentId },
    text: `The operator replied:\n\n${text}\n\nCarry on in your worktree. End your final message with the ADDDD status block.`,
  })
  if (!sent.isDelivered) return `could not reach ${w.key}: ${sent.reason}`
  w.status = 'running'
  w.question = undefined
  w.updatedAt = await $.clock.now()
  return undefined
}

/** The command and the agent type are the session's: a /clear starts a new one, so they are declared again. */
async function declare($: EngineInterface): Promise<void> {
  await $.agent.register({
    name: 'worker',
    description: 'adddd background ticket worker. Dispatched by the adddd plugin only; do not spawn by hand.',
    prompt: WORKER_SYSTEM_PROMPT,
    background: true,
  })
  await $.command.register({
    name: 'adddd',
    description: 'ADD-driven development: one ticket, one prompt, one worktree at a time',
    argumentHint: '[next|ok|open|reply|pane|pause|resume|status|source|review|retry|cleanup]',
  })
}

/** A worker's own report to the main conversation, which has nothing to say about it. */
function isWorkerNotification(text: string): boolean {
  return workers.some(w => (w.agentId && text.includes(w.agentId)) || text.includes(`adddd-${safeKey(w.key)}`)) || text.includes('adddd:worker')
}

function announce($: EngineInterface, w: AddddWorker): void {
  const line =
    w.status === 'done'
      ? `✅ ${w.key} done: ${w.summary ?? 'committed on ' + w.branch}`
      : w.status === 'failed'
        ? `💥 ${w.key} failed: ${w.question ?? ''}`
        : `🔔 ${w.key} needs you: ${w.question ?? ''}`
  $.ui.toast(line.slice(0, 300), { timeoutMs: 10000 })
  void $.ui.notify(line.slice(0, 300), { title: 'adddd' }).catch(() => undefined)
  sound($, w.status === 'done' ? 'done' : 'resurface')
}

async function refreshTouched($: EngineInterface, w: AddddWorker): Promise<boolean> {
  try {
    const files = await touchedFiles($, w.worktree, w.base, w.branch)
    if (files.join('\n') === w.touched.join('\n')) return false
    w.touched = files
    return true
  } catch {
    return false
  }
}

async function reconcile($: EngineInterface): Promise<void> {
  if (!loaded) return
  const now = await $.clock.now()
  let agents: Awaited<ReturnType<typeof $.agent.list>> = []
  try {
    agents = await $.agent.list()
  } catch {
    agents = []
  }
  for (const w of workers) {
    if (w.status !== 'running' || !w.agentId) continue
    const a = agents.find(x => x.id === w.agentId)
    if (!a) continue
    if (a.status === 'failed' || a.status === 'killed') {
      w.status = 'failed'
      w.question = `the worker was ${a.status}`
      w.updatedAt = now
      announce($, w)
    }
  }
  for (const w of workers.filter(isActive)) await refreshTouched($, w)
  await publish($)
}

function statusText(now: number): string {
  if (workers.length === 0 && !picked) return 'adddd: nothing in flight. /adddd to pick a ticket.'
  const lines = workers
    .filter(w => w.status !== 'dismissed')
    .map(w => {
      const tail = w.status === 'done' ? w.summary ?? '' : w.question ?? w.summary ?? ''
      return `- ${w.key} [${w.status}] ${w.ticket.title} · ${w.branch} · ${ago(w.updatedAt, now)} ago · ${w.touched.length} files${tail ? `\n    ${tail}` : ''}`
    })
  if (picked) lines.push(`- picked, waiting for your prompt: ${picked.key} ${picked.title}`)
  lines.push(`backlog: ${backlog.length} · source: ${source}${paused ? ' · paused' : ''}`)
  return lines.join('\n')
}

function pickedText(t: AddddTicket | null): string {
  if (!t) return 'adddd: the backlog is empty (or everything is already in a worktree). 🎉'
  return `🎯 ${t.key} · ${t.title}\n${t.url}\n\ntype ONE prompt and press Enter. it goes to a worker in its own worktree, not to this conversation.`
}

const actions = ($: EngineInterface): Actions => ({
  jumpIn: w => {
    if (!w.agentId) return
    viewing = w.agentId
    void $.ui.view({ agentId: w.agentId }).then(r => {
      if ('deny' in r && r.deny) {
        viewing = undefined
        $.ui.toast(`adddd · cannot open ${w.key}: ${r.deny}`)
      }
    })
  },
  back: () => {
    viewing = undefined
    void $.ui.view({})
  },
  dismiss: w => {
    w.status = 'dismissed'
    void publish($)
  },
  retry: w => {
    void (async () => {
      try {
        await dispatch($, w.ticket, w.prompt)
        sound($, 'dispatch')
      } catch (err) {
        note = `retry failed: ${(err as Error)?.message ?? String(err)}`.slice(0, 160)
      }
      await publish($)
    })()
  },
  skip: () => {
    void (async () => {
      await pickNext($, picked?.key)
      await publish($)
    })()
  },
  pause: () => {
    paused = !paused
    void publish($)
  },
  start: () => {
    void (async () => {
      paused = false
      await pickNext($)
      await publish($)
    })()
  },
})

export const register: Register = (on, options) => {
  opt = readOptions(options)

  on('session.start', async ($, e, next) => {
    const repo = await $.session.repo()
    root = repo?.root ?? (await $.session.root())
    storeKey = `adddd:${root}`
    try {
      const saved = (await $.store.get(storeKey)) as Persisted | undefined
      if (saved?.workers) workers = saved.workers
      if (saved?.picked !== undefined) picked = saved.picked
      if (saved?.source) source = saved.source
    } catch {
      // a fresh store
    }
    // a hot reload keeps the agents; a new process does not
    let alive: string[] = []
    try {
      alive = (await $.agent.list()).filter(a => a.status !== 'completed' && a.status !== 'failed' && a.status !== 'killed').map(a => a.id)
    } catch {
      alive = []
    }
    for (const w of workers) {
      const waits = w.status === 'running' || w.status === 'needs-human'
      if (waits && !(w.agentId && alive.includes(w.agentId))) {
        w.status = 'failed'
        w.question = 'this worker belonged to a previous session; type a prompt to run it again in the same worktree, or /adddd review it'
        w.agentId = undefined
      }
    }
    loaded = true
    await declare($)
    $.clock.every(RECONCILE_MS, () => void reconcile($).catch(() => undefined))
    if (workers.some(isActive) || picked) void $.ui.open({ id: PANE, title: 'adddd' })
    await publish($)
    return next(e)
  })

  on('command.run', { command: 'adddd' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ')
    const now = await $.clock.now()
    switch (verb) {
      case '':
      case 'start':
      case 'go': {
        paused = false
        void $.ui.open({ id: PANE, title: 'adddd' })
        const t = await pickNext($)
        await publish($)
        return { text: pickedText(t) }
      }
      case 'next':
      case 'skip': {
        const t = await pickNext($, picked?.key)
        await publish($)
        return { text: pickedText(t) }
      }
      case 'pane': {
        const opened = await $.ui.open({ id: PANE, title: 'adddd' })
        return { text: opened.isPlaced ? 'adddd board opened.' : `adddd board waits: ${opened.reason}` }
      }
      case 'pause': {
        paused = true
        await publish($)
        return { text: 'adddd paused. workers keep running; nothing new gets picked.' }
      }
      case 'resume': {
        paused = false
        const t = picked ?? (await pickNext($))
        await publish($)
        return { text: pickedText(t) }
      }
      case 'status':
        return { text: statusText(now) }
      case 'open':
      case 'view': {
        const w = arg ? findWorker(arg) : (() => { const c = nowCard({ workers, picked }); return c.kind === 'worker' ? c.worker : undefined })()
        if (!w) return { text: arg ? `no worker ${arg}` : 'nothing to open: no worker is waiting on you.' }
        if (!w.agentId) return { text: `${w.key} has no live worker in this session.` }
        viewing = w.agentId
        const r = await $.ui.view({ agentId: w.agentId })
        if ('deny' in r && r.deny) {
          viewing = undefined
          return { text: `cannot open ${w.key}: ${r.deny}` }
        }
        return { text: `viewing ${w.key}. your next Enter goes to it. /adddd back returns.` }
      }
      case 'back': {
        viewing = undefined
        await $.ui.view({})
        return { text: 'back to the inbox.' }
      }
      case 'ok':
      case 'done': {
        const targets =
          arg === 'all'
            ? workers.filter(w => w.status === 'done')
            : arg
              ? [findWorker(arg)].filter((w): w is AddddWorker => w !== undefined)
              : (() => { const c = nowCard({ workers, picked }); return c.kind === 'worker' ? [c.worker] : [] })()
        if (targets.length === 0) return { text: arg && arg !== 'all' ? `no worker ${arg}` : 'nothing to dismiss.' }
        for (const w of targets) w.status = 'dismissed'
        await publish($)
        return { text: `dismissed ${targets.map(w => w.key).join(', ')}. branches stay; /adddd cleanup removes clean worktrees.` }
      }
      case 'reply': {
        const [key = '', ...words] = rest
        const w = findWorker(key)
        if (!w) return { text: `no worker ${key}` }
        if (words.length === 0) return { text: `/adddd reply ${w.key} <your words>` }
        const err = await reply($, w, words.join(' '))
        await publish($)
        return { text: err ? `adddd · ${err}` : `↩ sent to ${w.key}` }
      }
      case 'source': {
        if (arg !== 'linear' && arg !== 'github') return { text: `source is ${source}. /adddd source linear|github` }
        source = arg
        picked = null
        await publish($)
        return { text: `adddd now pulls from ${source}. /adddd to pick.` }
      }
      case 'dismiss': {
        const w = findWorker(arg)
        if (!w) return { text: `no worker ${arg}` }
        w.status = 'dismissed'
        await publish($)
        return { text: `${w.key} dismissed. its branch ${w.branch} stays; /adddd cleanup removes clean worktrees.` }
      }
      case 'retry': {
        const w = findWorker(arg)
        if (!w) return { text: `no worker ${arg}` }
        try {
          await dispatch($, w.ticket, w.prompt)
          sound($, 'dispatch')
          await publish($)
          return { text: `${w.key} re-dispatched to ${w.worktree}` }
        } catch (err) {
          return { text: `retry failed: ${(err as Error)?.message ?? String(err)}` }
        }
      }
      case 'cleanup': {
        const out: string[] = []
        for (const w of workers.filter(x => x.status === 'dismissed')) {
          if (await isDirty($, w.worktree)) {
            out.push(`kept ${w.key}: worktree has uncommitted changes`)
            continue
          }
          const err = await removeWorktree($, root, w.worktree)
          if (err) out.push(`kept ${w.key}: ${err}`)
          else {
            out.push(`removed ${w.worktree} (branch ${w.branch} kept)`)
            workers = workers.filter(x => x.key !== w.key)
          }
        }
        await publish($)
        return { text: out.length ? out.join('\n') : 'nothing to clean: dismiss done worktrees first.' }
      }
      case 'review': {
        const w = findWorker(arg)
        if (!w) return { text: `no worker ${arg}` }
        const commits = await lastCommits($, w.worktree, w.base, w.branch)
        return { text: [`${w.key} · ${w.branch} · ${w.worktree}`, ...commits.map(c => `  ${c}`), `files: ${w.touched.join(', ') || 'none'}`].join('\n') }
      }
      default:
        return { text: USAGE }
    }
  })

  on('prompt.submit', async ($, e, next) => {
    if (loaded && e.origin.kind === 'task-notification' && isWorkerNotification(e.text)) {
      const w = workers.find(x => (x.agentId && e.text.includes(x.agentId)) || e.text.includes(`adddd-${safeKey(x.key)}`))
      return { drop: w ? `📬 ${w.key} reported in · ${w.status} · see the board` : '📬 a worker reported in · see the board' }
    }
    if (!loaded || viewing || e.command || e.isMeta || e.origin.kind !== 'composer') return next(e)
    const text = e.text.trim()
    if (!text || text.startsWith('/')) return next(e)
    const card = nowCard({ workers, picked })
    if (card.kind === 'worker') {
      const w = card.worker
      if (w.status === 'failed') {
        try {
          await dispatch($, w.ticket, text)
          sound($, 'dispatch')
          await publish($)
          clearComposer($)
          return { drop: `🔁 ${w.key} re-dispatched to ${w.branch} with your new prompt` }
        } catch (err) {
          return { drop: `adddd · retry failed: ${(err as Error)?.message ?? String(err)}` }
        }
      }
      const err = await reply($, w, text)
      await publish($)
      if (err) return { drop: `adddd · ${err}` }
      clearComposer($)
      return { drop: `↩ sent to ${w.key} · it comes back when it needs you${picked ? `  ⟶  NEXT ▶ ${picked.key} · ${picked.title} · type ONE prompt` : ''}` }
    }
    if (card.kind !== 'ticket' || paused) return next(e)
    const ticket = card.ticket
    picked = null
    try {
      const worker = await dispatch($, ticket, text)
      sound($, 'dispatch')
      void markTicket($, ticket, 'start')
      const nextTicket = await pickNext($)
      await publish($)
      void $.ui.open({ id: PANE, title: 'adddd' })
      clearComposer($)
      const shipped = `🎯 ${ticket.key} shipped to ${worker.branch} · ${inFlight(workers).length} in flight · it comes back only when it needs you`
      const upNext = nextTicket ? `NEXT ▶ ${nextTicket.key} · ${nextTicket.title} · type ONE prompt` : 'backlog empty 🎉 · /adddd to check again'
      return { drop: `${shipped}  ⟶  ${upNext}` }
    } catch (err) {
      picked = ticket
      note = `dispatch failed: ${(err as Error)?.message ?? String(err)}`.slice(0, 200)
      await publish($)
      return { drop: `adddd · ${note} · your prompt is still in the box; nothing was sent anywhere.` }
    }
  }).catch(($, e, next) => (next.called ? next(e) : { drop: 'adddd · the dispatch hook failed; your prompt was not sent anywhere. try again.' }))

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const w = workers.find(x => x.agentId === e.agentId)
      if (w && w.status !== 'running') {
        w.status = 'running'
        w.question = undefined
        w.updatedAt = await $.clock.now()
        await publish($)
      }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const w = workers.find(x => x.agentId === e.agentId)
      if (w) {
        const now = await $.clock.now()
        if (e.reason === 'error' || e.reason === 'refusal') {
          w.status = 'failed'
          w.question = `the worker ended on ${e.reason}`
          w.summary = e.answer.slice(0, 200)
        } else if (e.reason === 'aborted') {
          w.status = 'failed'
          w.question = 'the worker was interrupted (a /clear or a stop); type a prompt to run it again in the same worktree'
        } else {
          const parsed = parseStatus(e.answer)
          w.summary = parsed.summary
          w.question = parsed.question
          w.status = parsed.status === 'done' ? 'done' : 'needs-human'
        }
        w.updatedAt = now
        await refreshTouched($, w)
        if (w.status === 'done') void markTicket($, w.ticket, 'review')
        announce($, w)
        await publish($)
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    viewing = e.props.view.agentId
    const b = await read($, board)
    const { Box, Text, Button } = $.ui.resolve(e)
    return drawPane({ Box, Text, Button }, b, actions($), viewing)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    viewing = e.props.view.agentId
    if (e.props.hasSurvey) return next(e)
    const panes = await $.ui.panes()
    if (panes.some(p => p.id === PANE && p.isShown && p.isPlaced)) return next(e)
    const b = await read($, board)
    const { Box, Text, Button } = $.ui.resolve(e)
    const tree = drawBand({ Box, Text, Button }, b, actions($), viewing)
    return tree ?? next(e)
  })

  on('session.end', async ($, e, next) => {
    if (loaded) await $.store.set(storeKey, { workers, picked, source } satisfies Persisted).catch(() => undefined)
    if (e.reason === 'clear')
      $.clock.after(600, () => {
        void (async () => {
          await declare($)
          if (workers.some(isActive) || picked) await $.ui.open({ id: PANE, title: 'adddd' })
          await publish($)
        })().catch(() => undefined)
      })
    return next(e)
  })
}
