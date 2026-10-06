---
name: Goal
description: Persistent, audited objective that keeps the session working across turns until a verifiable end state. Use when the user asks to keep working until a condition holds, or to run without stopping until done.
---

# Goal

A goal is a completion contract: the end state, the evidence that proves it, and what must not regress. The `goal` plugin stores it per session and starts a new turn after each one ends, until the goal leaves `active`. Each continuation turn carries the full instructions, including the completion and blocked audits.

## Create

Create a goal only when the user explicitly asks for continued work toward a condition. Before calling `goal_create`, rewrite the request as an auditable objective:

- **End state.** What must be true at the end.
- **Evidence.** The command, test, file, or measurement that shows it.
- **Constraints.** What must not regress along the way.

If the evidence does not fit in one sentence, ask the user before creating the goal. Set `token_budget` only when the user asks for a budget.

The user controls goals with `/goal`:

```text
/goal [--tokens N] <objective>   set or replace the goal (N accepts 50000, 250K, 1.5M)
/goal                            show status and usage
/goal edit <objective>           change the objective, keeping usage
/goal pause | resume | clear
```

## Finish

Call `goal_update` with `status: "complete"` only after the completion audit passes, with the requirement-by-requirement evidence in `note`. Use `status: "blocked"` only after the same blocker has repeated for three consecutive goal turns, and say which user input or external change it needs. Use `status: "paused"` only when the user asks to pause.

A token budget that runs out ends the goal as `budget_limited`. Wrap up with progress, blockers, and the next useful step. That is a stop, not a completion.
