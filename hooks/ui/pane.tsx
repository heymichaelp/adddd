import type { Elements, RenderElement } from 'claude-code'

import type { AddddBoard, AddddWorker } from '../../types'
import { ago, doneUnreviewed, inFlight, needsHuman, nowCard, overlapsOf } from '../registry'

export type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export type Actions = {
  say: () => void
  meh: () => void
  look: () => void
  slack: () => void
  openLink: () => void
  jumpIn: (worker: AddddWorker) => void
  back: () => void
  dismiss: (worker: AddddWorker) => void
  retry: (worker: AddddWorker) => void
  skip: () => void
  pause: () => void
  start: () => void
}

const PRIORITY = ['', 'urgent', 'high', 'medium', 'low'] as const

export function priorityTag(priority: number): string {
  const p = PRIORITY[priority]
  return p ? ` (${p})` : ''
}

function glyph(w: AddddWorker): string {
  switch (w.status) {
    case 'running':
      return '●'
    case 'needs-human':
      return '!'
    case 'done':
      return '✓'
    case 'failed':
      return '✗'
    default:
      return '·'
  }
}

export function workerLine(w: AddddWorker, now: number): string {
  const files = w.touched.length > 0 ? ` · ${w.touched.length} file${w.touched.length === 1 ? '' : 's'}` : ''
  return `${w.key} ${w.status} ${ago(w.updatedAt, now)}${files}`
}

export function drawNow(ui: Ui, board: AddddBoard, a: Actions, viewingAgent: string | undefined): RenderElement {
  const { Box, Text, Button } = ui
  const card = nowCard(board)
  if (viewingAgent) {
    const w = board.workers.find(x => x.agentId === viewingAgent)
    return (
      <Box flexDirection="column">
        <Text color="yellow">↳ replying to {w?.key ?? 'a worker'} — your next Enter goes to it</Text>
        <Box>
          <Button key="back" hotkey="0" plain onPress={a.back}>
            back to the inbox
          </Button>
        </Box>
      </Box>
    )
  }
  if (card.kind === 'idle') {
    return (
      <Box flexDirection="column">
        <Text dimColor>{board.paused ? 'paused. nothing is being picked.' : 'nothing in front of you.'}</Text>
        <Box>
          <Button key="start" hotkey="1" plain onPress={a.start}>
            {board.paused ? 'resume + pick a ticket' : 'pick a ticket'}
          </Button>
        </Box>
      </Box>
    )
  }
  if (card.kind === 'slack') {
    const m = card.msg
    return (
      <Box flexDirection="column">
        <Text>
          <Text color="blue" weight="bold">
            💬 SLACK
          </Text>
          <Text dimColor>
            {' '}
            · {m.channelName} · {ago(Number(m.ts) * 1000, board.now)} ago
          </Text>
        </Text>
        <Text>
          <Text weight="bold">{m.userName}:</Text> {m.text}
        </Text>
        {m.note ? <Text color="green">{m.note}</Text> : null}
        <Box gap={1}>
          <Button key="meh" hotkey="1" plain onPress={a.meh}>
            meh (mark read)
          </Button>
          <Button key="say" hotkey="2" plain onPress={a.say}>
            say…
          </Button>
          <Button key="open" hotkey="3" plain onPress={a.openLink}>
            open
          </Button>
        </Box>
        <Text dimColor>
          /adddd meh · say &lt;reply&gt; · open{board.slackInbox > 0 ? ` · ${board.slackInbox} more waiting` : ''}
          {board.picked ? ` — or type your prompt for ${board.picked.key} to skip past it` : ''}
        </Text>
      </Box>
    )
  }
  if (card.kind === 'squirrel') {
    const s = card.squirrel
    return (
      <Box flexDirection="column">
        <Text>
          <Text color="cyan" weight="bold">
            🐿️ SQUIRREL
          </Text>
          <Text dimColor>
            {' '}
            · {s.source} · {s.topic}
          </Text>
        </Text>
        <Text weight="bold">{s.title}</Text>
        <Text dimColor>{s.blurb}</Text>
        <Text color="cyan">{s.why}</Text>
        {(s.gist ?? []).map((b, i) => (
          <Text key={`gist-${i}`}>  • {b}</Text>
        ))}
        {s.note ? <Text color="green">{s.note}</Text> : null}
        <Text dimColor>{s.url}</Text>
        <Box gap={1}>
          <Button key="meh" hotkey="1" plain onPress={a.meh}>
            meh
          </Button>
          <Button key="look" hotkey="2" plain onPress={a.look}>
            look
          </Button>
          <Button key="slack" hotkey="3" plain onPress={a.slack}>
            slack me
          </Button>
          <Button key="open" hotkey="4" plain onPress={a.openLink}>
            open
          </Button>
        </Box>
        <Text dimColor>
          /adddd meh · look · slack · open
          {board.picked ? ` — or type your prompt for ${board.picked.key} ${board.picked.title} to skip past it` : ''}
        </Text>
      </Box>
    )
  }
  if (card.kind === 'ticket') {
    const t = card.ticket
    return (
      <Box flexDirection="column">
        <Text>
          <Text color="magenta" weight="bold">
            🎯 {t.key}
          </Text>{' '}
          {t.title}
          <Text dimColor>{priorityTag(t.priority)}</Text>
        </Text>
        <Text dimColor>type ONE prompt and press Enter. it ships to a worktree and you never see it again (until it needs you).</Text>
        <Box gap={1}>
          <Button key="skip" hotkey="1" plain onPress={a.skip}>
            skip
          </Button>
          <Button key="pause" hotkey="2" plain onPress={a.pause}>
            pause
          </Button>
        </Box>
      </Box>
    )
  }
  const w = card.worker
  const color = w.status === 'done' ? 'green' : w.status === 'failed' ? 'red' : 'yellow'
  const head = w.status === 'done' ? 'done, review me' : w.status === 'failed' ? 'failed' : 'needs you'
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={color} weight="bold">
          {glyph(w)} {w.key}
        </Text>{' '}
        {head} <Text dimColor>· {ago(w.updatedAt, board.now)} · {w.branch}</Text>
      </Text>
      {w.summary ? <Text dimColor>{w.summary}</Text> : null}
      {w.status !== 'done' && w.question ? <Text color={color}>"{w.question}"</Text> : null}
      <Text dimColor>
        {w.status === 'done'
          ? 'type a follow-up and it resumes · /adddd ok moves on · /adddd review ' + w.key
          : w.status === 'failed'
            ? 'type a new prompt to re-run it · /adddd ok gives up'
            : 'type your reply and press Enter · /adddd ok dismisses'}
      </Text>
      <Box gap={1}>
        {w.status !== 'failed' && w.agentId ? (
          <Button key={`jump-${w.key}`} hotkey="1" plain onPress={() => a.jumpIn(w)}>
            {w.status === 'done' ? 'open transcript' : 'jump in + reply'}
          </Button>
        ) : null}
        {w.status === 'failed' ? (
          <Button key={`retry-${w.key}`} hotkey="1" plain onPress={() => a.retry(w)}>
            retry
          </Button>
        ) : null}
        <Button key={`dismiss-${w.key}`} hotkey="2" plain onPress={() => a.dismiss(w)}>
          {w.status === 'done' ? 'reviewed, next' : 'dismiss'}
        </Button>
      </Box>
    </Box>
  )
}

