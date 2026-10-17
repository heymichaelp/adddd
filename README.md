# adddd — ADD-Driven Development

A Claude Code plugin for brains that work best with exactly one thing in front of them.

adddd picks a ticket from your backlog, lets you type **one** prompt, ships that prompt plus the ticket to a background worker in its own git worktree, and immediately surfaces the next ticket. Worktrees come back to you only when they need a human: a question, a blocker, or done-and-ready-for-review. Unlimited workers in flight; you handle one card at a time.

```
🎯 ENG-123 · Fix the login flake (urgent)
   type ONE prompt and press Enter. it ships to a worktree and you never see it again (until it needs you).
   [1: skip] [2: pause]      adddd · 4 in flight · 1 needs you · 23 in backlog
```

## Install

At the prompt of a terminal session:

```
/plugin install adddd --marketplace heymichaelp/adddd
```

Answer `y` to add the marketplace, then pick a scope. From a shell: `claude plugin install adddd --marketplace heymichaelp/adddd`.

To hack on it: `claude --plugin-dir /path/to/adddd`.

## Use

| Command | What it does |
| --- | --- |
| `/adddd` | picks a ticket and waits for your one prompt. Enter dispatches it. |
| `/adddd next` | skip the picked ticket |
| `/adddd ok [KEY\|all]` | dismiss the card in front of you (a done worker), one by key, or every done one |
| `/adddd pane` | open the board (NOW card, in-flight list, overlaps) |
| `/adddd pause` / `resume` | stop picking (workers keep running) |
| `/adddd status` | text summary of every worktree, readable by the model too |
| `/adddd meh` / `look` / `slack` / `open` | the squirrel in front of you: dismiss, gist, DM yourself, browser |
| `/adddd squirrel` | fetch one now |
| `/adddd say <reply>` / `meh` / `open` / `inbox` | the unread Slack message in front of you: reply, mark read, permalink, check now |
| `/adddd view [KEY]` / `back` | put a worker's transcript in the main view, and return |
| `/adddd reply KEY …` | answer a worker explicitly (a plain prompt does this too, see below) |
| `/adddd review KEY` | commits and files on a worker's branch |
| `/adddd source linear\|github` | switch backlog per project |
| `/adddd retry KEY` / `dismiss KEY` / `cleanup` | housekeeping |

**Your next plain prompt goes to whatever is in the NOW card.** A worker that needs you beats a fresh ticket:

- NOW is a worker waiting on you: your prompt is the reply. It resumes in its worktree and comes back when it stops again.
- NOW is a done worker: a prompt is a follow-up (it resumes); `/adddd ok` moves on.
- NOW is a failed worker: a prompt re-runs it with your new words.
- NOW is a picked ticket: your prompt dispatches it.

**Squirrels.** Between tickets a 🐿️ card shows up: one real link (a Hacker News story, a GitHub repo, a dev.to post) on a topic inferred from your repo's dependencies and languages, with one line from the model on why you might care. `/adddd meh` dismisses it, `look` fetches the page and puts a three-bullet gist on the card, `open` opens it in your browser, `slack` DMs it to you (set a Slack incoming webhook pointed at your own DM under `/config` → adddd) and moves on. Typing a prompt skips straight past it to the ticket. Set `topics` in `/config` to steer the hunt, or turn `squirrels` off.

**Slack between tickets.** With a Slack *user* token in `/config` → adddd (`slackToken`, stored as a secret), adddd polls every two minutes for unread DMs, group DMs and @mentions of you. Each one becomes a 💬 card served between tickets, ahead of squirrels, chaining until the inbox is empty. `/adddd meh` marks it read, `/adddd say <reply>` answers (in-thread for a channel mention), `/adddd open` jumps to the permalink, `/adddd inbox` checks now. Typing a plain prompt skips the card without marking it read, so a ticket prompt can never land in Slack. With a token set, "slack me" on a squirrel DMs you directly and the webhook is not needed.

To make the token: create a Slack app for your workspace, add these *User Token Scopes* under OAuth & Permissions: `channels:history channels:read groups:history groups:read im:history im:read im:write mpim:history mpim:read mpim:write users:read search:read chat:write`, install it, and copy the User OAuth Token (`xoxp-…`).

Either way the prompt is dropped from the main conversation; the main context stays empty. Slash commands, and prompts typed while a worker's transcript is in view, pass through untouched. Workers commit on `adddd/<KEY>` and never push or open PRs; the branch and worktree stay until `/adddd cleanup`.

## Backlogs

- **Linear** (default): through the Linear MCP server, which the plugin lists itself (`.mcp.json`). Open issues in backlog-ish states are candidates; dispatch moves the issue to *In Progress*, done moves it to *In Review*. Set `linearTeam` in `/config` to narrow to one team.
- **GitHub Issues**: through `gh` (already logged in). Dispatch adds the label `adddd:in-progress`, done swaps it for `adddd:review`. Priority comes from labels (`P0`/`urgent`, `P1`/`high`, …).

Picking is random, weighted toward priority. `/config` has `pick: weighted | random | priority`, `maxInFlight`, `moveToReview`, `sounds` and more.

## How it works

One hooks module (`hooks/register.tsx`), no server, no daemon:

- `prompt.submit` intercepts your one prompt and drops it from the main conversation.
- Each ticket gets `git worktree add .claude/worktrees/adddd/<KEY> -b adddd/<KEY>` and a background subagent (`adddd:worker`) whose cwd is that worktree. Its prompt carries the ticket, your words, and a board of what other workers are touching, so they avoid each other.
- `turn.complete` reads the worker's closing `ADDDD: done | needs-human | blocked` block.
- A reconciler runs every 20 s: agent liveness, files touched per branch (`git diff --name-only base...branch` plus uncommitted), overlaps between worktrees.
- The registry lives in the plugin store, so it survives `/clear` and restarts. `/clear` aborts running background agents though: those workers come back as *failed* with their worktree intact, and a typed prompt re-runs them. Workers from a previous session show the same way.

## Develop

```
claude plugin validate .
claude plugin test .
```
