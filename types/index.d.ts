export type AddddSource = 'linear' | 'github'
export type PickMode = 'weighted' | 'random' | 'priority'
export type AddddStatus = 'running' | 'needs-human' | 'done' | 'failed' | 'dismissed'

export type AddddTicket = {
  /** Display key: ENG-123 for Linear, GH-45 for GitHub. */
  key: string
  /** The tracker's own id: a Linear uuid, a GitHub issue number. */
  id: string
  title: string
  url: string
  source: AddddSource
  /** Linear-style: 1 urgent, 2 high, 3 medium, 4 low, 0 none. */
  priority: number
  createdAt: number
  description?: string
}

export type AddddWorker = {
  key: string
  ticket: AddddTicket
  /** The operator's one prompt. */
  prompt: string
  branch: string
  worktree: string
  base: string
  agentId?: string
  status: AddddStatus
  summary?: string
  question?: string
  touched: string[]
  dispatchedAt: number
  updatedAt: number
}

export type AddddBoard = {
  workers: AddddWorker[]
  picked: AddddTicket | null
  paused: boolean
  backlogCount: number
  source: AddddSource
  note: string | null
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    adddd: { board: AddddBoard }
  }
}
