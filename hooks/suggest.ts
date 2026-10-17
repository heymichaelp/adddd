import type { EngineInterface } from 'claude-code'

import type { AddddTicket, AddddWorker } from '../types'

export const STATIC_PROMPTS = [
  'Just fix it. Small diff, a test, a commit.',
  'Investigate first, then do the obvious thing.',
  'Write a failing test that reproduces it, then fix it.',
]

export const STATIC_REPLIES = [
  'Use your judgment. Keep it simple and commit.',
  'Do the simplest option and leave a comment saying why.',
  "Don't change anything yet. Write up the trade-offs and stop.",
]

/** Three short lines out of a JSON array or a numbered/bulleted list. */
export function parseList(text: string, count = 3): string[] {
  let items: string[] = []
  const m = text.match(/\[[\s\S]*\]/)
  if (m) {
    try {
      const data: unknown = JSON.parse(m[0])
      if (Array.isArray(data)) items = data.filter((x): x is string => typeof x === 'string')
    } catch {
      items = []
    }
  }
  if (items.length === 0) {
    items = text
      .split('\n')
      .map(l => l.replace(/^\s*(?:[-*•]|\d+[.):])\s*/, '').trim())
      .filter(l => l.length > 0 && !/^(here|sure|options?)\b/i.test(l))
  }
  const out: string[] = []
  for (const raw of items) {
    const s = raw.replace(/^["'`]+|["'`]+$/g, '').trim().slice(0, 140)
    if (s && !out.some(o => o.toLowerCase() === s.toLowerCase())) out.push(s)
    if (out.length === count) break
  }
  return out
}

export async function suggestPrompts($: EngineInterface, ticket: AddddTicket): Promise<string[]> {
  const prompt = [
    `Ticket ${ticket.key}: ${ticket.title}`,
    `Description: ${(ticket.description ?? '').trim().slice(0, 2000) || '(none)'}`,
    '',
    'Write 3 different one-line instructions a developer could send to an autonomous coding agent for this ticket.',
    '1: the minimal fix. 2: investigate before changing anything. 3: something specific to the details of this ticket.',
    'Each at most 14 words, imperative, concrete, no numbering inside the text. Answer with a JSON array of 3 strings only.',
  ].join('\n')
  const r = await $.model.complete({ model: 'haiku', prompt, maxTokens: 200, timeoutMs: 20000 })
  if (!r.isAnswered) return []
  return parseList(r.text)
}

export async function suggestReplies($: EngineInterface, w: AddddWorker): Promise<string[]> {
  const prompt = [
    `A coding agent working ticket ${w.key} (${w.ticket.title}) stopped and asked the operator:`,
    `"${(w.question ?? '').slice(0, 800)}"`,
    w.summary ? `Its summary so far: ${w.summary.slice(0, 400)}` : '',
    '',
    'Write 3 short replies the operator could send back, at most 12 words each.',
    '1 and 2: pick the concrete options the question implies, one each (if it offers none, propose two sensible choices).',
    "3: defer to the agent's judgment with one constraint.",
    'Answer with a JSON array of 3 strings only.',
  ].join('\n')
  const r = await $.model.complete({ model: 'haiku', prompt, maxTokens: 200, timeoutMs: 20000 })
  if (!r.isAnswered) return []
  return parseList(r.text)
}
