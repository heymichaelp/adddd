# The ADDDD status block

Every worker's final message ends with this block, plain text, no fence required:

```
ADDDD: done | needs-human | blocked
summary: one or two lines on what you did and where it stands
question: the one thing you need answered (needs-human and blocked only)
```

- `done`: committed on `adddd/<KEY>`, ready for a human to review. No question line.
- `needs-human`: you are waiting on an answer. The question line is the whole card the operator sees.
- `blocked`: you cannot proceed at all (missing credentials, broken toolchain). Say what would unblock you.

Omitting the block forces the operator to read your whole message. Keep the summary under 200 characters.
