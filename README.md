# adddd — ADD-Driven Development

**Rails to fly off of.** A Claude Code plugin for brains that work best with exactly one thing in front of them.

adddd picks a ticket from your backlog, lets you type **one** prompt, ships that prompt plus the ticket to a background worker in its own git worktree, and immediately surfaces the next ticket. Worktrees come back to you only when they need a human: a question, a blocker, or done-and-ready-for-review. Unlimited workers in flight; you handle one card at a time.

**[adddd.dev](https://adddd.dev)** is the site, and it works the same way: the content is a backlog you dispatch, one card at a time. Prefer to just read it? [adddd.dev/#read](https://adddd.dev/#read).

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
| `/adddd next` / `gist` / `slack` / `browser` | the squirrel in front of you: next, three-bullet gist on the card, DM yourself, open in your browser (`look` and `open` are aliases) |
| `/adddd squirrel` | fetch one now |
| `/adddd did` / `never` | an off-screen card: you did the thing · retire that nudge for good |
| `/adddd idea <text>` / `later` / `file` | file a backlog ticket without leaving your card · file the squirrel in front of you · file the follow-up a done worker suggested |
| `/adddd standup` | three lines on yesterday / today / blocked, drafted from the board and copied |
| `/adddd eod` | what is open, plus a "tomorrow, start here" note you see first next time |
| `/adddd say <reply>` / `next` / `browser` / `inbox` | the unread Slack message in front of you: reply, mark read, open the permalink, check now |
| `/adddd view [KEY]` / `back` | put a worker's transcript in the main view, and return |
| `/adddd reply KEY …` | answer a worker explicitly (a plain prompt does this too, see below) |
| `/adddd review KEY` | commits and files on a worker's branch |
| `/adddd source linear\|github` | switch backlog per project |
| `/adddd retry KEY` / `dismiss KEY` / `cleanup` | housekeeping |

**Every card comes with numbered suggestions.** A picked ticket shows three ready-made prompts (three generic ones instantly, then three written for that ticket by a quick model call); a worker's question shows three candidate replies. Press the number in the empty prompt box and it is sent as if you had typed it. Type anything else to override. `0` skips a ticket, `9` pauses.

**At most six worktrees are open at once** (`maxInFlight` in `/config`; 0 means unlimited). Everything not dismissed counts, including done cards waiting for your review, so the way to get a new ticket is to review one. At the cap with nothing needing you, adddd serves squirrels (and Slack cards) one after another instead of a ticket; the moment a worker comes back or you free a slot, the ticket flow resumes.

**Your next plain prompt goes to whatever is in the NOW card.** A worker that needs you beats a fresh ticket:

- NOW is a worker waiting on you: your prompt is the reply. It resumes in its worktree and comes back when it stops again.
- NOW is a done worker: a prompt is a follow-up (it resumes); `/adddd ok` moves on.
- NOW is a failed worker: a prompt re-runs it with your new words.
- NOW is a picked ticket: your prompt dispatches it.

**Squirrels.** Between tickets a 🐿️ card shows up: one real link (a Hacker News story, a GitHub repo, a dev.to post) on a topic inferred from your repo's dependencies and languages, with one line from the model on why you might care. `/adddd next` dismisses it, `gist` fetches the page and puts a three-bullet gist on the card (you stay in the terminal), `browser` opens it in your browser, `slack` DMs it to you (set a Slack incoming webhook pointed at your own DM under `/config` → adddd) and moves on. Typing a prompt skips straight past it to the ticket. Set `topics` in `/config` to steer the hunt, or turn `squirrels` off.

**Re-entry.** A card that comes back shows what you said when you dispatched it, the worker's one-line `so far` (what it did and ruled off), and the files it is touching, so you do not rebuild the ticket in your head. When you come back to a session, the band says what happened while you were gone. `/adddd eod` when you stop writes a "tomorrow, start here" note that is the first thing you see next time.

**Capture.** `/adddd idea <text>` files a backlog ticket (GitHub issue labelled `adddd:idea`, or a Linear issue) with a note of which card you were on, and leaves you on that card. `/adddd later` on a squirrel files the link the same way. A worker that notices something outside its ticket says so in a `suggest:` line; the done card shows it as 💡 and `2: file it` (or `/adddd file`) turns it into a ticket without leaving the card. `/adddd standup` drafts three lines from the board and your branches' commits and copies them.

**Time.** The status line shows how long you have been at it. After `breakEvery` minutes (default 90) without a break, the next card is an off-screen nudge that says so; `did it` counts as the break, `next` snoozes it twenty minutes. A worker that needs you is never pre-empted by it. Typing after a gap of fifteen minutes or more also counts as a break.

**Review gates.** Workers end with a `checks:` line (tests, typecheck, build) and the done card shows it in green or red, or says the worker did not report any. The card's `start here:` names the first touched file. Cards say *stalled* and *park it*, not failed and give up. With `quiet` on (default) nothing toasts or notifies while a card is already in front of you; the sound still plays.

**Off-screen squirrels.** About one squirrel in three is not a link at all but a 🚪 nudge to leave the screen for a minute: *text your mom*, *get a snack, but hurry*, *refill your water*, *lie on the floor for two minutes*. They fit the hour (coffee in the morning, dinner in the evening, brush your teeth late). `did it` dismisses with a little fanfare, `next` just dismisses, `slack me` DMs the reminder, and `never again` retires that nudge permanently (it is remembered across sessions). `lifeShare` in `/config` sets the share, 0 to 1.

**Slack between tickets.** With a Slack *user* token in `/config` → adddd (`slackToken`, stored as a secret), adddd polls every two minutes for unread DMs, group DMs and @mentions of you. Each one becomes a 💬 card served between tickets, ahead of squirrels, chaining until the inbox is empty. `/adddd next` marks it read, `/adddd say <reply>` answers (in-thread for a channel mention), `/adddd browser` opens the permalink, `/adddd inbox` checks now. Typing a plain prompt skips the card without marking it read, so a ticket prompt can never land in Slack. With a token set, "slack me" on a squirrel DMs you directly and the webhook is not needed.

To make the token: create a Slack app for your workspace, add these *User Token Scopes* under OAuth & Permissions: `channels:history channels:read groups:history groups:read im:history im:read im:write mpim:history mpim:read mpim:write users:read search:read chat:write`, install it, and copy the User OAuth Token (`xoxp-…`).

Either way the prompt is dropped from the main conversation; the main context stays empty. Slash commands, and prompts typed while a worker's transcript is in view, pass through untouched. Workers commit on `adddd/<KEY>` and never push or open PRs; the branch and worktree stay until `/adddd cleanup`.

## Backlogs

- **Linear** (default): through the Linear MCP server, which the plugin lists itself (`.mcp.json`). Open issues in backlog-ish states are candidates; dispatch moves the issue to *In Progress*, done moves it to *In Review*. Set `linearTeam` in `/config` to narrow to one team.
- **GitHub Issues**: through `gh` (already logged in). Dispatch adds the label `adddd:in-progress`, done swaps it for `adddd:review`. Priority comes from labels (`P0`/`urgent`, `P1`/`high`, …).

Picking is random, weighted toward priority. `/config` has `pick: weighted | random | priority`, `maxInFlight` (default 6), `moveToReview`, `sounds` and more.

## How it works

One hooks module (`hooks/register.tsx`), no server, no daemon:

- `prompt.submit` intercepts your one prompt and drops it from the main conversation.
- Each ticket gets `git worktree add .claude/worktrees/adddd/<KEY> -b adddd/<KEY>` and a background subagent (`adddd:worker`) whose cwd is that worktree. Its prompt carries the ticket, your words, and a board of what other workers are touching, so they avoid each other.
- `turn.complete` reads the worker's closing `ADDDD: done | needs-human | blocked` block.
- A reconciler runs every 20 s: agent liveness, files touched per branch (`git diff --name-only base...branch` plus uncommitted), overlaps between worktrees.
- The registry lives in the plugin store, so it survives `/clear` and restarts. `/clear` (and Ctrl-C at an idle prompt, which Claude Code treats as "stop all background agents") aborts running workers though: those workers come back as *failed* with their worktree intact, and a typed prompt re-runs them. Workers from a previous session show the same way.

## Agent Plugins conformance

The package also follows [Agent Plugins 1.0.0](https://agent-plugins.org/specification), the vendor-neutral layout, so a conformant client can pick up its portable parts:

| Path | Who reads it |
| --- | --- |
| `plugin.json` | any Agent Plugins client (closed manifest, `$schema` 1.0.0) |
| `mcp.json` | any Agent Plugins client: the Linear server as `streamable-http` |
| `skills/add-driven-development/` | any Agent Skills client: the workflow, usable without the mod |
| `.claude-plugin/plugin.json`, `.mcp.json`, `hooks/`, `types/` | Claude Code only (its native layout; the hooks module is Claude Code's function-hooks API) |

The two manifests carry the same name and version. `node scripts/check-conformance.mjs` checks the spec rules that matter for a package (manifest field set and name constraints, `mcp.json` variants and URL rules, skill frontmatter) and that the Claude Code manifest is in lockstep.

## Develop

```
claude plugin validate .
claude plugin test .
node scripts/check-conformance.mjs
```

## License

MIT, see `LICENSE`.
