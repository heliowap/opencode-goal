import { afterEach, describe, expect, test } from "bun:test"
import { afterToolResult, BUDGET_LIMIT, CONTINUATION, count, mentions } from "./harness/fixture.ts"
import { Host } from "./harness/host.ts"

const TIMEOUT = 120_000
const STEP = { input: 3_000, output: 1_000 }
let host: Host | undefined

afterEach(async () => {
  await host?.stop()
  host = undefined
})

describe("token budget", () => {
  test(
    "A5 crossing the budget limits the goal, steers one wrap-up turn, and counts every step",
    async () => {
      host = await Host.start({
        script: (request) =>
          mentions(request, BUDGET_LIMIT) ? { text: "Wrap-up summary.", usage: STEP } : { text: `Progress ${count(request, CONTINUATION)}.`, usage: STEP },
      })
      const session = await host.session()
      await host.goal(session, "--tokens 10K keep going")
      await host.settle(session)

      expect(host.stored(session)).toMatchObject({
        status: "budget_limited",
        tokenBudget: 10_000,
        tokensUsed: 16_000,
        note: "Token budget reached.",
      })
      const requests = host.fixture.agentRequests()
      expect(requests).toHaveLength(4)
      expect(requests.filter((request) => mentions(request, BUDGET_LIMIT))).toHaveLength(1)
      expect(count(requests.at(-1)!, CONTINUATION)).toBe(3)
    },
    TIMEOUT,
  )

  test(
    "A5b the step that completes the goal is counted in its final usage",
    async () => {
      host = await Host.start({
        script: (request) =>
          afterToolResult(request)
            ? { text: "Done.", usage: STEP }
            : { tool: "goal_update", args: { status: "complete", note: "verified" }, usage: STEP },
      })
      const session = await host.session()
      await host.goal(session, "--tokens 50K finish at once")
      await host.settle(session)

      expect(host.stored(session)).toMatchObject({ status: "complete", tokensUsed: 4_000 })
    },
    TIMEOUT,
  )
})
