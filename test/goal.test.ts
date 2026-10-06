import { describe, expect, test } from "bun:test"
import { decodeGoal, step, type Goal } from "../src/goal.ts"

const T0 = 1_000
const T1 = 2_000

const active = (patch: Partial<Goal> = {}): Goal => ({
  objective: "make the suite pass",
  status: "active",
  turnBudget: null,
  turnsUsed: 0,
  directory: "/repo",
  createdAt: T0,
  updatedAt: T0,
  ...patch,
})

describe("step", () => {
  test("Set creates an active goal and starts it", () => {
    expect(step(undefined, { _tag: "Set", objective: "ship it", turnBudget: 5, directory: "/repo" }, T0)).toEqual({
      goal: {
        objective: "ship it",
        status: "active",
        turnBudget: 5,
        turnsUsed: 0,
        directory: "/repo",
        createdAt: T0,
        updatedAt: T0,
      },
      effect: { _tag: "Start" },
    })
  })

  test("Set replaces an existing goal", () => {
    const next = step(active({ status: "paused", turnsUsed: 7 }), { _tag: "Set", objective: "new", turnBudget: null, directory: "/repo" }, T1)
    expect(next.goal).toEqual(active({ objective: "new", createdAt: T1, updatedAt: T1 }))
  })

  test("a turn with tool calls counts and continues", () => {
    expect(step(active(), { _tag: "TurnEnded", toolCalls: 3 }, T1)).toEqual({
      goal: active({ turnsUsed: 1, updatedAt: T1 }),
      effect: { _tag: "Continue" },
    })
  })

  test("a turn without tool calls counts but stops auto-continuation", () => {
    expect(step(active(), { _tag: "TurnEnded", toolCalls: 0 }, T1)).toEqual({
      goal: active({ turnsUsed: 1, updatedAt: T1 }),
      effect: { _tag: "None" },
    })
  })

  test("the last budgeted turn limits the goal and asks for a wrap-up", () => {
    expect(step(active({ turnBudget: 2, turnsUsed: 1 }), { _tag: "TurnEnded", toolCalls: 4 }, T1)).toEqual({
      goal: active({ turnBudget: 2, turnsUsed: 2, status: "budget_limited", note: "Orçamento de turnos esgotado.", updatedAt: T1 }),
      effect: { _tag: "WrapUp" },
    })
  })

  test("turns after the goal settles change nothing", () => {
    const done = active({ status: "complete", note: "all green" })
    expect(step(done, { _tag: "TurnEnded", toolCalls: 2 }, T1)).toEqual({ goal: done, effect: { _tag: "None" } })
  })

  test("complete records the evidence", () => {
    expect(step(active(), { _tag: "Complete", evidence: "bun test: 12 pass" }, T1).goal).toEqual(
      active({ status: "complete", note: "bun test: 12 pass", updatedAt: T1 }),
    )
  })

  test("block records the missing decision", () => {
    expect(step(active(), { _tag: "Block", reason: "needs prod credentials" }, T1).goal).toEqual(
      active({ status: "blocked", note: "needs prod credentials", updatedAt: T1 }),
    )
  })

  test("a user interrupt pauses the goal", () => {
    expect(step(active(), { _tag: "Interrupted", reason: "user" }, T1).goal).toEqual(
      active({ status: "paused", note: "Interrompido pelo usuário.", updatedAt: T1 }),
    )
  })

  test("a superseded turn keeps the goal active", () => {
    expect(step(active(), { _tag: "Interrupted", reason: "superseded" }, T1).goal).toEqual(active())
  })

  test("a failed turn pauses the goal with the error", () => {
    expect(step(active(), { _tag: "Failed", message: "rate limited" }, T1).goal).toEqual(
      active({ status: "paused", note: "Turno falhou: rate limited", updatedAt: T1 }),
    )
  })

  test("pause then resume continues the goal", () => {
    const paused = step(active(), { _tag: "Pause" }, T1)
    expect(paused).toEqual({
      goal: active({ status: "paused", note: "Pausado pelo usuário.", updatedAt: T1 }),
      effect: { _tag: "Notify", text: "Goal pausado." },
    })
    expect(step(paused.goal, { _tag: "Resume" }, T1 + 1)).toEqual({
      goal: active({ updatedAt: T1 + 1 }),
      effect: { _tag: "Continue" },
    })
  })

  test("resume refuses a goal with no turns left", () => {
    const limited = active({ status: "budget_limited", turnBudget: 3, turnsUsed: 3 })
    expect(step(limited, { _tag: "Resume" }, T1)).toEqual({
      goal: limited,
      effect: { _tag: "Notify", text: "Goal sem turnos restantes. Defina um novo goal com --turns maior." },
    })
  })

  test("resume refuses a settled goal", () => {
    const done = active({ status: "complete" })
    expect(step(done, { _tag: "Resume" }, T1).effect).toEqual({
      _tag: "Notify",
      text: "Goal está complete. Defina um novo goal.",
    })
  })

  test("clear removes the goal", () => {
    expect(step(active(), { _tag: "Clear" }, T1)).toEqual({
      goal: undefined,
      effect: { _tag: "Notify", text: "Goal removido." },
    })
  })

  test("controls without a goal explain there is none", () => {
    expect(step(undefined, { _tag: "Pause" }, T1)).toEqual({
      goal: undefined,
      effect: { _tag: "Notify", text: "Nenhum goal nesta sessão." },
    })
  })
})

describe("decodeGoal", () => {
  test("accepts a stored goal", () => {
    expect(decodeGoal(active())).toEqual(active())
  })

  test("rejects malformed storage", () => {
    expect(decodeGoal({ objective: "x", status: "running" })).toBeUndefined()
  })
})
