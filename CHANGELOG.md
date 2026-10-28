# Changelog

## 0.6.3 — 2026-10-28

- Fix: the Linear backlog still read as empty when a page was too big (#14). `list_issues` is now asked for only the fields a ticket needs (no descriptions), 50 at a time, following `cursor` while `hasNextPage` is true, up to 200 per status type. One page of 50 with descriptions was about 75,000 characters, which the host swaps for a "saved to file" notice.
- A non-empty `list_issues` answer with no issue list in it is now an error (`Linear list_issues: unreadable result: …`) on the card, not "the backlog is empty 🎉".
- A picked Linear ticket's description is fetched on its own with `get_issue`, for the suggested prompts and the worker. Without one, the prompts stay generic.

## 0.6.2 — 2026-10-28

- Fix: the Linear backlog reads as empty against the official Linear MCP server (#10). The server returns each issue as `id: "ENG-123"` with a `uuid` beside it and `priority` as `{ value, name }`; the plugin wanted `identifier` and a number, so every issue was dropped before the picker saw it. Both shapes are accepted now, and priority weighting works again.
- Candidates are asked for by status type (`backlog`, `unstarted`), one page of 100 each, instead of the team's 50 most recently updated issues filtered afterwards, so a day of closed tickets cannot crowd the backlog out.
- A backlog fetch that fails shows its reason on the NOW card and in `/adddd status` until the next fetch works, instead of an 8-second toast followed by "the backlog is empty 🎉".

## 0.6.1 — 2026-10-20

- Fix: `file it` and `dismiss` on a card now act on the registry's own worker, so filing a suggestion or parking a worker sticks.

## 0.6.0 — 2026-10-20

- Workers can suggest a follow-up: a `suggest:` line in the status block becomes a 💡 line on the done card with `2: file it`, which files it into Linear or GitHub Issues without leaving the card (`/adddd file [KEY]` does the same).
- `next` replaces `meh`: whatever is in front of you, the next thing. A squirrel, a nudge or a Slack message goes away; a ticket is skipped. `meh` still works as an alias.
- adddd.dev: the site is a simulation of the plugin, with a narrated demo, tracker and host skins, and the plugin's own commands at the prompt.

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
