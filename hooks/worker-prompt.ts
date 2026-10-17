import type { AddddTicket } from '../types'

export const WORKER_SYSTEM_PROMPT = `You are an adddd worker: one background Claude Code agent assigned to exactly one ticket, working alone inside a dedicated git worktree. The operator has ADD and will not look at you again until you stop, so work autonomously and stop only when you are done or truly blocked.

Rules:
- Work ONLY inside your working directory (your git worktree). Never cd out of it, never touch the main checkout or other worktrees, never run git commands against other branches.
- Read the project's conventions first (README, CLAUDE.md, package manifests, existing tests). Match them.
- Keep the diff focused on the ticket. No drive-by refactors.
- Run the relevant tests or build before you call anything done.
- When done: stage and commit on your branch with a clear message that names the ticket key. Never push. Never open a pull request. Never merge or rebase onto anything unless the ticket requires it.
- If you need a decision from the human, ask exactly one crisp question and stop. Do not guess on anything irreversible.
- Other workers may be touching nearby files (you will be told which). Avoid those files where you can; if you must change them, say so in your summary.
- Be terse in your final message. The operator reads it on a card the width of a postcard.

Every final message you send MUST end with this block (plain text, no fence needed):

ADDDD: done | needs-human | blocked
summary: one or two lines on what you did and where it stands
question: the one thing you need answered (needs-human / blocked only)

"done" means committed and ready for a human to review. "needs-human" means you are waiting on an answer. "blocked" means you cannot proceed at all (missing credentials, a broken toolchain). Omitting the block makes the operator read your whole message, which they will hate.`

export type OtherWorker = { key: string; title: string; branch: string; touched: string[] }

export type WorkerPromptInput = {
  ticket: AddddTicket
  operatorPrompt: string
  branch: string
  worktree: string
  base: string
  others: readonly OtherWorker[]
}

const PRIORITY = ['none', 'urgent', 'high', 'medium', 'low'] as const

export function buildWorkerPrompt(input: WorkerPromptInput): string {
  const { ticket, operatorPrompt, branch, worktree, base, others } = input
  const description = (ticket.description ?? '').trim()
  const lines = [
    `# Ticket ${ticket.key}: ${ticket.title}`,
    `Source: ${ticket.source} · Priority: ${PRIORITY[ticket.priority] ?? 'none'} · ${ticket.url}`,
    '',
    description ? `## Description\n${description.slice(0, 6000)}${description.length > 6000 ? '\n…(truncated)' : ''}` : '## Description\n(none given; infer from the title and the codebase)',
    '',
    '## The operator said',
    operatorPrompt.trim(),
    '',
    '## Your environment',
    `- Working directory (your git worktree): ${worktree}`,
    `- Your branch: ${branch} (cut from ${base})`,
    '- Commit on your branch when done. Never push, never open a PR.',
  ]
  if (others.length > 0) {
    lines.push('', '## Other workers in flight right now (avoid their files)')
    for (const o of others) {
      const files = o.touched.length > 0 ? o.touched.slice(0, 12).join(', ') + (o.touched.length > 12 ? ', …' : '') : 'nothing yet'
      lines.push(`- ${o.key} ${o.title} · branch ${o.branch} · touching: ${files}`)
    }
  }
  lines.push('', 'Start now. End your final message with the ADDDD status block.')
  return lines.join('\n')
}

const STARTERS = [
  'Just fix it. Small diff, a test, a commit.',
  'Investigate first, then do the obvious thing.',
  'Do it the boring way. No cleverness.',
  'Ship the smallest change that closes this.',
  'Reproduce it, fix it, prove it with a test.',
  'Make it work, make it tested, commit.',
]

export function starterPrompt(rand: () => number = Math.random): string {
  return STARTERS[Math.floor(rand() * STARTERS.length)] ?? STARTERS[0]!
}
