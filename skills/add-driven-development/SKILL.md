---
name: add-driven-development
description: Work a ticket backlog the adddd way: pick one ticket, take exactly one prompt from the operator, do the work in a dedicated git worktree on branch adddd/<KEY>, commit without pushing, and report with an ADDDD status block. Use when the operator says "adddd", asks to clear a backlog one ticket at a time, wants background workers in worktrees, or when you are the worker for a dispatched ticket.
compatibility: Requires git. Ticket lookup uses the Linear MCP server or the gh CLI when available.
metadata:
  author: heymichaelp
  version: "0.2.0"
---

# ADD-driven development

The operator has ADD. They look at exactly one card at a time. Everything else runs in the background and only comes back when it needs a human.

## If you are the operator's assistant (picking and dispatching)

1. Pull open tickets from the backlog: Linear (`list_issues`, skip states like In Progress, In Review, Done, Canceled) or GitHub Issues (`gh issue list --state open --json number,title,url,labels,body`, skip issues labelled `adddd:*`).
2. Pick one. Prefer random, weighted toward priority (urgent 8, high 4, medium 2, low 1, none 1.5). Show the operator only that ticket: key, title, link.
3. Ask for ONE prompt. Do not discuss. When it arrives, dispatch a worker (see below) and immediately pick the next ticket. The operator never sees the worker again until it stops.
4. Keep a board: for each worker, its key, branch, worktree path, status (running, needs-human, done, failed), files touched. Surface workers that stopped as cards, ahead of fresh tickets. A reply from the operator resumes that worker.
5. Never push, never open a pull request, never merge. Done means committed on the branch and waiting for a human review.

## If you are a worker (one ticket, one worktree)

- Your working directory is `.claude/worktrees/adddd/<KEY>` inside the repository, on branch `adddd/<KEY>` cut from the default branch. Create it with:

  ```
  git worktree add -b adddd/<KEY> .claude/worktrees/adddd/<KEY> origin/main
  ```

  (reuse the branch with `git worktree add <path> adddd/<KEY>` if it exists). Add `.claude/worktrees/` to `.git/info/exclude`.
- Work only inside that directory. Avoid files other workers are touching when you are told which. Match the project's conventions. Run the relevant tests before calling anything done.
- Commit on your branch with a message naming the ticket key. Never push.
- Ask exactly one crisp question when you need a decision, then stop.
- End every final message with the status block in [references/status-block.md](references/status-block.md).

## Between tickets

Interleave one small, real distraction if the operator wants it: an article, a repository, or an unread chat message. One card, four actions (dismiss, gist in place, open in browser, send to self), then back to the next ticket.
