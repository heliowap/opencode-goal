/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { createResource, onCleanup, Show } from "solid-js"
import { goalBadge, type Tone } from "./badge.ts"
import { decodeGoal } from "./goal.ts"
import { GoalRpc } from "./rpc.ts"

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
    const goal = context.client.rpc(GoalRpc)

    context.ui.slot({
      append: "session.composer.top",
      render: (slot) => {
        const [stored, { mutate }] = createResource(
          () => slot.sessionID,
          async (sessionID) => decodeGoal(((await goal.get({ sessionID })) as { goal: unknown }).goal),
        )
        onCleanup(
          goal.events.on("changed", (event) => {
            const data = event.data as { sessionID: string; goal: unknown }
            if (data.sessionID === slot.sessionID) mutate(decodeGoal(data.goal))
          }),
        )
        const badge = () => goalBadge(stored(), context.data.session.status(slot.sessionID) === "running")
        return (
          <Show when={badge()}>
            <box flexShrink={0} paddingLeft={1}>
              <text fg={color(context, badge()!.tone)}>{badge()!.text}</text>
            </box>
          </Show>
        )
      },
    })
  },
})
