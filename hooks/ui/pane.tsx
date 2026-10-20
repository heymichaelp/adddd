import type { Elements, RenderElement } from 'claude-code'

import type { AddddBoard, AddddWorker } from '../../types'
import { ago, doneUnreviewed, elapsed, inFlight, needsHuman, nowCard, overlapsOf } from '../registry'

export type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export type Actions = {
  /** Sends a ready-made prompt or reply for the card in front. */
  choose: (text: string) => void
  say: () => void
  meh: () => void
  look: () => void
  slack: () => void
  didIt: () => void
  never: () => void
  openLink: () => void
  jumpIn: (worker: AddddWorker) => void
  back: () => void
  dismiss: (worker: AddddWorker) => void
  file: (worker: AddddWorker) => void
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
  const full = board.capacity.max > 0 && board.capacity.open >= board.capacity.max
  const behind = board.picked
    ? ` — or type your prompt for ${board.picked.key} to skip past it`
    : full
      ? ` — ${board.capacity.open}/${board.capacity.max} worktrees open: review or dismiss one to get a new ticket`
      : ''
  if (card.kind === 'idle') {
    return (
      <Box flexDirection="column">
        <Text dimColor>
          {board.paused
            ? 'paused. nothing is being picked.'
            : full
              ? `${board.capacity.open}/${board.capacity.max} worktrees open and nothing needs you. /adddd ok clears reviewed ones; a squirrel is on its way.`
              : 'nothing in front of you.'}
        </Text>
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
            next (mark read)
          </Button>
          <Button key="say" hotkey="2" plain onPress={a.say}>
            say…
          </Button>
          <Button key="browser" hotkey="3" plain onPress={a.openLink}>
            browser
          </Button>
        </Box>
        <Text dimColor>
          /adddd next · say &lt;reply&gt; · browser{board.slackInbox > 0 ? ` · ${board.slackInbox} more waiting` : ''}
          {behind}
        </Text>
      </Box>
    )
  }
  if (card.kind === 'squirrel') {
    const s = card.squirrel
    if (s.source === 'life') {
      return (
        <Box flexDirection="column">
          <Text>
            <Text color="magenta" weight="bold">
              🚪 OFF-SCREEN
            </Text>
            <Text dimColor> · {s.blurb}</Text>
          </Text>
          <Text weight="bold">{s.title}</Text>
          <Text color="magenta">{s.why}</Text>
          {s.note ? <Text color="green">{s.note}</Text> : null}
          <Box gap={1}>
            <Button key="meh" hotkey="1" plain onPress={a.meh}>
              next
            </Button>
            <Button key="did" hotkey="2" plain onPress={a.didIt}>
              did it
            </Button>
            <Button key="slack" hotkey="3" plain onPress={a.slack}>
              slack me
            </Button>
            <Button key="never" hotkey="4" plain onPress={a.never}>
              never again
            </Button>
          </Box>
          <Text dimColor>
            /adddd next · did · slack · never
            {behind}
          </Text>
        </Box>
      )
    }
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
            next
          </Button>
          <Button key="gist" hotkey="2" plain onPress={a.look}>
            gist
          </Button>
          <Button key="slack" hotkey="3" plain onPress={a.slack}>
            slack me
          </Button>
          <Button key="browser" hotkey="4" plain onPress={a.openLink}>
            browser
          </Button>
        </Box>
        <Text dimColor>
          /adddd next · gist · slack · browser
          {behind}
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
        {(t.suggestions ?? []).slice(0, 3).map((p, i) => (
          <Box key={`pick-${i + 1}`}>
            <Button key={`pick-${i + 1}`} hotkey={String(i + 1)} plain onPress={() => a.choose(p)}>
              {p}
            </Button>
          </Box>
        ))}
        <Text dimColor>
          press a number, or type your own prompt and Enter. it ships to a worktree and you never see it again (until it needs you).
          {board.now - (board.pickedAt ?? board.now) >= 120000 ? ` · picked ${elapsed(board.pickedAt ?? board.now, board.now)} ago` : ''}
        </Text>
        <Box gap={1}>
          <Button key="skip" hotkey="0" plain onPress={a.skip}>
            skip this ticket
          </Button>
          <Button key="pause" hotkey="9" plain onPress={a.pause}>
            pause
          </Button>
        </Box>
      </Box>
    )
  }
  const w = card.worker
  const color = w.status === 'done' ? 'green' : w.status === 'failed' ? 'red' : 'yellow'
  const head = w.status === 'done' ? 'done, review me' : w.status === 'failed' ? 'stalled' : 'needs you'
  const touching = w.touched.length > 0 ? `${w.touched.slice(0, 3).join(', ')}${w.touched.length > 3 ? ` (+${w.touched.length - 3})` : ''}` : ''
  const checksBad = /✘|fail/i.test(w.checks ?? '')
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={color} weight="bold">
          {glyph(w)} {w.key}
        </Text>{' '}
        {head} <Text dimColor>· {ago(w.updatedAt, board.now)} · {w.branch}</Text>
      </Text>
      <Text dimColor>you said: "{w.prompt.length > 120 ? w.prompt.slice(0, 117) + '…' : w.prompt}"</Text>
      {w.soFar ? <Text dimColor>so far: {w.soFar}</Text> : null}
      {w.summary ? <Text dimColor>{w.summary}</Text> : null}
      {w.status !== 'done' && w.question ? <Text color={color}>"{w.question}"</Text> : null}
      {w.status === 'done' && w.checks ? <Text color={checksBad ? 'red' : 'green'}>checks: {w.checks}</Text> : null}
      {w.status === 'done' && !w.checks ? <Text color="yellow">checks: the worker did not say what it ran</Text> : null}
      {touching ? <Text dimColor>{w.status === 'done' ? 'start here: ' : 'touching: '}{touching}</Text> : null}
      {w.status === 'done' && w.suggest ? (
        w.filed ? <Text color="green">💡 filed {w.filed} · {w.suggest}</Text> : <Text color="cyan">💡 also found: {w.suggest}</Text>
      ) : null}
      <Text dimColor>
        {w.status === 'done'
          ? 'press a number, or type a follow-up and it resumes · /adddd review ' + w.key
          : w.status === 'failed'
            ? 'press a number, or type a prompt to pick it up again'
            : 'press a number, or type your own reply and Enter'}
      </Text>
      {w.status === 'needs-human'
        ? (w.suggestions ?? []).slice(0, 3).map((p, i) => (
            <Box key={`reply-${i + 1}`}>
              <Button key={`reply-${i + 1}`} hotkey={String(i + 1)} plain onPress={() => a.choose(p)}>
                {p}
              </Button>
            </Box>
          ))
        : null}
      <Box gap={1}>
        {w.status === 'done' ? (
          <Button key={`dismiss-${w.key}`} hotkey="1" plain onPress={() => a.dismiss(w)}>
            reviewed, next
          </Button>
        ) : null}
        {w.status === 'done' && w.suggest && !w.filed ? (
          <Button key={`file-${w.key}`} hotkey="2" plain onPress={() => a.file(w)}>
            file it
          </Button>
        ) : null}
        {w.status === 'done' && w.agentId ? (
          <Button key={`jump-${w.key}`} hotkey={w.suggest && !w.filed ? '3' : '2'} plain onPress={() => a.jumpIn(w)}>
            open transcript
          </Button>
        ) : null}
        {w.status === 'failed' ? (
          <Button key={`retry-${w.key}`} hotkey="1" plain onPress={() => a.retry(w)}>
            pick it up again
          </Button>
        ) : null}
        {w.status === 'failed' ? (
          <Button key={`giveup-${w.key}`} hotkey="2" plain onPress={() => a.dismiss(w)}>
            park it
          </Button>
        ) : null}
        {w.status === 'needs-human' ? (
          <Button key={`dismiss-${w.key}`} hotkey="0" plain onPress={() => a.dismiss(w)}>
            dismiss
          </Button>
        ) : null}
      </Box>
    </Box>
  )
}

export function drawPane(ui: Ui, board: AddddBoard, a: Actions, viewingAgent: string | undefined): RenderElement {
  void viewingAgent
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
        {board.source} · {board.backlogCount} in backlog{board.capacity.max > 0 ? ` · ${board.capacity.open}/${board.capacity.max} worktrees` : ''}{board.picked ? ` · picked ${board.picked.key}` : ''}{board.paused ? ' · paused' : ''}
        {board.note ? ` · ${board.note}` : ''}
      </Text>
    </Box>
  )
}
