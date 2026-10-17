# Changelog

## 0.5.0 — 2026-10-17

Built from a research pass on ADHD and software work (ICSE 2025 "Get Me In The Groove", the 2026 copresence study, Tether, and clinical write-ups): re-entry, capture, time, review gates.

- Re-entry: worker cards show what you said, the worker's `so-far:` note, and the files it is touching; session start shows "while you were gone" and the "tomorrow, start here" note from `/adddd eod`.
- Capture: `/adddd idea <text>` files a backlog ticket without leaving your card; `/adddd later` files the squirrel in front of you.
- `/adddd standup`: three lines on yesterday / today / blocked, drafted from the board and copied.
- Time: the status line shows how long you have been at it; after `breakEvery` minutes (default 90) without a break the next card sends you off-screen; a worker that needs you still wins.
- Review gates: workers report a `checks:` line (tests, typecheck, build) and the done card shows it, plus a "start here" file.
- Softer words: stalled instead of failed, park it instead of give up. `quiet` (default on) drops toasts and OS notifications while a card is already in front; the sound stays.

## 0.4.0 — 2026-10-17

- Off-screen squirrels: about one in three squirrels is a nudge to leave the screen (text your mom, get a snack, but hurry), time-of-day aware, with `did it`, `slack me` and a persistent `never again`. `lifeShare` sets the share.

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
