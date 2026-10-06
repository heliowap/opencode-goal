import { Option, Schema } from "effect"

export const Status = Schema.Literals(["active", "paused", "blocked", "budget_limited", "complete"])
export type Status = typeof Status.Type

export const Goal = Schema.Struct({
  objective: Schema.String,
  status: Status,
  tokenBudget: Schema.NullOr(Schema.Int),
  tokensUsed: Schema.Int,
  emptyTurns: Schema.Int,
  directory: Schema.String,
  note: Schema.optional(Schema.String),
  createdAt: Schema.Finite,
  updatedAt: Schema.Finite,
})
export type Goal = typeof Goal.Type

export const decodeGoal = (value: unknown): Goal | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(Goal)(value))

export const EMPTY_TURN_LIMIT = 3

export type GoalEvent =
  | { readonly _tag: "Set"; readonly objective: string; readonly tokenBudget: number | null; readonly directory: string }
  | { readonly _tag: "Edit"; readonly objective: string }
  | { readonly _tag: "Pause" }
  | { readonly _tag: "Resume" }
  | { readonly _tag: "Clear" }
  | { readonly _tag: "Complete"; readonly note: string | undefined }
  | { readonly _tag: "Block"; readonly note: string | undefined }
  | { readonly _tag: "PauseRequested"; readonly note: string | undefined }
  | { readonly _tag: "Usage"; readonly tokens: number; readonly closing: boolean }
  | { readonly _tag: "TurnEnded"; readonly activity: boolean; readonly planning: boolean }
  | { readonly _tag: "Interrupted"; readonly reason: "user" | "shutdown" | "superseded" | "inactivity" }
  | { readonly _tag: "Failed"; readonly message: string }

export type GoalEffect =
  | { readonly _tag: "None" }
  | { readonly _tag: "Continue" }
  | { readonly _tag: "WrapUp" }
  | { readonly _tag: "ObjectiveUpdated" }
  | { readonly _tag: "Notify"; readonly text: string }

export interface Step {
  readonly goal: Goal | undefined
  readonly effect: GoalEffect
}

const none: GoalEffect = { _tag: "None" }
const notify = (text: string): GoalEffect => ({ _tag: "Notify", text })

export const isUnfinished = (goal: Goal | undefined) => goal !== undefined && goal.status !== "complete"

const outOfBudget = (goal: Goal) => goal.tokenBudget !== null && goal.tokensUsed >= goal.tokenBudget

const resumeRefusal = (goal: Goal): string | undefined => {
  if (goal.status === "complete") return "The goal is complete. Set a new goal instead."
  if (outOfBudget(goal)) return "The goal has used its token budget. Set a new goal with a larger --tokens budget."
  return undefined
}

export const step = (goal: Goal | undefined, event: GoalEvent, now: number): Step => {
  const unchanged: Step = { goal, effect: none }
  const update = (patch: Partial<Goal>, effect: GoalEffect = none): Step => ({
    goal: goal && { ...goal, ...patch, updatedAt: now },
    effect,
  })

  if (event._tag === "Set") {
    return {
      goal: {
        objective: event.objective,
        status: "active",
        tokenBudget: event.tokenBudget,
        tokensUsed: 0,
        emptyTurns: 0,
        directory: event.directory,
        createdAt: now,
        updatedAt: now,
      },
      effect: { _tag: "Continue" },
    }
  }
  if (!goal) {
    return event._tag === "Pause" || event._tag === "Resume" || event._tag === "Clear" || event._tag === "Edit"
      ? { goal, effect: notify("No goal is set for this session.") }
      : unchanged
  }

  switch (event._tag) {
    case "Clear":
      return { goal: undefined, effect: notify("Goal cleared.") }
    case "Edit": {
      if (goal.status === "active") return update({ objective: event.objective, emptyTurns: 0 }, { _tag: "ObjectiveUpdated" })
      const refusal = resumeRefusal(goal)
      if (refusal) return { goal, effect: notify(refusal) }
      return update(
        { objective: event.objective },
        notify(`Objective updated. The goal is ${goal.status}; run /goal resume to continue.`),
      )
    }
    case "Pause":
      return goal.status === "active"
        ? update({ status: "paused", note: "Paused by the user." }, notify("Goal paused."))
        : { goal, effect: notify(`The goal is ${goal.status}; nothing to pause.`) }
    case "PauseRequested":
      return goal.status === "active" ? update({ status: "paused", note: event.note ?? "Paused at the user's request." }) : unchanged
    case "Resume": {
      if (goal.status === "active") return { goal, effect: notify("The goal is already active.") }
      const refusal = resumeRefusal(goal)
      if (refusal) return { goal, effect: notify(refusal) }
      return update({ status: "active", note: undefined, emptyTurns: 0 }, { _tag: "Continue" })
    }
    case "Complete":
      return goal.status === "active" || goal.status === "budget_limited"
        ? update({ status: "complete", note: event.note })
        : unchanged
    case "Block":
      return goal.status === "active" ? update({ status: "blocked", note: event.note }) : unchanged
    case "Usage": {
      const tokensUsed = goal.tokensUsed + event.tokens
      if (goal.status !== "active" && goal.status !== "budget_limited") return event.closing ? update({ tokensUsed }) : unchanged
      if (goal.status === "active" && goal.tokenBudget !== null && tokensUsed >= goal.tokenBudget) {
        return update({ tokensUsed, status: "budget_limited", note: "Token budget reached." }, { _tag: "WrapUp" })
      }
      return update({ tokensUsed })
    }
    case "Interrupted":
      return goal.status === "active" && event.reason === "user"
        ? update({ status: "paused", note: "Interrupted by the user." })
        : unchanged
    case "Failed":
      return goal.status === "active" ? update({ status: "blocked", note: `Turn failed: ${event.message}` }) : unchanged
    case "TurnEnded": {
      if (goal.status !== "active" || event.planning) return unchanged
      if (event.activity) return update({ emptyTurns: 0 }, { _tag: "Continue" })
      const emptyTurns = goal.emptyTurns + 1
      return emptyTurns >= EMPTY_TURN_LIMIT
        ? update({ emptyTurns, status: "blocked", note: `${EMPTY_TURN_LIMIT} consecutive turns produced no output.` })
        : update({ emptyTurns }, { _tag: "Continue" })
    }
  }
}
