import { Plugin } from "@opencode/plugin/effect"
import { Tool } from "@opencode/schema/tool"
import { Effect, Schema, Semaphore, Stream } from "effect"
import { parseCommand } from "./command.ts"
import { decodeGoal, isUnfinished, step, type Goal, type GoalEffect, type GoalEvent } from "./goal.ts"
import {
  budgetLimitPrompt,
  COMMAND_HELP,
  continuationPrompt,
  formatTokens,
  objectiveUpdatedPrompt,
  sessionContext,
  statusText,
} from "./prompts.ts"

const CreateInput = Schema.Struct({
  objective: Schema.String.annotate({
    description:
      "Required. Rewrite the user's request as an auditable objective: the end state, the command, test, file, or measurement that proves it, and what must not regress. If the proof does not fit in one sentence, ask the user before creating the goal.",
  }),
  token_budget: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))).annotate({
    description: "Positive token budget for the goal. Omit unless the user explicitly asks for one.",
  }),
})

const UpdateInput = Schema.Struct({
  status: Schema.Literals(["complete", "blocked", "paused"]).annotate({
    description:
      "Required. `paused` requires an explicit user request. `complete` only when the objective is achieved and no required work remains. `blocked` only after the same blocking condition has recurred for at least three consecutive goal turns.",
  }),
  note: Schema.optional(Schema.String).annotate({
    description:
      "For `complete`, the requirement-by-requirement evidence. For `blocked`, the blocking condition and the user input or external change it needs.",
  }),
})

// OpenCode 2.0.23 rejected `turn_budget: 6` against Schema.Int ("Expected an integer"). Hand the
// host plain JSON Schema and decode here instead.
const toolInput = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) => ({
  input: Schema.toJsonSchemaDocument(schema).schema,
  decode: (value: unknown) =>
    Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError((issue) => new Tool.Error({ message: `goal: invalid input. ${String(issue)}` })),
    ),
})

const createInput = toolInput(CreateInput)
const updateInput = toolInput(UpdateInput)

const PLANNING_AGENTS = new Set(["plan"])

const toolError = (error: unknown) =>
  error instanceof Tool.Error ? error : new Tool.Error({ message: `goal: ${String(error)}` })

