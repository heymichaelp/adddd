import type { EngineInterface, McpToolResult } from 'claude-code'

import type { AddddTicket } from '../../types'

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

export function textOf(result: McpToolResult): string {
  return result.content
    .map(block => (isObj(block) && typeof block.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
}

/** Pulls the list of issues out of whatever shape the server answered with. */
export function parseIssueList(text: string): Obj[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start < 0 || end <= start) return []
    try {
      data = JSON.parse(text.slice(start, end + 1))
    } catch {
      return []
    }
  }
  if (Array.isArray(data)) return data.filter(isObj)
  if (isObj(data)) {
    for (const k of ['issues', 'nodes', 'data', 'results', 'items']) {
      const v = data[k]
      if (Array.isArray(v)) return v.filter(isObj)
      if (isObj(v) && Array.isArray(v.nodes)) return v.nodes.filter(isObj)
    }
  }
  return []
}

/** States that mean someone is already on it, or it is over. */
const NOT_BACKLOG = /done|complete|cancel|closed|duplicate|merged|released|review|progress|started/i

function stateName(issue: Obj): string {
  const s = issue.state ?? issue.status
  if (typeof s === 'string') return s
  if (isObj(s) && typeof s.name === 'string') return s.name
  return ''
}

/** `ENG-123`: the identifier Linear shows. The official server returns it as `id`, with the row's `uuid` beside it. */
const KEY = /^[A-Z][A-Z0-9]*-\d+$/

function keyOf(issue: Obj): string | undefined {
  if (typeof issue.identifier === 'string') return issue.identifier
  if (typeof issue.id === 'string' && KEY.test(issue.id)) return issue.id
  return undefined
}

/** A number (1 urgent … 4 low), or the official server's `{ value, name }`. */
function priorityOf(issue: Obj): number {
  const p = issue.priority
  if (typeof p === 'number') return p
  if (isObj(p) && typeof p.value === 'number') return p.value
  return 0
}

export function toTicket(issue: Obj): AddddTicket | undefined {
  const key = keyOf(issue)
  // The uuid when the server gives one, else whatever it calls the id: update_issue takes either.
  const id = typeof issue.uuid === 'string' ? issue.uuid : typeof issue.id === 'string' ? issue.id : key
  const title = typeof issue.title === 'string' ? issue.title : undefined
  if (!key || !id || !title) return undefined
  const created = typeof issue.createdAt === 'string' ? Date.parse(issue.createdAt) : NaN
  return {
    key,
    id,
    title,
    url: typeof issue.url === 'string' ? issue.url : `https://linear.app/issue/${key}`,
    source: 'linear',
    priority: priorityOf(issue),
    createdAt: Number.isFinite(created) ? created : 0,
    description: typeof issue.description === 'string' ? issue.description : undefined,
  }
}

/**
 * The status types nobody is on yet. Asked for by type, one call each, so a busy team's day of
 * closed tickets cannot crowd the candidates out of an unfiltered "most recently updated" page.
 */
const BACKLOG_TYPES = ['backlog', 'unstarted']

/**
 * A guard behind the server-side filter, for a server that ignores it: the issue's own status type
 * when it carries one, and only failing that the state's name.
 */
export function stillBacklog(issue: Obj): boolean {
  if (typeof issue.statusType === 'string') return BACKLOG_TYPES.includes(issue.statusType)
  if (isObj(issue.state) && typeof issue.state.type === 'string') return BACKLOG_TYPES.includes(issue.state.type)
  return !NOT_BACKLOG.test(stateName(issue))
}

export async function listLinearIssues($: EngineInterface, server: string, team: string): Promise<AddddTicket[]> {
  const found = new Map<string, AddddTicket>()
  for (const state of BACKLOG_TYPES) {
    const args: Obj = { limit: 100, state }
    if (team) args.team = team
    const result = await $.mcp.call(server, 'list_issues', args)
    const text = textOf(result)
    if (result.isError) throw new Error(`Linear list_issues: ${text.slice(0, 300) || 'error'}`)
    for (const issue of parseIssueList(text)) {
      if (!stillBacklog(issue)) continue
      const ticket = toTicket(issue)
      if (ticket && !found.has(ticket.key)) found.set(ticket.key, ticket)
    }
  }
  return [...found.values()]
}

/** Files a new issue in the backlog. Resolves its key and url, or throws with the server's complaint. */
export async function createLinearIssue($: EngineInterface, server: string, team: string, title: string, description: string): Promise<{ key: string; url: string }> {
  const args: Obj = { title, description }
  if (team) args.team = team
  const result = await $.mcp.call(server, 'create_issue', args)
  const text = textOf(result)
  if (result.isError) throw new Error(`Linear create_issue: ${text.slice(0, 200) || 'error'}`)
  const issue = parseIssueList(text)[0] ?? (() => { try { const d: unknown = JSON.parse(text); return isObj(d) ? (isObj(d.issue) ? d.issue : d) : {} } catch { return {} } })()
  const key = keyOf(issue) ?? text.match(/\b[A-Z][A-Z0-9]+-\d+\b/)?.[0] ?? 'LIN-?'
  const url = typeof issue.url === 'string' ? issue.url : text.match(/https?:\/\/linear\.app\/\S+/)?.[0] ?? ''
  return { key, url }
}

/** Moves an issue to a workflow state by name. Resolves the error text, or undefined when it went through. */
export async function setLinearState($: EngineInterface, server: string, ticket: AddddTicket, state: string): Promise<string | undefined> {
  const result = await $.mcp.call(server, 'update_issue', { id: ticket.id, state })
  return result.isError ? textOf(result).slice(0, 200) || 'update_issue failed' : undefined
}
