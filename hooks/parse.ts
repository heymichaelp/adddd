export type ParsedStatus = {
  status: 'done' | 'needs-human' | 'blocked'
  summary: string
  question?: string
  /** What was already done and ruled out (needs-human / blocked): the operator's re-entry note. */
  soFar?: string
  /** What the worker verified, e.g. "tests ✔ · typecheck ✔ · build –". */
  checks?: string
  /** A follow-up ticket the worker noticed but did not do; the operator can file it with one key. */
  suggest?: string
}

const STATUS = /ADDDD:\s*(done|needs-human|needs human|blocked)\b/gi

function lastParagraph(text: string): string {
  const parts = text
    .replace(/```[\s\S]*?```/g, '')
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

function field(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`^\\s*${name}:\\s*([\\s\\S]*?)(?=^\\s*(?:summary|question|so-far|sofar|checks|suggest|ADDDD):|\\s*\`\`\`|$(?![\\r\\n]))`, 'mi'))
  const v = m?.[1]?.trim()
  return v ? v : undefined
}

/**
 * Reads the worker's closing status block. Tolerant: with no block at all the
 * worker is treated as needing a human, its last paragraph the question.
 */
export function parseStatus(answer: string): ParsedStatus {
  const text = answer ?? ''
  let last: RegExpExecArray | null = null
  for (let m = STATUS.exec(text); m; m = STATUS.exec(text)) last = m
  STATUS.lastIndex = 0
  if (!last) {
    const tail = lastParagraph(text)
    return { status: 'needs-human', summary: tail.slice(0, 200), question: tail || 'The worker stopped without saying why.' }
  }
  const block = text.slice(last.index)
  const word = (last[1] ?? '').toLowerCase().replace(' ', '-') as ParsedStatus['status']
  const summary = field(block, 'summary') ?? lastParagraph(text.slice(0, last.index)).slice(0, 200)
  const question = field(block, 'question')
  const soFar = field(block, 'so-far') ?? field(block, 'sofar')
  const checks = field(block, 'checks')
  const suggest = field(block, 'suggest')
  if (word === 'done') return { status: 'done', summary, soFar, checks, suggest }
  return { status: word, summary, question: question ?? (word === 'blocked' ? summary : 'The worker needs you.'), soFar, checks }
}