export default Plugin.define({
  id: "goal",
  effect: (ctx) =>
    Effect.gen(function* () {
      const lock = yield* Semaphore.make(1)
      const activity = new Set<string>()
      const agents = new Map<string, string>()
      const resumePending = new Set<string>()
      const closingSteps = new Map<string, string>()
      const key = (sessionID: string) => `goal/${sessionID}`
      const now = () => Date.now()
      const planning = (sessionID: string) => PLANNING_AGENTS.has(agents.get(sessionID) ?? "")

      const load = (sessionID: string) => ctx.storage.get(key(sessionID)).pipe(Effect.map(decodeGoal))

      const save = (sessionID: string, goal: Goal | undefined) =>
        goal ? ctx.storage.set(key(sessionID), goal) : ctx.storage.remove(key(sessionID))

      const send = (sessionID: string, text: string, options: { resume: boolean; delivery: "steer" | "queue" }) =>
        ctx.session
          .synthetic({ sessionID: sessionID as never, text, description: "goal", ...options })
          .pipe(Effect.asVoid)

      const notice = (sessionID: string, text: string) =>
        send(sessionID, `[goal] ${text}`, { resume: false, delivery: "queue" })

      const drive = (sessionID: string, text: string, delivery: "steer" | "queue") =>
        resumePending.has(sessionID)
          ? Effect.void
          : send(sessionID, text, { resume: true, delivery }).pipe(
              Effect.tap(() => Effect.sync(() => resumePending.add(sessionID))),
            )

      const perform = (sessionID: string, goal: Goal | undefined, effect: GoalEffect) => {
        if (effect._tag === "None") return Effect.void
        if (effect._tag === "Notify") return notice(sessionID, effect.text)
        if (!goal) return Effect.void
        switch (effect._tag) {
          case "Continue":
            return drive(sessionID, continuationPrompt(goal, now()), "queue")
          case "WrapUp":
            return drive(sessionID, budgetLimitPrompt(goal, now()), "steer")
          case "ObjectiveUpdated":
            return drive(sessionID, objectiveUpdatedPrompt(goal, now()), "steer")
        }
      }

      const transition = (sessionID: string, event: GoalEvent, options: { readonly quiet?: boolean } = {}) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            const before = yield* load(sessionID)
            const next = step(before, event, now())
            if (next.goal !== before) yield* save(sessionID, next.goal)
            if (!options.quiet) yield* perform(sessionID, next.goal, next.effect)
            return next.goal
          }),
        )

      const ownedGoal = (sessionID: string) =>
        load(sessionID).pipe(Effect.map((goal) => (goal?.directory === ctx.location.directory ? goal : undefined)))

      const onEvent = (sessionID: string, event: GoalEvent) =>
        ownedGoal(sessionID).pipe(
          Effect.flatMap((goal) => (goal ? Effect.asVoid(transition(sessionID, event)) : Effect.void)),
        )

      yield* ctx.command.transform((editor) => {
        editor.add({
          name: "goal",
          description: "Set, show, edit, pause, resume, or clear the session's persistent goal",
          execute: ({ sessionID, prompt }) => {
            const command = parseCommand(prompt.text)
            switch (command._tag) {
              case "Invalid":
                return notice(sessionID, command.message)
              case "Status":
                return load(sessionID).pipe(Effect.flatMap((goal) => notice(sessionID, statusText(goal, now()))))
              case "Set":
                return Effect.asVoid(transition(sessionID, { ...command, directory: ctx.location.directory }))
              default:
                return Effect.asVoid(transition(sessionID, command))
            }
          },
        })
      })

      yield* ctx.tool.transform((editor) => {
        editor.namespace({ name: "goal", description: "The session's persistent goal" })
        editor.add({
          name: "create",
          description:
            "Create a persistent goal that keeps this session working across turns until the objective is audited as complete. Create a goal only when the user or system instructions explicitly ask for one; do not infer goals from ordinary tasks. Set token_budget only when the user asks for a budget. Fails if an unfinished goal exists.",
          input: createInput.input,
          options: { namespace: "goal", codemode: false },
          execute: (raw, context) =>
            Effect.gen(function* () {
              const input = yield* createInput.decode(raw)
              const existing = yield* load(context.sessionID)
              if (isUnfinished(existing)) {
                return yield* new Tool.Error({
                  message: `This session already has an unfinished goal (${existing!.status}). Finish it, or ask the user to replace it with /goal <objective>.`,
                })
              }
              const goal = yield* transition(
                context.sessionID,
                {
                  _tag: "Set",
                  objective: input.objective,
                  tokenBudget: input.token_budget ?? null,
                  directory: ctx.location.directory,
                },
                { quiet: true },
              )
              return { content: `Goal created.\n${statusText(goal, now())}` }
            }).pipe(Effect.mapError(toolError)),
        })
        editor.add({
          name: "get",
          description:
            "Get the session's goal: objective, status, token usage, remaining token budget, and elapsed time. Also returns the /goal command syntax the user can type.",
          input: { type: "object", properties: {}, additionalProperties: false },
          options: { namespace: "goal", codemode: false },
          execute: (_input, context) =>
            load(context.sessionID).pipe(
              Effect.map((goal) => ({ content: `${statusText(goal, now())}\n\n${COMMAND_HELP}` })),
            ),
        })
        editor.add({
          name: "update",
          description: [
            "Update the status of the existing goal.",
            "Set `paused` only at the user's explicit request, never on your own initiative. Report the returned status and stop goal work. Budget limits take precedence over pausing.",
            "Set `complete` only when the objective has actually been achieved and no required work remains, and put the requirement-by-requirement evidence in note.",
            "Set `blocked` only when the same blocking condition has repeated for at least three consecutive goal turns and you cannot make meaningful progress without user input or an external-state change. A resumed goal starts a fresh blocked audit.",
            "Do not use `blocked` merely because the work is hard, slow, uncertain, incomplete, or would benefit from clarification. Do not mark a goal complete because its budget is nearly exhausted or because you are stopping work.",
            "You cannot resume or budget-limit a goal with this tool.",
          ].join("\n"),
          input: updateInput.input,
          options: { namespace: "goal", codemode: false },
          execute: (raw, context) =>
            Effect.gen(function* () {
              const input = yield* updateInput.decode(raw)
              const before = yield* load(context.sessionID)
              if (!before) return yield* new Tool.Error({ message: "No goal is set for this session." })
              const event: GoalEvent =
                input.status === "complete"
                  ? { _tag: "Complete", note: input.note }
                  : input.status === "blocked"
                    ? { _tag: "Block", note: input.note }
                    : { _tag: "PauseRequested", note: input.note }
              const goal = yield* transition(context.sessionID, event)
              if (goal?.status !== input.status) {
                return yield* new Tool.Error({
                  message: `The goal is ${goal?.status ?? "cleared"} and cannot move to ${input.status}.`,
                })
              }
              closingSteps.set(context.sessionID, context.messageID)
              const budget =
                goal.tokenBudget === null
                  ? ""
                  : ` Usage so far: ${formatTokens(goal.tokensUsed)} of ${formatTokens(goal.tokenBudget)} tokens; this step is added when it ends.`
              return { content: `Goal ${goal.status}.${budget}` }
            }).pipe(Effect.mapError(toolError)),
        })
      })

      yield* ctx.tool.hook("execute.after", (event) => Effect.sync(() => activity.add(event.sessionID)))

      yield* ctx.session.hook("context", (event) =>
        Effect.gen(function* () {
          agents.set(event.sessionID, event.agent)
          const goal = yield* ownedGoal(event.sessionID)
          if (goal?.status === "active") event.system.push({ type: "text", text: sessionContext(goal, now()) })
        }),
      )

      const handle = (event: Stream.Success<ReturnType<typeof ctx.event.subscribe>>) => {
        switch (event.type) {
          case "session.execution.started":
            return Effect.sync(() => {
              activity.delete(event.data.sessionID)
              resumePending.delete(event.data.sessionID)
            })
          case "session.text.ended":
            return Effect.sync(() => {
              if (event.data.text.trim()) activity.add(event.data.sessionID)
            })
          case "session.step.ended": {
            const { sessionID, tokens, assistantMessageID } = event.data
            if (planning(sessionID)) return Effect.void
            const closing = closingSteps.get(sessionID) === assistantMessageID
            if (closing) closingSteps.delete(sessionID)
            return onEvent(sessionID, { _tag: "Usage", tokens: tokens.input + tokens.output + tokens.reasoning, closing })
          }
          case "session.execution.succeeded":
            return onEvent(event.data.sessionID, {
              _tag: "TurnEnded",
              activity: activity.has(event.data.sessionID),
              planning: planning(event.data.sessionID),
            })
          case "session.execution.interrupted":
            return onEvent(event.data.sessionID, { _tag: "Interrupted", reason: event.data.reason })
          case "session.execution.failed":
            return onEvent(event.data.sessionID, { _tag: "Failed", message: event.data.error.message })
          case "session.deleted":
            return ctx.storage.remove(key(event.data.sessionID))
          default:
            return Effect.void
        }
      }

      yield* ctx.event.subscribe().pipe(
        Stream.runForEach((event) =>
          handle(event).pipe(Effect.catchCause((cause) => Effect.logError(`goal: ${event.type} failed`, cause))),
        ),
        Effect.catchCause((cause) => Effect.logError("goal: event stream stopped", cause)),
        Effect.forkScoped,
      )
    }),
})
