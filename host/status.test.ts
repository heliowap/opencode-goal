import { afterEach, describe, expect, test } from "bun:test"
import { Host } from "./harness/host.ts"

const TIMEOUT = 120_000
let host: Host | undefined

afterEach(async () => {
  await host?.stop()
  host = undefined
})

describe("status for the terminal", () => {
  test(
    "A15 goal.get returns the stored goal, and goal.changed fires on every transition",
    async () => {
      host = await Host.start({ script: () => ({ text: "Step.", delayMs: 2_000 }) })
      const session = await host.session()
      const events = host.events((type) => type === "rpc.goal.changed")
      await Bun.sleep(500)
      expect(await host.rpc("get", { sessionID: session.id })).toEqual({ goal: null })

      await host.goal(session, "--tokens 50K show me")
      await host.until(() => host!.fixture.agentRequests().length === 1)
      await host.goal(session, "pause")
      await host.settle(session)

      const stored = host.stored(session)!
      expect(stored).toMatchObject({ status: "paused", tokenBudget: 50_000 })
      expect(await host.rpc("get", { sessionID: session.id })).toEqual({ goal: stored })
      await host.until(() => events.seen.some((event) => (event.data as { goal: { status: string } | null }).goal?.status === "paused"))
      events.stop()
      const statuses = events.seen.map((event) => {
        const data = event.data as { sessionID: string; goal: { status: string } | null }
        return [data.sessionID, data.goal?.status]
      })
      expect(statuses[0]).toEqual([session.id, "active"])
      expect(statuses.at(-1)).toEqual([session.id, "paused"])

      await host.goal(session, "clear")
      await host.until(async () => ((await host!.rpc("get", { sessionID: session.id })) as { goal: unknown }).goal === null)
    },
    TIMEOUT,
  )
})
