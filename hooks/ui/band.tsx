import type { RenderElement } from 'claude-code'

import type { AddddBoard } from '../../types'
import { nowCard, statusLine } from '../registry'
import { drawNow, type Actions, type Ui } from './pane'

/** The band above the prompt: the NOW card, or nothing when there is nothing to do. */
export function drawBand(ui: Ui, board: AddddBoard, a: Actions, viewingAgent: string | undefined): RenderElement | null {
  const card = nowCard(board)
  const { Box, Text } = ui
  const failed = board.backlogError ? <Text color="yellow">could not read the backlog · {board.backlogError}</Text> : null
  if (card.kind === 'idle' && !viewingAgent) {
    if (!board.note && !failed) return null
    return (
      <Box flexDirection="column">
        {failed}
        {board.note ? <Text color="cyan">{board.note}</Text> : null}
        <Text dimColor>{statusLine(board)}</Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      <Text weight="bold" color="magenta">
        NOW
      </Text>
      {card.kind !== 'worker' ? failed : null}
      {board.note && card.kind !== 'worker' ? <Text color="cyan">{board.note}</Text> : null}
      {drawNow(ui, board, a, viewingAgent)}
      <Text dimColor>{statusLine(board)}</Text>
    </Box>
  )
}
