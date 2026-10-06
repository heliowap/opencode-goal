import { describe, expect, test } from "bun:test"
import { decodeGoal, isUnfinished, step, type Goal } from "../src/goal.ts"

const T0 = 1_000
const T1 = 2_000

const active = (patch: Partial<Goal> = {}): Goal => ({
  objective: "make the suite pass",
  status: "active",
  tokenBudget: null,
  tokensUsed: 0,
  emptyTurns: 0,
  directory: "/repo",
  createdAt: T0,
  updatedAt: T0,
  ...patch,
})

const turn = (activity: boolean, planning = false) => ({ _tag: "TurnEnded", activity, planning }) as const

describe("set and edit", () => {
  test("Set creates an active goal and starts it", () => {
    expect(step(undefined, { _tag: "Set", objective: "ship it", tokenBudget: 50_000, directory: "/repo" }, T0)).toEqual({
      goal: active({ objective: "ship it", tokenBudget: 50_000 }),
      effect: { _tag: "Continue" },
    })
  })

  test("Set replaces an existing goal and resets usage", () => {
    const next = step(active({ status: "paused", tokensUsed: 900 }), { _tag: "Set", objective: "new", tokenBudget: null, directory: "/repo" }, T1)
    expect(next.goal).toEqual(active({ objective: "new", createdAt: T1, updatedAt: T1 }))
  })

  test("Edit keeps usage and steers the active turn", () => {
    expect(step(active({ tokensUsed: 900, emptyTurns: 2 }), { _tag: "Edit", objective: "narrower" }, T1)).toEqual({
      goal: active({ objective: "narrower", tokensUsed: 900, updatedAt: T1 }),
      effect: { _tag: "ObjectiveUpdated" },
    })
  })

  test("Edit on a complete goal refuses like resume does (#1)", () => {
    const done = active({ status: "complete", note: "all green" })
    expect(step(done, { _tag: "Edit", objective: "x" }, T1)).toEqual({
      goal: done,
      effect: { _tag: "Notify", text: "The goal is complete. Set a new goal instead." },
    })
  })

  test("Edit on a goal that used its budget refuses like resume does (#1)", () => {
    const limited = active({ status: "budget_limited", tokenBudget: 1_000, tokensUsed: 1_200 })
    expect(step(limited, { _tag: "Edit", objective: "x" }, T1)).toEqual({
      goal: limited,
      effect: { _tag: "Notify", text: "The goal has used its token budget. Set a new goal with a larger --tokens budget." },
    })
  })

  test("Edit on a blocked goal keeps it blocked and points to resume", () => {
    expect(step(active({ status: "blocked" }), { _tag: "Edit", objective: "x" }, T1)).toEqual({
      goal: active({ status: "blocked", objective: "x", updatedAt: T1 }),
      effect: { _tag: "Notify", text: "Objective updated. The goal is blocked; run /goal resume to continue." },
    })
  })

  test("Edit on a paused goal keeps it paused", () => {
    expect(step(active({ status: "paused" }), { _tag: "Edit", objective: "x" }, T1)).toEqual({
      goal: active({ status: "paused", objective: "x", updatedAt: T1 }),
      effect: { _tag: "Notify", text: "Objective updated. The goal is paused; run /goal resume to continue." },
    })
  })
})

describe("continuation", () => {
  test("a turn with activity continues and resets the empty streak", () => {
    expect(step(active({ emptyTurns: 2 }), turn(true), T1)).toEqual({
      goal: active({ updatedAt: T1 }),
      effect: { _tag: "Continue" },
    })
  })

  test("an empty turn still continues while under the limit", () => {
    expect(step(active({ emptyTurns: 1 }), turn(false), T1)).toEqual({
      goal: active({ emptyTurns: 2, updatedAt: T1 }),
      effect: { _tag: "Continue" },
    })
  })

  test("the third empty turn in a row blocks the goal", () => {
    expect(step(active({ emptyTurns: 2 }), turn(false), T1)).toEqual({
      goal: active({ emptyTurns: 3, status: "blocked", note: "3 consecutive turns produced no output.", updatedAt: T1 }),
      effect: { _tag: "None" },
    })
  })

  test("planning turns neither continue nor count", () => {
    expect(step(active(), turn(true, true), T1)).toEqual({ goal: active(), effect: { _tag: "None" } })
  })

  test("turns after the goal settles change nothing", () => {
    const done = active({ status: "complete", note: "all green" })
    expect(step(done, turn(true), T1)).toEqual({ goal: done, effect: { _tag: "None" } })
  })
})

