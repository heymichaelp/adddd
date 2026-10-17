export type ParsedStatus = {
  status: 'done' | 'needs-human' | 'blocked'
  summary: string
  question?: string
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
  const m = block.match(new RegExp(`^\\s*${name}:\\s*([\\s\\S]*?)(?=^\\s*(?:summary|question|ADDDD):|\\s*\`\`\`|$(?![\\r\\n]))`, 'mi'))
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
  if (word === 'done') return { status: 'done', summary }
  return { status: word, summary, question: question ?? (word === 'blocked' ? summary : 'The worker needs you.') }
}
