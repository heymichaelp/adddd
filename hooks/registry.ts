import type { AddddBoard, AddddSlackMsg, AddddSquirrel, AddddTicket, AddddWorker } from '../types'

export const ACTIVE = new Set(['running', 'needs-human', 'done'])

export function isActive(w: AddddWorker): boolean {
  return ACTIVE.has(w.status)
}

/** Worktrees still on disk and on the board: everything not dismissed. */
export function openWorktrees(workers: readonly AddddWorker[]): AddddWorker[] {
  return workers.filter(w => w.status !== 'dismissed')
}

export function atCapacity(workers: readonly AddddWorker[], max: number): boolean {
  return max > 0 && openWorktrees(workers).length >= max
}

export function inFlight(workers: readonly AddddWorker[]): AddddWorker[] {
  return workers.filter(w => w.status === 'running')
}

export function needsHuman(workers: readonly AddddWorker[]): AddddWorker[] {
  return workers
    .filter(w => w.status === 'needs-human' || w.status === 'failed')
    .sort((a, b) => a.updatedAt - b.updatedAt)
}

export function doneUnreviewed(workers: readonly AddddWorker[]): AddddWorker[] {
  return workers.filter(w => w.status === 'done').sort((a, b) => a.updatedAt - b.updatedAt)
}

export type NowCard =
  | { kind: 'idle' }
  | { kind: 'worker'; worker: AddddWorker }
  | { kind: 'slack'; msg: AddddSlackMsg }
  | { kind: 'squirrel'; squirrel: AddddSquirrel }
  | { kind: 'ticket'; ticket: AddddTicket }

/** The one thing the operator should look at: a worker that needs them, then a Slack message, then a squirrel, then a fresh ticket. */
export function nowCard(board: Pick<AddddBoard, 'workers' | 'picked'> & Partial<Pick<AddddBoard, 'squirrel' | 'slackMsg'>>): NowCard {
  const human = needsHuman(board.workers)[0] ?? doneUnreviewed(board.workers)[0]
  if (human) return { kind: 'worker', worker: human }
  if (board.slackMsg) return { kind: 'slack', msg: board.slackMsg }
  if (board.squirrel) return { kind: 'squirrel', squirrel: board.squirrel }
  if (board.picked) return { kind: 'ticket', ticket: board.picked }
  return { kind: 'idle' }
}

/** Files two or more live worktrees both touch, keyed by ticket. */
export function overlapsOf(workers: readonly AddddWorker[]): Record<string, Record<string, string[]>> {
  const live = workers.filter(isActive)
  const out: Record<string, Record<string, string[]>> = {}
  for (const a of live) {
    for (const b of live) {
      if (a.key === b.key) continue
      const shared = a.touched.filter(f => b.touched.includes(f))
      if (shared.length === 0) continue
      ;(out[a.key] ??= {})[b.key] = shared
    }
  }
  return out
}

export function statusLine(
  board: Pick<AddddBoard, 'workers' | 'backlogCount' | 'paused'> & Partial<Pick<AddddBoard, 'capacity' | 'startedAt' | 'now'>>,
): string {
  const running = inFlight(board.workers).length
  const human = needsHuman(board.workers).length
  const done = doneUnreviewed(board.workers).length
  const cap = board.capacity
  const bits = [cap && cap.max > 0 ? `${running} in flight · ${cap.open}/${cap.max} worktrees` : `${running} in flight`]
  if (human) bits.push(`${human} need${human === 1 ? 's' : ''} you`)
  if (done) bits.push(`${done} done`)
  bits.push(`${board.backlogCount} in backlog`)
  if (board.paused) bits.push('paused')
  if (board.startedAt && board.now && board.now - board.startedAt >= 60000) bits.push(`${elapsed(board.startedAt, board.now)} at it`)
  return `adddd · ${bits.join(' · ')}`
}

/** "1h35m" style, for how long something has been going on. */
export function elapsed(from: number, now: number): string {
  const m = Math.max(0, Math.floor((now - from) / 60000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h${String(m % 60).padStart(2, '0')}m`
}

/**
 * The hyperfocus guard: true when the operator has gone `breakEvery` minutes without a break
 * and is not snoozing. breakEvery 0 turns it off.
 */
export function breakDue(lastBreakAt: number, now: number, breakEvery: number, snoozedUntil = 0): boolean {
  if (breakEvery <= 0) return false
  if (now < snoozedUntil) return false
  return now - lastBreakAt >= breakEvery * 60000
}

export type StandupFacts = {
  dispatched: AddddWorker[]
  finished: AddddWorker[]
  waiting: AddddWorker[]
  running: AddddWorker[]
}

/** What happened since local midnight yesterday, from the registry alone. */
export function standupFacts(workers: readonly AddddWorker[], now: number): StandupFacts {
  const since = new Date(now)
  since.setHours(0, 0, 0, 0)
  since.setDate(since.getDate() - 1)
  const from = since.getTime()
  const recent = workers.filter(w => w.dispatchedAt >= from || w.updatedAt >= from)
  return {
    dispatched: recent.filter(w => w.dispatchedAt >= from),
    finished: recent.filter(w => (w.status === 'done' || w.status === 'dismissed') && w.updatedAt >= from),
    waiting: workers.filter(w => w.status === 'needs-human' || w.status === 'failed'),
    running: workers.filter(w => w.status === 'running'),
  }
}

/** Something that changed since the operator last looked, newest first. */
export function sinceYouLeft(workers: readonly AddddWorker[], lastSeenAt: number): AddddWorker[] {
  return workers.filter(w => w.updatedAt > lastSeenAt && w.status !== 'running').sort((a, b) => b.updatedAt - a.updatedAt)
}

export function ago(from: number, now: number): string {
  const s = Math.max(0, Math.round((now - from) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`
}

export function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'ticket'
}
