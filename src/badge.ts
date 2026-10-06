import type { Goal, Status } from "./goal.ts"
import { formatTokens } from "./prompts.ts"

export type Tone = "accent" | "muted" | "warning" | "error"

export interface Badge {
  readonly text: string
  readonly tone: Tone
}

const usage = (goal: Goal) =>
  goal.tokenBudget === null
    ? formatTokens(goal.tokensUsed)
    : `${formatTokens(goal.tokensUsed)} / ${formatTokens(goal.tokenBudget)}`

const badges: Record<Status, (goal: Goal, running: boolean) => Badge | undefined> = {
  active: (goal, running) =>
    running
      ? { text: `◎ goal running · ${usage(goal)}`, tone: "accent" }
      : { text: `◎ goal active · ${usage(goal)}`, tone: "muted" },
  paused: () => ({ text: "⏸ goal paused", tone: "warning" }),
  blocked: () => ({ text: "⚠ goal blocked", tone: "error" }),
  budget_limited: (goal) => ({ text: `goal budget reached · ${usage(goal)}`, tone: "warning" }),
  complete: () => undefined,
}

export const goalBadge = (goal: Goal | undefined, running: boolean): Badge | undefined =>
  goal && badges[goal.status](goal, running)
