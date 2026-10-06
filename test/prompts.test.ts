import { expect, test } from "bun:test"
import type { Goal } from "../src/goal.ts"
import { budgetLimitPrompt, COMMAND_HELP, continuationPrompt, render, statusText } from "../src/prompts.ts"

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
