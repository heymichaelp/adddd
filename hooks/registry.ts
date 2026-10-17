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

export function statusLine(board: Pick<AddddBoard, 'workers' | 'backlogCount' | 'paused'> & Partial<Pick<AddddBoard, 'capacity'>>): string {
  const running = inFlight(board.workers).length
  const human = needsHuman(board.workers).length
  const done = doneUnreviewed(board.workers).length
  const cap = board.capacity
  const bits = [cap && cap.max > 0 ? `${running} in flight · ${cap.open}/${cap.max} worktrees` : `${running} in flight`]
  if (human) bits.push(`${human} need${human === 1 ? 's' : ''} you`)
  if (done) bits.push(`${done} done`)
  bits.push(`${board.backlogCount} in backlog`)
  if (board.paused) bits.push('paused')
  return `adddd · ${bits.join(' · ')}`
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