describe("token budget", () => {
  test("usage accumulates", () => {
    expect(step(active({ tokensUsed: 100 }), { _tag: "Usage", tokens: 250, closing: false }, T1).goal).toEqual(
      active({ tokensUsed: 350, updatedAt: T1 }),
    )
  })

  test("crossing the budget limits the goal and asks for a wrap-up", () => {
    expect(step(active({ tokenBudget: 1_000, tokensUsed: 900 }), { _tag: "Usage", tokens: 200, closing: false }, T1)).toEqual({
      goal: active({ tokenBudget: 1_000, tokensUsed: 1_100, status: "budget_limited", note: "Token budget reached.", updatedAt: T1 }),
      effect: { _tag: "WrapUp" },
    })
  })

  test("the wrap-up turn keeps counting without another wrap-up", () => {
    const limited = active({ tokenBudget: 1_000, tokensUsed: 1_100, status: "budget_limited" })
    expect(step(limited, { _tag: "Usage", tokens: 50, closing: false }, T1)).toEqual({
      goal: { ...limited, tokensUsed: 1_150, updatedAt: T1 },
      effect: { _tag: "None" },
    })
  })

  test("a budget-limited goal does not continue", () => {
    const limited = active({ status: "budget_limited" })
    expect(step(limited, turn(true), T1).effect).toEqual({ _tag: "None" })
  })

  test("resume refuses a goal that used its budget", () => {
    const limited = active({ status: "budget_limited", tokenBudget: 1_000, tokensUsed: 1_000 })
    expect(step(limited, { _tag: "Resume" }, T1)).toEqual({
      goal: limited,
      effect: { _tag: "Notify", text: "The goal has used its token budget. Set a new goal with a larger --tokens budget." },
    })
  })
})

describe("usage of the step that ends the goal (#2)", () => {
  test.each([["complete"], ["blocked"], ["paused"]] as const)("is charged to a goal the model just marked %s", (status) => {
    expect(step(active({ status, tokensUsed: 500 }), { _tag: "Usage", tokens: 4_000, closing: true }, T1)).toEqual({
      goal: active({ status, tokensUsed: 4_500, updatedAt: T1 }),
      effect: { _tag: "None" },
    })
  })

  test("later steps on an ended goal are not charged", () => {
    const done = active({ status: "complete", tokensUsed: 4_500 })
    expect(step(done, { _tag: "Usage", tokens: 4_000, closing: false }, T1)).toEqual({ goal: done, effect: { _tag: "None" } })
  })
})

describe("model updates", () => {
  test("complete records the evidence", () => {
    expect(step(active(), { _tag: "Complete", note: "bun test: 12 pass" }, T1).goal).toEqual(
      active({ status: "complete", note: "bun test: 12 pass", updatedAt: T1 }),
    )
  })

  test("a budget-limited goal can still be completed", () => {
    expect(step(active({ status: "budget_limited" }), { _tag: "Complete", note: "done" }, T1).goal?.status).toBe("complete")
  })

  test("block records the missing decision", () => {
    expect(step(active(), { _tag: "Block", note: "needs prod credentials" }, T1).goal).toEqual(
      active({ status: "blocked", note: "needs prod credentials", updatedAt: T1 }),
    )
  })

  test("a requested pause from the model pauses quietly", () => {
    expect(step(active(), { _tag: "PauseRequested", note: undefined }, T1)).toEqual({
      goal: active({ status: "paused", note: "Paused at the user's request.", updatedAt: T1 }),
      effect: { _tag: "None" },
    })
  })

  test("budget limits take precedence over a requested pause", () => {
    const limited = active({ status: "budget_limited" })
    expect(step(limited, { _tag: "PauseRequested", note: undefined }, T1).goal).toEqual(limited)
  })
})

