import { afterEach, describe, expect, test } from "bun:test"
import { Host } from "./harness/host.ts"

const TIMEOUT = 120_000
let host: Host | undefined

afterEach(async () => {
  await host?.stop()
  host = undefined
})

describe("failures", () => {
  test(
    "A8 a turn the provider rejects blocks the goal instead of looping",
    async () => {
      host = await Host.start({ script: () => ({ status: 400, error: "fixture rejects every request" }) })
      const session = await host.session()
      await host.goal(session, "cannot run")
      await host.settle(session)

      const stored = host.stored(session)!
      expect(stored.status).toBe("blocked")
      expect(stored.note).toStartWith("Turn failed: ")
      expect(stored.note).toContain("fixture rejects every request")
      expect(host.fixture.agentRequests()).toHaveLength(1)
    },
    TIMEOUT,
  )
})
