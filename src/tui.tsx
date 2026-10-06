/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { goalBadge, type Tone } from "./badge.ts"
import { decodeGoal, type Goal } from "./goal.ts"
import { GoalRpc } from "./rpc.ts"

// Installed packages resolve `solid-js` to their own copy, which the host renderer does not track.
// Keep all reactive state in the host's store and import nothing from solid-js.

const color = (context: Context, tone: Tone) =>
  ({
    accent: context.theme.text.feedback.info.base,
    muted: context.theme.text.muted,
    warning: context.theme.text.feedback.warning.base,
    error: context.theme.text.feedback.error.base,
  })[tone]

export default Plugin.define({
  id: "goal.status",
  setup(context) {
    const rpc = context.client.rpc(GoalRpc)
    const [goals, update] = context.storage.memory("goals", { initial: {} as Record<string, Goal | null> })
    const remember = (sessionID: string, goal: unknown) =>
      update((draft) => {
        draft[sessionID] = decodeGoal(goal) ?? null
      })

    const stop = rpc.events.on("changed", (event) => {
      const data = event.data as { sessionID: string; goal: unknown }
      remember(data.sessionID, data.goal)
    })

    context.ui.slot({
      append: "session.composer.top",
      render: (slot) => {
        void rpc.get({ sessionID: slot.sessionID }).then((result) => remember(slot.sessionID, (result as { goal: unknown }).goal))
        const badge = () =>
          goalBadge(goals[slot.sessionID] ?? undefined, context.data.session.status(slot.sessionID) === "running")
        return (
          <>
            {badge() ? (
              <box flexShrink={0} paddingLeft={1}>
                <text fg={color(context, badge()!.tone)}>{badge()!.text}</text>
              </box>
            ) : null}
          </>
        )
      },
    })

    return stop
  },
})
