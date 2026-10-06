import { expect, test } from "bun:test"
import { parseCommand } from "../src/command.ts"

test.each([
  ["", { _tag: "Status" }],
  ["  status ", { _tag: "Status" }],
  ["pause", { _tag: "Pause" }],
  ["RESUME", { _tag: "Resume" }],
  ["clear", { _tag: "Clear" }],
  ["fix the flaky auth tests", { _tag: "Set", objective: "fix the flaky auth tests", turnBudget: null }],
  ["--turns 20 migrate to vitest", { _tag: "Set", objective: "migrate to vitest", turnBudget: 20 }],
  ["--turns=5 shrink the bundle", { _tag: "Set", objective: "shrink the bundle", turnBudget: 5 }],
  ["--turns 0 x", { _tag: "Invalid", message: '--turns precisa de um inteiro positivo, recebeu "0".' }],
  ["--turns abc x", { _tag: "Invalid", message: '--turns precisa de um inteiro positivo, recebeu "abc".' }],
  ["--turns 3", { _tag: "Invalid", message: "Escreva o objetivo depois de --turns N." }],
] as const)("parseCommand(%p)", (input, expected) => {
  expect(parseCommand(input)).toEqual(expected)
})
