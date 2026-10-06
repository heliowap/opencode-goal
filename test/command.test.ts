import { expect, test } from "bun:test"
import { parseCommand, parseTokens } from "../src/command.ts"

test.each([
  ["", { _tag: "Status" }],
  ["  status ", { _tag: "Status" }],
  ["pause", { _tag: "Pause" }],
  ["RESUME", { _tag: "Resume" }],
  ["clear", { _tag: "Clear" }],
  ["edit only fix the login test", { _tag: "Edit", objective: "only fix the login test" }],
  ["edit", { _tag: "Invalid", message: "Write the new objective after /goal edit." }],
  ["editorial pass on the docs", { _tag: "Set", objective: "editorial pass on the docs", tokenBudget: null }],
  ["fix the flaky auth tests", { _tag: "Set", objective: "fix the flaky auth tests", tokenBudget: null }],
  ["--tokens 50000 migrate to vitest", { _tag: "Set", objective: "migrate to vitest", tokenBudget: 50_000 }],
  ["--tokens=250K shrink the bundle", { _tag: "Set", objective: "shrink the bundle", tokenBudget: 250_000 }],
  ["--tokens 1.5m port the parser", { _tag: "Set", objective: "port the parser", tokenBudget: 1_500_000 }],
  ["--tokens 0 x", { _tag: "Invalid", message: '--tokens needs a positive number such as 50000, 250K or 1.5M, got "0".' }],
  ["--tokens abc x", { _tag: "Invalid", message: '--tokens needs a positive number such as 50000, 250K or 1.5M, got "abc".' }],
  ["--tokens 3K", { _tag: "Invalid", message: "Write the objective after --tokens N." }],
] as const)("parseCommand(%p)", (input, expected) => {
  expect(parseCommand(input)).toEqual(expected)
})

test.each([
  ["2k", 2_000],
  ["2K", 2_000],
  ["0.5m", 500_000],
  ["10", 10],
  ["0.0001", undefined],
  ["-5", undefined],
  ["5x", undefined],
  ["", undefined],
] as const)("parseTokens(%p) = %p", (text, expected) => {
  expect(parseTokens(text)).toBe(expected)
})
