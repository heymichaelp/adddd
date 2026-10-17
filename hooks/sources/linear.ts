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

export function toTicket(issue: Obj): AddddTicket | undefined {
  const key = typeof issue.identifier === 'string' ? issue.identifier : undefined
  const id = typeof issue.id === 'string' ? issue.id : key
  const title = typeof issue.title === 'string' ? issue.title : undefined
  if (!key || !id || !title) return undefined
  const created = typeof issue.createdAt === 'string' ? Date.parse(issue.createdAt) : NaN
  return {
    key,
    id,
    title,
    url: typeof issue.url === 'string' ? issue.url : `https://linear.app/issue/${key}`,
    source: 'linear',
    priority: typeof issue.priority === 'number' ? issue.priority : 0,
    createdAt: Number.isFinite(created) ? created : 0,
    description: typeof issue.description === 'string' ? issue.description : undefined,
  }
}

export async function listLinearIssues($: EngineInterface, server: string, team: string): Promise<AddddTicket[]> {
  const args: Obj = { limit: 50 }
  if (team) args.team = team
  const result = await $.mcp.call(server, 'list_issues', args)
  const text = textOf(result)
  if (result.isError) throw new Error(`Linear list_issues: ${text.slice(0, 300) || 'error'}`)
  const issues = parseIssueList(text)
  return issues
    .filter(issue => !NOT_BACKLOG.test(stateName(issue)))
    .map(toTicket)
    .filter((t): t is AddddTicket => t !== undefined)
}

/** Moves an issue to a workflow state by name. Resolves the error text, or undefined when it went through. */
export async function setLinearState($: EngineInterface, server: string, ticket: AddddTicket, state: string): Promise<string | undefined> {
  const result = await $.mcp.call(server, 'update_issue', { id: ticket.id, state })
  return result.isError ? textOf(result).slice(0, 200) || 'update_issue failed' : undefined
}
