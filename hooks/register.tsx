import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { AddddBoard, AddddSlackMsg, AddddSource, AddddSquirrel, AddddTicket, AddddWorker, PickMode } from '../types'
import { parseStatus } from './parse'
import { pick } from './pick'
import { ago, atCapacity, inFlight, isActive, nowCard, openWorktrees, safeKey, statusLine } from './registry'
import { GH_LABEL_PROGRESS, GH_LABEL_REVIEW, labelGithubIssue, listGithubIssues } from './sources/github'
import { listLinearIssues, setLinearState } from './sources/linear'
import { dmSelf, markRead, permalinkOf, plainText, pollSlack, sayBack, userName, whoAmI, type SlackSeen } from './slack'
import { gistOf, huntSquirrel, openInBrowser, sendSlack, topicsOf } from './squirrel'
import { STATIC_PROMPTS, STATIC_REPLIES, suggestPrompts, suggestReplies } from './suggest'
import { drawBand } from './ui/band'
import { drawPane, type Actions } from './ui/pane'
import { buildWorkerPrompt, starterPrompt, WORKER_SYSTEM_PROMPT } from './worker-prompt'
import { baseBranch, ensureWorktree, isDirty, lastCommits, removeWorktree, touchedFiles } from './worktree'

const PANE = 'adddd'
const AGENT = 'adddd:worker'
const RECONCILE_MS = 20000

const EMPTY: AddddBoard = { workers: [], picked: null, squirrel: null, slackMsg: null, slackInbox: 0, capacity: { open: 0, max: 6 }, paused: false, backlogCount: 0, source: 'linear', note: null, now: 0 }
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
  squirrels: boolean
  topics: string
  slackWebhookUrl: string
  slackToken: string
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
    maxInFlight: Math.max(0, Math.floor(num('maxInFlight', 6))),
    moveToReview: bool('moveToReview', true),
    sounds: bool('sounds', true),
    squirrels: bool('squirrels', true),
    topics: str('topics', ''),
    slackWebhookUrl: str('slackWebhookUrl', ''),
    slackToken: str('slackToken', ''),
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
  '/adddd meh|gist|slack|browser   the squirrel in front of you: dismiss, gist, DM yourself, browser (look/open still work)',
  '/adddd say <reply> · meh · browser   the Slack message in front of you · /adddd inbox checks now',
  '/adddd squirrel      fetch one now',
  '/adddd view [KEY]    put that worker\'s transcript in the main view · /adddd back',
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
let squirrel: AddddSquirrel | null = null
let pantry: AddddSquirrel | null = null
let hunting = false
let seen: string[] = []
const SEEN_KEY = 'adddd:squirrels:seen'
let slackMsg: AddddSlackMsg | null = null
let slackInbox: AddddSlackMsg[] = []
let slackSeen: SlackSeen = {}
let slackSelf = ''
let slackPolling = false
let slackWarned = false
const slackNames = new Map<string, string>()
const SLACK_SEEN_KEY = 'adddd:slack:seen'
const SLACK_POLL_MS = 120000

/** A dropped prompt stays in the composer; wipe it once the drop has landed. */
function clearComposer($: EngineInterface): void {
  $.clock.after(150, () => void $.prompt.fill({ text: '', mode: 'replace' }).catch(() => undefined))
}

const sound = ($: EngineInterface, name: 'dispatch' | 'resurface' | 'done') => {
  if (opt.sounds) void $.audio.play({ asset: `sounds/${name}.wav` }).catch(() => undefined)
}

async function publish($: EngineInterface): Promise<AddddBoard> {
  const now = await $.clock.now()
  const snap: AddddBoard = {
    workers: [...workers],
    picked,
    squirrel,
    slackMsg,
    slackInbox: slackInbox.length,
    capacity: { open: openWorktrees(workers).length, max: opt.maxInFlight },
    paused,
    backlogCount: backlog.length,
    source,
    note,
    now,
  }
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
  if (atCapacity(workers, opt.maxInFlight)) {
    picked = null
    note = `${openWorktrees(workers).length}/${opt.maxInFlight} worktrees open · review or dismiss one to pick more`
    return null
  }
  const candidates = skipping ? backlog.filter(t => t.key !== skipping) : backlog
  picked = pick(candidates, opt.pick) ?? null
  if (picked) {
    picked.suggestions = [...STATIC_PROMPTS]
    void $.prompt.suggest({ text: starterPrompt() })
    void refreshPromptSuggestions($, picked)
  }
  return picked
}

