# opencode-v2-goal-plugin

> [!NOTE]
> This is a community plugin. It is not built by the OpenCode team and is not affiliated with OpenCode in any way.

Codex-style `/goal` for OpenCode 2. A persistent, per-session objective that keeps the agent working across turns until completion is audited against evidence.

## Install

Requires OpenCode 2.

```sh
opencode plugin add github:heliowap/opencode-v2-goal-plugin
```

This installs the plugin and adds it to your global `opencode.jsonc`. If `/goal` does not show up, run `opencode service restart`. Update with `opencode plugin update` and uninstall with `opencode plugin remove github:heliowap/opencode-v2-goal-plugin`.

## Compatibility

| Surface | Status |
|---|---|
| OpenCode 2.0.24 | Verified by 21 host canaries against a real `opencode serve`, graded on stored state. They run in CI on every push. |
| Status above the input (terminal UI) | Verified by 2 canaries that drive the real `opencode` terminal in tmux and read the screen |
| Live models | `devin/swe-2`, `gemini-3.8-flash`, and the free `nemotron-3.5-lightning-free` complete real goals, stop at budgets, and survive a restart |
| `/goal` typed in the terminal UI, desktop and web apps, Windows, other OpenCode versions | Not established |

Details, session evidence, and what is not proven: [`docs/compatibility.md`](docs/compatibility.md).

## Use

```text
/goal make the checkout suite pass without changing the public API
/goal --tokens 250K migrate the tests from Jest to Vitest
/goal                    show status and token usage
/goal edit <objective>   change the objective, keeping usage
/goal pause
/goal resume
/goal clear
```

In the terminal UI, a line above the input shows the goal of the open session:

| Goal | Line |
|---|---|
| Active, turn running | `◎ goal running · 12K / 50K` |
| Active, between turns | `◎ goal active · 12K / 50K` |
| Paused | `⏸ goal paused` |
| Blocked | `⚠ goal blocked` |
| Out of budget | `goal budget reached · 52K / 50K` |
| Complete, or no goal | nothing |

The agent can also create, read, and finish goals with the `goal_create`, `goal_get`, and `goal_update` tools. `goal_get` also returns the `/goal` syntax, so the agent can answer questions about the command.

## How it works

- State lives in the plugin's `ctx.storage` under `goal/<sessionID>` and survives restarts.
- When a turn ends with the goal `active`, the plugin sends a synthetic continuation message that starts the next turn. The message carries the full instructions: keep the scope intact, work from current evidence, check for progress, and audit completion requirement by requirement before calling `goal_update`.
- Three consecutive turns with no text and no tool use mark the goal `blocked`, so it cannot spin.
- The model may mark the goal `blocked` only after the same blocker repeats for three turns, and `paused` only at the user's request.
- Token usage is counted from each model step (input, output, and reasoning tokens). Crossing `--tokens` marks the goal `budget_limited` and steers the agent to wrap up.
- A user interrupt pauses the goal. A failed turn blocks it so retries cannot loop.
- Turns run by the `plan` agent neither count nor continue the goal.

All state rules live in the pure reducer `step` in `src/goal.ts`. `src/index.ts` only translates OpenCode events into `GoalEvent`s and runs the returned `GoalEffect`.

## Known limitation

Replies to `/goal`, `pause`, `resume`, `edit`, and `clear` are queued as synthetic messages. When the session is idle they show up at the start of the next turn, not immediately.

## Attribution

The prompts in `templates/` and the tool descriptions are adapted from the `/goal` extension in [OpenAI Codex](https://github.com/openai/codex/tree/main/codex-rs/ext/goal), licensed under Apache-2.0. They were modified to use OpenCode tool names. See `NOTICE`.

## Develop

Requires Bun. Clone the repository and load your checkout instead of the published package:

```sh
git clone https://github.com/heliowap/opencode-v2-goal-plugin.git
cd opencode-v2-goal-plugin
bun install
opencode plugin remove github:heliowap/opencode-v2-goal-plugin   # if installed, so only one goal plugin loads
rm -f ~/.config/opencode/plugins/goal.ts                          # older single-file link
ln -sfn "$PWD/src" ~/.config/opencode/plugins/goal
```

The directory link loads both entrypoints: `src/index.ts` on the server and `src/tui.tsx` in the terminal.

OpenCode reloads the plugin when you save files under `src/`.

```sh
bun test                      # unit tests, 100% line and function coverage enforced
bun run typecheck
bun run mutation              # mutation testing: every mutant of goal.ts, command.ts, prompts.ts, badge.ts must be killed
bun test ./host               # host canaries: needs `opencode` 2.0.24 on PATH
LIVE_MODEL="<provider>/<model>" bun test ./host/live/live.test.ts   # live models, uses your provider config
```
