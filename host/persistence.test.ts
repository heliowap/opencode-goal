import { afterEach, describe, expect, test } from "bun:test"
import { afterToolResult, CONTINUATION, count } from "./harness/fixture.ts"
import { Host } from "./harness/host.ts"

const TIMEOUT = 180_000
const complete = { tool: "goal_update", args: { status: "complete", note: "done" } } as const
let host: Host | undefined

afterEach(async () => {
  await host?.stop()
  host = undefined
})

describe("persistence", () => {
  test(
    "A12a a paused goal survives a server restart unchanged",
    async () => {
      host = await Host.start({ script: () => ({ text: "Step.", delayMs: 2_000 }) })
      const session = await host.session()
      await host.goal(session, "--tokens 1M outlive a restart")
      await host.until(() => host!.fixture.agentRequests().length === 1)
      await host.goal(session, "pause")
      await host.settle(session)
      const before = host.stored(session)

      await host.restart()
      expect(host.stored(session)).toEqual(before!)
      expect(before).toMatchObject({ status: "paused", tokenBudget: 1_000_000 })
    },
    TIMEOUT,
  )

  test(
    "A12b an active goal whose server died mid-turn comes back paused, and resume continues it",
    async () => {
      host = await Host.start({
        script: (request) => {
          if (afterToolResult(request)) return { text: "Closing." }
          return count(request, CONTINUATION) >= 2 ? complete : { text: "Long step.", delayMs: 20_000 }
        },
      })
      const session = await host.session()
      await host.goal(session, "outlive a crash")
      await host.until(() => host!.fixture.agentRequests().length === 1)
      await host.restart()
      await host.until(() => host!.stored(session)?.status !== "active")

      expect(host.stored(session)).toMatchObject({
        status: "paused",
        note: "Recovered after a restart. Run /goal resume to continue.",
      })
      await host.goal(session, "resume")
      await host.settle(session)
      expect(host.stored(session)).toMatchObject({ status: "complete" })
    },
    TIMEOUT,
  )

  test(
    "A12c reloading the location keeps a running goal active and continuing",
    async () => {
      host = await Host.start({
        script: (request) => {
          if (afterToolResult(request)) return { text: "Closing." }
          return count(request, CONTINUATION) >= 2 ? complete : { text: "Step during reload.", delayMs: 3_000 }
        },
      })
      const session = await host.session()
      await host.goal(session, "outlive a reload")
      await host.until(() => host!.fixture.agentRequests().length === 1)
      await host.json("POST", "/api/location/reload")
      await host.settle(session)

      expect(host.stored(session)).toMatchObject({ status: "complete" })
    },
    TIMEOUT,
  )

  test(
    "A13 deleting a session removes its goal",
    async () => {
      host = await Host.start({ script: () => ({ text: "Step.", delayMs: 1_000 }) })
      const session = await host.session()
      await host.goal(session, "short lived")
      await host.until(() => host!.stored(session) !== undefined)
      await host.goal(session, "pause")
      await host.settle(session)
      await host.remove(session)
      await host.until(() => host!.stored(session) === undefined)
      expect(host.stored(session)).toBeUndefined()
    },
    TIMEOUT,
  )
})
