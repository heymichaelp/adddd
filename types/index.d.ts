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
  /** Ready-made prompts for the card; a number key sends one. */
  suggestions?: string[]
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
  /** Ready-made replies to the worker's question; a number key sends one. */
  suggestions?: string[]
  dispatchedAt: number
  updatedAt: number
}

export type SquirrelSource = 'hn' | 'github' | 'devto' | 'life'

/** Something shiny between tickets: a real link curated by the model, or (source 'life') an off-screen nudge with no url. */
export type AddddSquirrel = {
  id: string
  title: string
  url: string
  blurb: string
  source: SquirrelSource
  topic: string
  /** One line on why the operator might care. */
  why: string
  /** Three bullets after "look". */
  gist?: string[]
  /** What happened to it: sent to Slack, opened, … */
  note?: string
  foundAt: number
}

/** An unread Slack message in front of the operator. */
export type AddddSlackMsg = {
  channel: string
  channelName: string
  kind: 'dm' | 'mpim' | 'mention'
  user: string
  userName: string
  text: string
  ts: string
  permalink?: string
  note?: string
}

export type AddddBoard = {
  workers: AddddWorker[]
  picked: AddddTicket | null
  squirrel: AddddSquirrel | null
  slackMsg: AddddSlackMsg | null
  slackInbox: number
  /** Open worktrees (not dismissed) against the cap; max 0 means unlimited. */
  capacity: { open: number; max: number }
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