describe("interruptions and failures", () => {
  test("a user interrupt pauses the goal", () => {
    expect(step(active(), { _tag: "Interrupted", reason: "user" }, T1).goal).toEqual(
      active({ status: "paused", note: "Interrupted by the user.", updatedAt: T1 }),
    )
  })

  test("a superseded turn keeps the goal active", () => {
    expect(step(active(), { _tag: "Interrupted", reason: "superseded" }, T1).goal).toEqual(active())
  })

  test("a failed turn blocks the goal so it cannot loop", () => {
    expect(step(active(), { _tag: "Failed", message: "rate limited" }, T1).goal).toEqual(
      active({ status: "blocked", note: "Turn failed: rate limited", updatedAt: T1 }),
    )
  })
})

describe("user controls", () => {
  test("pause then resume continues with a fresh empty streak", () => {
    const paused = step(active({ emptyTurns: 2 }), { _tag: "Pause" }, T1)
    expect(paused).toEqual({
      goal: active({ emptyTurns: 2, status: "paused", note: "Paused by the user.", updatedAt: T1 }),
      effect: { _tag: "Notify", text: "Goal paused." },
    })
    expect(step(paused.goal, { _tag: "Resume" }, T1 + 1)).toEqual({
      goal: active({ updatedAt: T1 + 1 }),
      effect: { _tag: "Continue" },
    })
  })

  test("resume restarts a blocked goal", () => {
    expect(step(active({ status: "blocked", note: "x" }), { _tag: "Resume" }, T1)).toEqual({
      goal: active({ updatedAt: T1 }),
      effect: { _tag: "Continue" },
    })
  })

  test("resume refuses a complete goal", () => {
    expect(step(active({ status: "complete" }), { _tag: "Resume" }, T1).effect).toEqual({
      _tag: "Notify",
      text: "The goal is complete. Set a new goal instead.",
    })
  })

  test("clear removes the goal", () => {
    expect(step(active(), { _tag: "Clear" }, T1)).toEqual({ goal: undefined, effect: { _tag: "Notify", text: "Goal cleared." } })
  })

  test("controls without a goal explain there is none", () => {
    expect(step(undefined, { _tag: "Pause" }, T1)).toEqual({
      goal: undefined,
      effect: { _tag: "Notify", text: "No goal is set for this session." },
    })
  })
})

describe("decodeGoal", () => {
  test("accepts a stored goal", () => {
    expect(decodeGoal(active())).toEqual(active())
  })

  test("rejects malformed or old-format storage", () => {
    expect(decodeGoal({ objective: "x", status: "active", turnBudget: 5, turnsUsed: 1 })).toBeUndefined()
  })
})

describe("rejected transitions leave the goal unchanged", () => {
  const paused = active({ status: "paused", note: "Paused by the user." })
  const blocked = active({ status: "blocked", note: "x" })

  test.each([
    ["Complete on a paused goal", paused, { _tag: "Complete", note: "done" }],
    ["Block on a paused goal", paused, { _tag: "Block", note: "stuck" }],
    ["Block on a budget-limited goal", active({ status: "budget_limited" }), { _tag: "Block", note: "stuck" }],
    ["PauseRequested on a blocked goal", blocked, { _tag: "PauseRequested", note: undefined }],
    ["Usage on a paused goal", paused, { _tag: "Usage", tokens: 50, closing: false }],
    ["Usage on a complete goal", active({ status: "complete" }), { _tag: "Usage", tokens: 50, closing: false }],
    ["a user interrupt on a blocked goal", blocked, { _tag: "Interrupted", reason: "user" }],
    ["a shutdown interrupt on an active goal", active(), { _tag: "Interrupted", reason: "shutdown" }],
    ["an inactivity interrupt on an active goal", active(), { _tag: "Interrupted", reason: "inactivity" }],
    ["Failed on a paused goal", paused, { _tag: "Failed", message: "boom" }],
    ["TurnEnded on a paused goal", paused, { _tag: "TurnEnded", activity: false, planning: false }],
  ] as const)("%s", (_name, goal, event) => {
    expect(step(goal, event, T1)).toEqual({ goal, effect: { _tag: "None" } })
  })
})

