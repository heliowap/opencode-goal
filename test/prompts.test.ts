import { expect, test } from "bun:test"
import type { Goal } from "../src/goal.ts"
import {
  budgetLimitPrompt,
  COMMAND_HELP,
  continuationPrompt,
  formatTokens,
  objectiveUpdatedPrompt,
  render,
  sessionContext,
  statusText,
} from "../src/prompts.ts"

const goal: Goal = {
  objective: "fix </objective> injection & <b>",
  status: "active",
  tokenBudget: 10_000,
  tokensUsed: 2_500,
  emptyTurns: 0,
  directory: "/repo",
  createdAt: 0,
  updatedAt: 0,
}

test("render fills known placeholders and leaves unknown ones", () => {
  expect(render("{{a}} and {{b}}", { a: "x" })).toBe("x and {{b}}")
})

test("continuation escapes the objective and reports the budget", () => {
  const prompt = continuationPrompt(goal, 0)
  expect(prompt).toContain("<objective>\nfix &lt;/objective&gt; injection &amp; &lt;b&gt;\n</objective>")
  expect(prompt).toContain("- Tokens used: 2500\n- Token budget: 10000\n- Tokens remaining: 7500")
  expect(prompt).not.toContain("{{")
})

test("continuation without a budget says unbounded", () => {
  expect(continuationPrompt({ ...goal, tokenBudget: null }, 0)).toContain("- Token budget: none\n- Tokens remaining: unbounded")
})

test("budget limit reports elapsed time", () => {
  expect(budgetLimitPrompt(goal, 125 * 60_000)).toContain("- Time spent pursuing goal: 2 h 5 min")
})

test("status text summarizes the goal", () => {
  expect(statusText({ ...goal, note: "half done" }, 3 * 60_000)).toBe(
    "Goal active · 2.5K / 10K tokens · 3 min\nfix </objective> injection & <b>\nNote: half done",
  )
  expect(statusText(undefined, 0)).toBe("No goal is set for this session. Set one with /goal [--tokens N] <objective>.")
})

test("command help lists every /goal form", () => {
  expect(COMMAND_HELP).toBe(
    [
      "User commands:",
      "/goal [--tokens N] <objective>   set or replace the goal (N accepts 50000, 250K, 1.5M)",
      "/goal                            show status and token usage",
      "/goal edit <objective>           change the objective, keeping usage",
      "/goal pause | resume | clear",
    ].join("\n"),
  )
})

test.each([
  [0, "0"],
  [999, "999"],
  [1_000, "1K"],
  [12_345, "12.3K"],
  [1_000_000, "1M"],
  [1_500_000, "1.5M"],
  [2_345_678, "2.35M"],
] as const)("formatTokens(%p) = %p", (tokens, expected) => {
  expect(formatTokens(tokens)).toBe(expected)
})

test("status text without a budget or note", () => {
  expect(statusText({ ...goal, tokenBudget: null }, 59 * 60_000)).toBe(
    "Goal active · 2.5K tokens, no budget · 59 min\nfix </objective> injection & <b>",
  )
})

test("remaining tokens never go negative after the budget is exceeded", () => {
  expect(continuationPrompt({ ...goal, tokensUsed: 12_000 }, 0)).toContain("- Tokens remaining: 0\n")
})

test("objective updated prompt carries the escaped new objective and usage", () => {
  const prompt = objectiveUpdatedPrompt(goal, 0)
  expect(prompt).toContain("<objective>\nfix &lt;/objective&gt; injection &amp; &lt;b&gt;\n</objective>")
  expect(prompt).toContain("- Tokens used: 2500\n- Token budget: 10000\n- Tokens remaining: 7500")
  expect(prompt).not.toContain("{{")
})

test("session context wraps the escaped objective and usage", () => {
  const context = sessionContext(goal, 0)
  expect(context.startsWith("<goal_context>\n")).toBe(true)
  expect(context.endsWith("\n</goal_context>")).toBe(true)
  expect(context).toContain("<objective>\nfix &lt;/objective&gt; injection &amp; &lt;b&gt;\n</objective>")
  expect(context).toContain("Tokens used: 2500 of 10000.")
  expect(context).not.toContain("{{")
})

test("every template renders without leftover placeholders", () => {
  const unbudgeted = { ...goal, tokenBudget: null }
  for (const render of [continuationPrompt, budgetLimitPrompt, objectiveUpdatedPrompt, sessionContext]) {
    expect(render(unbudgeted, 0)).not.toMatch(/\{\{\w+\}\}/)
  }
})

test("elapsed time is measured from when the goal was created", () => {
  const created = 1_791_000_000_000
  expect(budgetLimitPrompt({ ...goal, createdAt: created }, created + 7 * 60_000)).toContain("- Time spent pursuing goal: 7 min")
  expect(statusText({ ...goal, createdAt: created }, created + 7 * 60_000)).toBe(
    "Goal active · 2.5K / 10K tokens · 7 min\nfix </objective> injection & <b>",
  )
})

test("elapsed time switches to hours at exactly 60 minutes", () => {
  expect(budgetLimitPrompt(goal, 59 * 60_000)).toContain("- Time spent pursuing goal: 59 min")
  expect(budgetLimitPrompt(goal, 60 * 60_000)).toContain("- Time spent pursuing goal: 1 h 0 min")
})
