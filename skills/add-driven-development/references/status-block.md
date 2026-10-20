# The ADDDD status block

Every worker's final message ends with this block, plain text, no fence required:

```
ADDDD: done | needs-human | blocked
summary: one or two lines on what you did and where it stands
so-far: what you already did and ruled out (needs-human and blocked only)
question: the one thing you need answered (needs-human and blocked only)
checks: tests ✔ · typecheck ✔ · build – (done only; ✔ passed, ✘ failed, – not applicable)
suggest: a follow-up ticket you noticed but did not do (optional; done only)
```

- `so-far` is the operator's re-entry note. They typed one prompt hours ago and have forgotten this ticket; one line on what is done and what was ruled out saves them rebuilding it.
- `checks` is the evidence line. A done card without it is shown as unverified.
- `suggest` is for the thing you saw and left alone: a missing doc, a flaky test, a refactor. One line. The operator files it as a ticket with one key, or ignores it. Do not do it yourself; stay inside the ticket.

- `done`: committed on `adddd/<KEY>`, ready for a human to review. No question line.
- `needs-human`: you are waiting on an answer. The question line is the whole card the operator sees.
- `blocked`: you cannot proceed at all (missing credentials, broken toolchain). Say what would unblock you.

Omitting the block forces the operator to read your whole message. Keep the summary under 200 characters.
