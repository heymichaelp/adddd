import type { RenderElement } from 'claude-code'

import type { AddddBoard } from '../../types'
import { nowCard, statusLine } from '../registry'
import { drawNow, type Actions, type Ui } from './pane'

/** The band above the prompt: the NOW card, or nothing when there is nothing to do. */
export function drawBand(ui: Ui, board: AddddBoard, a: Actions, viewingAgent: string | undefined): RenderElement | null {
  const card = nowCard(board)
  if (card.kind === 'idle' && !viewingAgent) return null
  const { Box, Text } = ui
  return (
    <Box flexDirection="column">
      <Text weight="bold" color="magenta">
        NOW
      </Text>
      {drawNow(ui, board, a, viewingAgent)}
      <Text dimColor>{statusLine(board)}</Text>
    </Box>
  )
}