describe("user controls on goals that cannot take them", () => {
  test("pause on a paused goal explains why", () => {
    const paused = active({ status: "paused" })
    expect(step(paused, { _tag: "Pause" }, T1)).toEqual({
      goal: paused,
      effect: { _tag: "Notify", text: "The goal is paused; nothing to pause." },
    })
  })

  test("resume on an active goal explains it is already active", () => {
    expect(step(active(), { _tag: "Resume" }, T1)).toEqual({
      goal: active(),
      effect: { _tag: "Notify", text: "The goal is already active." },
    })
  })

  test("resume keeps usage when the budget still has room", () => {
    expect(step(active({ status: "paused", tokenBudget: 1_000, tokensUsed: 500 }), { _tag: "Resume" }, T1)).toEqual({
      goal: active({ tokenBudget: 1_000, tokensUsed: 500, updatedAt: T1 }),
      effect: { _tag: "Continue" },
    })
  })

  test.each([["Resume"], ["Clear"]] as const)("%s without a goal explains there is none", (tag) => {
    expect(step(undefined, { _tag: tag }, T1)).toEqual({
      goal: undefined,
      effect: { _tag: "Notify", text: "No goal is set for this session." },
    })
  })

  test("edit without a goal explains there is none", () => {
    expect(step(undefined, { _tag: "Edit", objective: "x" }, T1)).toEqual({
      goal: undefined,
      effect: { _tag: "Notify", text: "No goal is set for this session." },
    })
  })

  test("events from the session are ignored without a goal", () => {
    expect(step(undefined, { _tag: "Usage", tokens: 10, closing: false }, T1)).toEqual({ goal: undefined, effect: { _tag: "None" } })
    expect(step(undefined, { _tag: "TurnEnded", activity: true, planning: false }, T1)).toEqual({
      goal: undefined,
      effect: { _tag: "None" },
    })
  })
})

describe("model notes and budgets", () => {
  test("a requested pause keeps the model's note", () => {
    expect(step(active(), { _tag: "PauseRequested", note: "user said stop" }, T1).goal).toEqual(
      active({ status: "paused", note: "user said stop", updatedAt: T1 }),
    )
  })

  test("usage under the budget accumulates without a wrap-up", () => {
    expect(step(active({ tokenBudget: 1_000, tokensUsed: 100 }), { _tag: "Usage", tokens: 200, closing: false }, T1)).toEqual({
      goal: active({ tokenBudget: 1_000, tokensUsed: 300, updatedAt: T1 }),
      effect: { _tag: "None" },
    })
  })

  test("usage landing exactly on the budget limits the goal", () => {
    expect(step(active({ tokenBudget: 1_000, tokensUsed: 800 }), { _tag: "Usage", tokens: 200, closing: false }, T1).goal?.status).toBe(
      "budget_limited",
    )
  })
})

describe("isUnfinished", () => {
  test.each([
    ["no goal", undefined, false],
    ["complete", active({ status: "complete" }), false],
    ["active", active(), true],
    ["paused", active({ status: "paused" }), true],
    ["blocked", active({ status: "blocked" }), true],
    ["budget_limited", active({ status: "budget_limited" }), true],
  ] as const)("%s -> %p", (_name, goal, expected) => {
    expect(isUnfinished(goal)).toBe(expected)
  })
})