export function drawPane(ui: Ui, board: AddddBoard, a: Actions, viewingAgent: string | undefined): RenderElement {
  const { Box, Text } = ui
  const running = inFlight(board.workers)
  const waiting = needsHuman(board.workers)
  const done = doneUnreviewed(board.workers)
  const overlaps = overlapsOf(board.workers)
  const rows = [...waiting, ...done, ...running]
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text weight="bold" color="magenta">
          NOW
        </Text>
        {drawNow(ui, board, a, viewingAgent)}
      </Box>
      <Box flexDirection="column">
        <Text weight="bold" color="magenta">
          IN FLIGHT <Text dimColor>({running.length} running · {waiting.length} waiting on you · {done.length} done)</Text>
        </Text>
        {rows.length === 0 ? <Text dimColor>no worktrees yet. /adddd to start.</Text> : null}
        {rows.map(w => {
          const clash = overlaps[w.key]
          const clashText = clash ? ` ⚠ overlaps ${Object.keys(clash).join(', ')}` : ''
          return (
            <Text key={`row-${w.key}`} dimColor={w.status === 'running'}>
              {glyph(w)} {workerLine(w, board.now)}
              {clashText ? <Text color="yellow">{clashText}</Text> : null}
            </Text>
          )
        })}
      </Box>
      <Text dimColor>
        {board.source} · {board.backlogCount} in backlog{board.picked ? ` · picked ${board.picked.key}` : ''}{board.paused ? ' · paused' : ''}
        {board.note ? ` · ${board.note}` : ''}
      </Text>
    </Box>
  )
}
