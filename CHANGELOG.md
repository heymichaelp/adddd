# Changelog

## 0.3.0 — 2026-10-17

- Every card has numbered suggestions: three model-drafted prompts per ticket, three replies per question; press the number key or type your own.
- At most six worktrees open at once (`maxInFlight`); at the cap adddd serves squirrels and Slack cards until something needs you or a slot is freed.
- Squirrel and Slack card actions relabelled: `gist` (bullets on the card) and `browser` (open the link); `look` and `open` remain as aliases.

## 0.2.0 — 2026-10-17

- Squirrels: one real link (Hacker News, GitHub repo search, dev.to) between tickets, curated by the model. meh / look / slack me / open.
- Slack cards: unread DMs, group DMs and @mentions served between tickets with a user token. meh / say / open / inbox.
- A prompt to a worker whose agent is gone re-dispatches it in the same worktree.
- Agent Plugins 1.0.0 layout: root `plugin.json`, `mcp.json`, and a portable `skills/add-driven-development` skill beside the Claude Code manifest.

## 0.1.0 — 2026-10-17

- First release: `/adddd` picks a ticket, one prompt dispatches a background worker into its own git worktree, cards come back only when a human is needed.
