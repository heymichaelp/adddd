import type { EngineInterface } from 'claude-code'

import type { AddddTicket } from '../../types'

export const GH_LABEL_PROGRESS = 'adddd:in-progress'
export const GH_LABEL_REVIEW = 'adddd:review'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function labelsOf(issue: Obj): string[] {
  const raw = issue.labels
  if (!Array.isArray(raw)) return []
  return raw.map(l => (isObj(l) && typeof l.name === 'string' ? l.name : typeof l === 'string' ? l : '')).filter(Boolean)
}

export function priorityOfLabels(labels: readonly string[]): number {
  const text = labels.join(' ').toLowerCase()
  if (/\b(urgent|p0|critical|blocker)\b/.test(text)) return 1
  if (/\b(high|p1|important)\b/.test(text)) return 2
  if (/\b(medium|p2)\b/.test(text)) return 3
  if (/\b(low|p3|p4|nice.to.have)\b/.test(text)) return 4
  return 0
}

export function toTicket(issue: Obj): AddddTicket | undefined {
  const number = typeof issue.number === 'number' ? issue.number : undefined
  const title = typeof issue.title === 'string' ? issue.title : undefined
  if (number === undefined || !title) return undefined
  const labels = labelsOf(issue)
  const created = typeof issue.createdAt === 'string' ? Date.parse(issue.createdAt) : NaN
  return {
    key: `GH-${number}`,
    id: String(number),
    title,
    url: typeof issue.url === 'string' ? issue.url : '',
    source: 'github',
    priority: priorityOfLabels(labels),
    createdAt: Number.isFinite(created) ? created : 0,
    description: typeof issue.body === 'string' ? issue.body : undefined,
  }
}

function repoArgs(repo: string): string[] {
  return repo ? ['--repo', repo] : []
}

export async function listGithubIssues($: EngineInterface, root: string, repo: string): Promise<AddddTicket[]> {
  const ran = await $.process.run(
    ['gh', 'issue', 'list', '--state', 'open', '--limit', '100', '--json', 'number,title,url,labels,createdAt,body', ...repoArgs(repo)],
    { cwd: root, timeoutMs: 30000 },
  )
  if (ran.exitCode !== 0) throw new Error(`gh issue list: ${ran.stderr.trim().slice(0, 300) || `exit ${ran.exitCode}`}`)
  let data: unknown
  try {
    data = JSON.parse(ran.stdout)
  } catch {
    throw new Error('gh issue list: unreadable JSON')
  }
  if (!Array.isArray(data)) return []
  return data
    .filter(isObj)
    .filter(issue => !labelsOf(issue).some(l => l.startsWith('adddd:')))
    .map(toTicket)
    .filter((t): t is AddddTicket => t !== undefined)
}

/** Adds one adddd label (creating it if needed) and drops the other. Resolves the error text, or undefined. */
export async function labelGithubIssue(
  $: EngineInterface,
  root: string,
  repo: string,
  ticket: AddddTicket,
  add: string,
  remove?: string,
): Promise<string | undefined> {
  await $.process.run(['gh', 'label', 'create', add, '--force', '--color', 'B60205', '--description', 'adddd worker state', ...repoArgs(repo)], {
    cwd: root,
    timeoutMs: 30000,
  })
  const argv = ['gh', 'issue', 'edit', ticket.id, '--add-label', add, ...repoArgs(repo)]
  if (remove) argv.push('--remove-label', remove)
  const ran = await $.process.run(argv, { cwd: root, timeoutMs: 30000 })
  return ran.exitCode === 0 ? undefined : ran.stderr.trim().slice(0, 200) || `gh issue edit exit ${ran.exitCode}`
}
