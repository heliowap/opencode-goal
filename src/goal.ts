import { Option, Schema } from "effect"

export const Status = Schema.Literals(["active", "paused", "complete", "blocked", "budget_limited"])
export type Status = typeof Status.Type

export const Goal = Schema.Struct({
  objective: Schema.String,
  status: Status,
  turnBudget: Schema.NullOr(Schema.Int),
  turnsUsed: Schema.Int,
  directory: Schema.String,
  note: Schema.optional(Schema.String),
  createdAt: Schema.Finite,
  updatedAt: Schema.Finite,
})
export type Goal = typeof Goal.Type

export const decodeGoal = (value: unknown): Goal | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(Goal)(value))

export type GoalEvent =
  | { readonly _tag: "Set"; readonly objective: string; readonly turnBudget: number | null; readonly directory: string }
  | { readonly _tag: "Pause" }
  | { readonly _tag: "Resume" }
  | { readonly _tag: "Clear" }
  | { readonly _tag: "Complete"; readonly evidence: string }
  | { readonly _tag: "Block"; readonly reason: string }
  | { readonly _tag: "TurnEnded"; readonly toolCalls: number }
  | { readonly _tag: "Interrupted"; readonly reason: "user" | "shutdown" | "superseded" | "inactivity" }
  | { readonly _tag: "Failed"; readonly message: string }

export type GoalEffect =
  | { readonly _tag: "None" }
  | { readonly _tag: "Start" }
  | { readonly _tag: "Continue" }
  | { readonly _tag: "WrapUp" }
  | { readonly _tag: "Notify"; readonly text: string }

export interface Step {
  readonly goal: Goal | undefined
  readonly effect: GoalEffect
}

const none: GoalEffect = { _tag: "None" }
const notify = (text: string): GoalEffect => ({ _tag: "Notify", text })

const settled = (status: Status) => status === "complete" || status === "blocked"

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
        turnBudget: event.turnBudget,
        turnsUsed: 0,
        directory: event.directory,
        createdAt: now,
        updatedAt: now,
      },
      effect: { _tag: "Start" },
    }
  }
  if (!goal) {
    return event._tag === "Pause" || event._tag === "Resume" || event._tag === "Clear"
      ? { goal, effect: notify("Nenhum goal nesta sessão.") }
      : unchanged
  }

  switch (event._tag) {
    case "Clear":
      return { goal: undefined, effect: notify("Goal removido.") }
    case "Pause":
      return goal.status === "active"
        ? update({ status: "paused", note: "Pausado pelo usuário." }, notify("Goal pausado."))
        : { goal, effect: notify(`Goal está ${goal.status}; nada a pausar.`) }
    case "Resume": {
      if (goal.status === "active") return { goal, effect: notify("Goal já está ativo.") }
      if (settled(goal.status)) return { goal, effect: notify(`Goal está ${goal.status}. Defina um novo goal.`) }
      const outOfBudget = goal.turnBudget !== null && goal.turnsUsed >= goal.turnBudget
      return outOfBudget
        ? { goal, effect: notify("Goal sem turnos restantes. Defina um novo goal com --turns maior.") }
        : update({ status: "active", note: undefined }, { _tag: "Continue" })
    }
    case "Complete":
      return goal.status === "active" ? update({ status: "complete", note: event.evidence }) : unchanged
    case "Block":
      return goal.status === "active" ? update({ status: "blocked", note: event.reason }) : unchanged
    case "Interrupted":
      return goal.status === "active" && event.reason === "user"
        ? update({ status: "paused", note: "Interrompido pelo usuário." })
        : unchanged
    case "Failed":
      return goal.status === "active" ? update({ status: "paused", note: `Turno falhou: ${event.message}` }) : unchanged
    case "TurnEnded": {
      if (goal.status !== "active") return unchanged
      const turnsUsed = goal.turnsUsed + 1
      if (goal.turnBudget !== null && turnsUsed >= goal.turnBudget) {
        return update({ turnsUsed, status: "budget_limited", note: "Orçamento de turnos esgotado." }, { _tag: "WrapUp" })
      }
      return update({ turnsUsed }, event.toolCalls > 0 ? { _tag: "Continue" } : none)
    }
  }
}
