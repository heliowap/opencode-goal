# opencode-v2-goal-plugin

> [!NOTE]
> This is a community plugin. It is not built by the OpenCode team and is not affiliated with OpenCode in any way.

Codex-style `/goal` for OpenCode 2. A persistent, per-session objective that keeps the agent working across turns until completion is audited against evidence.

## Install

Requires OpenCode 2 and Bun.

```sh
git clone https://github.com/heliowap/opencode-v2-goal-plugin.git
cd opencode-v2-goal-plugin
bun install
./install.sh
```

`install.sh` creates two links in `~/.config/opencode`: `plugins/goal.ts` points to `src/index.ts`, and `skills/goal` points to `skill/`. Restart the service with `opencode service restart` to load the plugin.

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

The agent can also create, read, and finish goals with the `goal_create`, `goal_get`, and `goal_update` tools.

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

```sh
bun test
bun run typecheck
```