async function refreshPromptSuggestions($: EngineInterface, t: AddddTicket): Promise<void> {
  const found = await suggestPrompts($, t).catch(() => [])
  if (found.length === 0 || picked?.key !== t.key) return
  picked.suggestions = found
  void $.prompt.suggest({ text: found[0] ?? '' })
  await publish($)
}

async function refreshReplySuggestions($: EngineInterface, w: AddddWorker): Promise<void> {
  const found = await suggestReplies($, w).catch(() => [])
  if (found.length === 0 || w.status !== 'needs-human') return
  w.suggestions = found
  await publish($)
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
  if (atCapacity(workers, opt.maxInFlight) && !workers.some(w => w.key === ticket.key && w.status !== 'dismissed')) {
    throw new Error(`${opt.maxInFlight} worktrees already open; review or dismiss one first`)
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

// ---------- squirrels ----------

function ticketContext(): string[] {
  return [...workers.map(w => w.ticket.title), ...(picked ? [picked.title] : [])].slice(-6)
}

/** Keeps one squirrel ready in the pantry so the card appears the instant a ticket ships. */
async function restock($: EngineInterface): Promise<void> {
  if (!opt.squirrels || pantry || hunting) return
  hunting = true
  try {
    const topics = await topicsOf($, root, opt.topics)
    const found = await huntSquirrel($, topics, new Set(seen), ticketContext())
    if (found) pantry = found
  } catch {
    // the internet was not interesting today
  } finally {
    hunting = false
  }
}

async function markSeen($: EngineInterface, url: string): Promise<void> {
  seen = [...seen.filter(u => u !== url), url].slice(-500)
  await $.store.set(SEEN_KEY, seen).catch(() => undefined)
}

/** Puts the pantry squirrel in front of the operator, if there is one. */
function serveSquirrel($: EngineInterface): boolean {
  if (!opt.squirrels || squirrel || !pantry) return false
  squirrel = pantry
  pantry = null
  void restock($)
  return true
}

/** Puts the oldest unread Slack message in front of the operator, if there is one. */
function serveSlack(): boolean {
  if (slackMsg || slackInbox.length === 0) return false
  slackMsg = slackInbox.shift() ?? null
  return slackMsg !== null
}

/** Between tickets: a Slack message if one waits, else a squirrel. */
function serveNext($: EngineInterface): 'slack' | 'squirrel' | undefined {
  if (serveSlack()) return 'slack'
  if (serveSquirrel($)) return 'squirrel'
  return undefined
}

/** At the cap with nothing needing you: a squirrel (or a Slack message) rather than an empty card. */
async function idleFill($: EngineInterface): Promise<boolean> {
  if (paused || !atCapacity(workers, opt.maxInFlight)) return false
  if (nowCard({ workers, picked, squirrel, slackMsg }).kind !== 'idle') return false
  if (!pantry && !hunting) await restock($)
  return serveNext($) !== undefined
}

/** A slot opened (a dismiss, a cleanup): pick a ticket again if none is waiting. */
async function afterSlotFreed($: EngineInterface): Promise<void> {
  if (paused || picked || atCapacity(workers, opt.maxInFlight)) return
  await pickNext($)
}

// ---------- slack ----------

async function slackName($: EngineInterface, user: string): Promise<string> {
  const known = slackNames.get(user)
  if (known) return known
  const name = await userName($, opt.slackToken, user)
  slackNames.set(user, name)
  return name
}

async function checkSlack($: EngineInterface): Promise<number> {
  if (!opt.slackToken || slackPolling) return 0
  slackPolling = true
  try {
    if (!slackSelf) slackSelf = await whoAmI($, opt.slackToken)
    const found = await pollSlack($, opt.slackToken, slackSelf, slackSeen, u => slackName($, u))
    slackSeen = found.seen
    await $.store.set(SLACK_SEEN_KEY, slackSeen).catch(() => undefined)
    const fresh = found.messages.filter(
      m => !slackInbox.some(q => q.channel === m.channel && q.ts === m.ts) && !(slackMsg && slackMsg.channel === m.channel && slackMsg.ts === m.ts),
    )
    for (const m of fresh) {
      const names: Record<string, string> = {}
      for (const [id, name] of slackNames) names[id] = name
      m.text = plainText(m.text, names).slice(0, 400)
      slackInbox.push(m)
    }
    if (fresh.length > 0) {
      $.ui.toast(`💬 ${fresh.length} unread Slack message${fresh.length === 1 ? '' : 's'} queued for between tickets`)
      await publish($)
    }
    return fresh.length
  } catch (err) {
    if (!slackWarned) {
      slackWarned = true
      $.ui.toast(`adddd · Slack: ${((err as Error)?.message ?? String(err)).slice(0, 140)}`, { timeoutMs: 8000 })
    }
    return 0
  } finally {
    slackPolling = false
  }
}

/** Marks the card's message read and moves on; the next one in the inbox follows at once. */
async function dismissSlack($: EngineInterface): Promise<void> {
  if (!slackMsg) return
  const m = slackMsg
  slackMsg = null
  if (opt.slackToken) void markRead($, opt.slackToken, m)
  serveSlack()
}

async function saySlack($: EngineInterface, text: string): Promise<string> {
  if (!slackMsg) return 'no Slack message in front of you.'
  if (!opt.slackToken) return 'no Slack token set (/config → adddd).'
  const m = slackMsg
  const err = await sayBack($, opt.slackToken, m, text)
  if (err) {
    m.note = `could not send: ${err}`
    await publish($)
    return m.note
  }
  await dismissSlack($)
  await publish($)
  return `💬 told ${m.userName}: ${text}`
}

async function openSlack($: EngineInterface): Promise<string> {
  if (!slackMsg) return 'no Slack message in front of you.'
  const m = slackMsg
  const link = opt.slackToken ? await permalinkOf($, opt.slackToken, m) : m.permalink
  if (!link) return 'no permalink for that message.'
  const err = await openInBrowser($, link)
  m.note = err ? `${err} · ${link}` : 'opened in your browser'
  await publish($)
  return err ? `${err}; the link is ${link}` : `opened ${link}`
}

async function dismissSquirrel($: EngineInterface): Promise<void> {
  if (!squirrel) return
  await markSeen($, squirrel.url)
  squirrel = null
  void restock($)
  await idleFill($)
}

async function lookAtSquirrel($: EngineInterface): Promise<string> {
  if (!squirrel) return 'no squirrel in front of you.'
  const s = squirrel
  try {
    s.gist = await gistOf($, s)
    await publish($)
    return `${s.title}\n${s.gist.map(b => `• ${b}`).join('\n')}`
  } catch (err) {
    s.note = `could not read it: ${(err as Error)?.message ?? String(err)}`
    await publish($)
    return s.note
  }
}

async function slackSquirrel($: EngineInterface): Promise<string> {
  if (!squirrel) return 'no squirrel in front of you.'
  const s = squirrel
  if (opt.slackToken) {
    if (!slackSelf) slackSelf = await whoAmI($, opt.slackToken).catch(() => '')
    const lines = [`🐿️ *${s.title}*`, s.url, s.why, ...(s.gist ?? []).map(b => `• ${b}`)]
    const err = slackSelf ? await dmSelf($, opt.slackToken, slackSelf, lines.join('\n')) : 'could not read your Slack user id'
    if (err) {
      s.note = `Slack: ${err}`
      await publish($)
      return s.note
    }
    await dismissSquirrel($)
    await publish($)
    return `📨 sent ${s.title} to your Slack DMs. moving on.`
  }
  if (!opt.slackWebhookUrl) {
    const copied = await $.ui.copy({ text: `${s.title}\n${s.url}` }).catch(() => ({ isCopied: false as const }))
    s.note = copied.isCopied ? 'no Slack webhook set (/config → adddd); copied the link instead' : 'no Slack webhook set (/config → adddd)'
    await publish($)
    return s.note
  }
  const err = await sendSlack($, opt.slackWebhookUrl, s).catch(e => (e as Error)?.message ?? String(e))
  if (err) {
    s.note = `Slack: ${err}`
    await publish($)
    return s.note
  }
  await dismissSquirrel($)
  await publish($)
  return `📨 sent ${s.title} to your Slack. moving on.`
}

async function openSquirrel($: EngineInterface): Promise<string> {
  if (!squirrel) return 'no squirrel in front of you.'
  const s = squirrel
  const err = await openInBrowser($, s.url)
  s.note = err ? `${err} · ${s.url}` : 'opened in your browser'
  await publish($)
  return err ? `${err}; the link is ${s.url}` : `opened ${s.url}`
}

/** The operator's words for a picked ticket: dispatch it, pick the next, serve a card. Resolves the line to show. */
async function shipTicket($: EngineInterface, ticket: AddddTicket, text: string): Promise<string> {
  picked = null
  try {
    const worker = await dispatch($, ticket, text)
    sound($, 'dispatch')
    void markTicket($, ticket, 'start')
    const nextTicket = await pickNext($)
    const served = serveNext($)
    await publish($)
    void $.ui.open({ id: PANE, title: 'adddd' })
    const shipped = `🎯 ${ticket.key} shipped to ${worker.branch} · ${inFlight(workers).length} in flight · it comes back only when it needs you`
    const upNext = nextTicket
      ? `NEXT ▶ ${nextTicket.key} · ${nextTicket.title} · press a number or type ONE prompt`
      : atCapacity(workers, opt.maxInFlight)
        ? `${openWorktrees(workers).length}/${opt.maxInFlight} worktrees open · squirrels until something needs you`
        : 'backlog empty 🎉 · /adddd to check again'
    const shiny =
      served === 'slack' && slackMsg
        ? `  ⟶  💬 first, Slack: ${slackMsg.userName} in ${slackMsg.channelName}`
        : served === 'squirrel' && squirrel
          ? `  ⟶  🐿️ first, a squirrel: ${squirrel.title}`
          : ''
    return `${shipped}${shiny}  ⟶  ${upNext}`
  } catch (err) {
    picked = ticket
    note = `dispatch failed: ${(err as Error)?.message ?? String(err)}`.slice(0, 200)
    await publish($)
    throw new Error(note)
  }
}

/** The operator's words for a worker card: a reply, or a re-run when its agent is gone. Resolves the line to show. */
async function answerWorker($: EngineInterface, w: AddddWorker, text: string): Promise<string> {
  if (w.status === 'failed' || !w.agentId) {
    await dispatch($, w.ticket, text)
    sound($, 'dispatch')
    await publish($)
    return `🔁 ${w.key} re-dispatched to ${w.branch} with your new prompt (its earlier commits are still on the branch)`
  }
  const err = await reply($, w, text)
  await publish($)
  if (err) throw new Error(err)
  return `↩ sent to ${w.key} · it comes back when it needs you${picked ? `  ⟶  NEXT ▶ ${picked.key} · ${picked.title} · press a number or type ONE prompt` : ''}`
}

/** A number key on the card: the same path as Enter, minus the composer. */
async function chooseNow($: EngineInterface, text: string): Promise<void> {
  const card = nowCard({ workers, picked, squirrel, slackMsg })
  try {
    if (card.kind === 'ticket') $.ui.toast(await shipTicket($, card.ticket, text), { timeoutMs: 8000 })
    else if (card.kind === 'worker') $.ui.toast(await answerWorker($, card.worker, text), { timeoutMs: 8000 })
  } catch (err) {
    $.ui.toast(`adddd · ${(err as Error)?.message ?? String(err)}`, { timeoutMs: 8000 })
  }
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
    argumentHint: '[next|ok|meh|gist|slack|browser|view|reply|pane|pause|status|source|review|retry|cleanup]',
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
  await idleFill($)
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
  choose: text => void chooseNow($, text),
  say: () => void $.prompt.fill({ text: '/adddd say ', mode: 'replace' }),
  meh: () => {
    void (async () => {
      if (slackMsg) await dismissSlack($)
      else await dismissSquirrel($)
      await publish($)
    })()
  },
  look: () => void lookAtSquirrel($),
  slack: () => void slackSquirrel($),
  openLink: () => void (slackMsg ? openSlack($) : openSquirrel($)),
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
    void (async () => {
      w.status = 'dismissed'
      await afterSlotFreed($)
      await publish($)
    })()
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
      if (w.agentId && alive.includes(w.agentId)) continue
      w.agentId = undefined
      if (w.status === 'running' || w.status === 'needs-human') {
        w.status = 'failed'
        w.question = 'this worker belonged to a previous session; type a prompt to run it again in the same worktree, or /adddd review it'
      }
    }
    try {
      const savedSeen = await $.store.get(SEEN_KEY)
      if (Array.isArray(savedSeen)) seen = savedSeen.filter((u): u is string => typeof u === 'string')
    } catch {
      seen = []
    }
    try {
      const savedSlack = await $.store.get(SLACK_SEEN_KEY)
      if (savedSlack && typeof savedSlack === 'object' && !Array.isArray(savedSlack)) slackSeen = savedSlack as SlackSeen
    } catch {
      slackSeen = {}
    }
    loaded = true
    await declare($)
    void restock($)
    if (opt.slackToken) {
      void checkSlack($)
      $.clock.every(SLACK_POLL_MS, () => void checkSlack($))
    }
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
        if (!t && atCapacity(workers, opt.maxInFlight)) {
          await idleFill($)
          await publish($)
          return { text: `${note ?? 'at capacity'}.${squirrel ? ` meanwhile: 🐿️ ${squirrel.title}` : ''}` }
        }
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
      case 'meh':
      case 'skipsquirrel': {
        if (slackMsg) {
          const gone = `${slackMsg.userName} in ${slackMsg.channelName}`
          await dismissSlack($)
          await publish($)
          return { text: `💬 ${gone} → marked read.${slackMsg ? ` next: ${slackMsg.userName}` : ''}` }
        }
        if (!squirrel) return { text: 'nothing in front of you to dismiss.' }
        const gone = squirrel.title
        await dismissSquirrel($)
        await publish($)
        return { text: `🐿️ ${gone} → gone.` }
      }
      case 'say': {
        if (!arg) return { text: '/adddd say <your reply>' }
        const said = await saySlack($, arg)
        return { text: said }
      }
      case 'inbox':
      case 'slackcheck': {
        if (!opt.slackToken) return { text: 'no Slack token set (/config → adddd → Slack user token).' }
        const n = await checkSlack($)
        if (!slackMsg && serveSlack()) await publish($)
        return { text: `💬 ${n} new · ${slackInbox.length + (slackMsg ? 1 : 0)} waiting${slackMsg ? ` · in front: ${slackMsg.userName}: ${slackMsg.text.slice(0, 80)}` : ''}` }
      }
      case 'gist':
      case 'look':
        return { text: await lookAtSquirrel($) }
      case 'slack':
        return { text: await slackSquirrel($) }
      case 'browser':
      case 'open':
        return { text: slackMsg ? await openSlack($) : await openSquirrel($) }
      case 'squirrel': {
        if (!opt.squirrels) return { text: 'squirrels are off (/config → adddd).' }
        if (!squirrel) {
          if (!pantry) await restock($)
          serveSquirrel($)
        }
        await publish($)
        return { text: squirrel ? `🐿️ ${squirrel.title}\n${squirrel.url}\n${squirrel.why}` : 'no squirrel found right now (network? topics?). try again in a bit.' }
      }
      case 'view': {
        const w = arg ? findWorker(arg) : (() => { const c = nowCard({ workers, picked, squirrel, slackMsg }); return c.kind === 'worker' ? c.worker : undefined })()
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
              : (() => { const c = nowCard({ workers, picked, squirrel, slackMsg }); return c.kind === 'worker' ? [c.worker] : [] })()
        if (targets.length === 0) return { text: arg && arg !== 'all' ? `no worker ${arg}` : 'nothing to dismiss.' }
        for (const w of targets) w.status = 'dismissed'
        await afterSlotFreed($)
        await publish($)
        return { text: `dismissed ${targets.map(w => w.key).join(', ')}. branches stay; /adddd cleanup removes clean worktrees.${picked ? ` NEXT ▶ ${picked.key} · ${picked.title}` : ''}` }
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
        await afterSlotFreed($)
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
        await afterSlotFreed($)
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
    let card = nowCard({ workers, picked, squirrel, slackMsg })
    if (card.kind === 'slack') {
      // never a reply: a ticket prompt must not leak into Slack. The message is skipped, not marked read.
      slackInbox.unshift(card.msg)
      slackMsg = null
      card = nowCard({ workers, picked, squirrel, slackMsg })
    }
    if (card.kind === 'squirrel') {
      await dismissSquirrel($)
      card = nowCard({ workers, picked, squirrel, slackMsg })
    }
    if (card.kind === 'worker') {
      try {
        const line = await answerWorker($, card.worker, text)
        clearComposer($)
        return { drop: line }
      } catch (err) {
        return { drop: `adddd · ${(err as Error)?.message ?? String(err)} · your words are still in the box.` }
      }
    }
    if (card.kind !== 'ticket' || paused) return next(e)
    try {
      const line = await shipTicket($, card.ticket, text)
      clearComposer($)
      return { drop: line }
    } catch (err) {
      return { drop: `adddd · ${(err as Error)?.message ?? String(err)} · your prompt is still in the box; nothing was sent anywhere.` }
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
          if (w.status === 'needs-human') {
            w.suggestions = [...STATIC_REPLIES]
            void refreshReplySuggestions($, w)
          }
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
