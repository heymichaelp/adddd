import type { AddddTicket, PickMode } from '../types'

/** Linear-style priority: 1 urgent, 2 high, 3 medium, 4 low, 0 none. */
export function weightOf(priority: number): number {
  switch (priority) {
    case 1:
      return 8
    case 2:
      return 4
    case 3:
      return 2
    case 4:
      return 1
    default:
      return 1.5
  }
}

/** Sort key for strict priority: urgent first, "none" sits between medium and low. */
function rankOf(priority: number): number {
  return priority === 0 ? 3.5 : priority
}

export function pick(
  tickets: readonly AddddTicket[],
  mode: PickMode,
  rand: () => number = Math.random,
): AddddTicket | undefined {
  if (tickets.length === 0) return undefined
  if (mode === 'priority') {
    return [...tickets].sort(
      (a, b) => rankOf(a.priority) - rankOf(b.priority) || a.createdAt - b.createdAt,
    )[0]
  }
  const weights = tickets.map(t => (mode === 'random' ? 1 : weightOf(t.priority)))
  const total = weights.reduce((a, b) => a + b, 0)
  let roll = rand() * total
  for (let i = 0; i < tickets.length; i++) {
    roll -= weights[i] ?? 0
    if (roll <= 0) return tickets[i]
  }
  return tickets[tickets.length - 1]
}
