import { readFileSync } from "node:fs"
import { Plugin } from "@opencode/plugin/effect"
import { Tool } from "@opencode/schema/tool"
import { Effect, Schema, Semaphore, Stream } from "effect"
import { parseCommand } from "./command.ts"
import { decodeGoal, step, type Goal, type GoalEffect, type GoalEvent } from "./goal.ts"
import { continuePrompt, startPrompt, statusText, stripFrontmatter, systemBlock, wrapUpPrompt } from "./prompts.ts"

const protocol = stripFrontmatter(readFileSync(new URL("../skill/SKILL.md", import.meta.url), "utf8"))

const CreateInput = Schema.Struct({
  objective: Schema.String.annotate({
    description: "Objetivo auditável: resultado, prova de conclusão e restrições.",
  }),
  turn_budget: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))).annotate({
    description: "Máximo de turnos. Omita para não limitar.",
  }),
})

const UpdateInput = Schema.Struct({
  status: Schema.Literals(["complete", "blocked"]),
  evidence: Schema.String.annotate({
    description: "complete: cada requisito com a evidência observada. blocked: a decisão que falta do usuário.",
  }),
})

// OpenCode 2.0.23 rejected `turn_budget: 6` against Schema.Int ("Expected an integer"). Hand the
// host plain JSON Schema and decode here instead.
const toolInput = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) => ({
  input: Schema.toJsonSchemaDocument(schema).schema,
  decode: (value: unknown) =>
    Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError((issue) => new Tool.Error({ message: `goal: entrada inválida. ${String(issue)}` })),
    ),
})

const createInput = toolInput(CreateInput)
const updateInput = toolInput(UpdateInput)

export default Plugin.define({
  id: "goal",
  effect: (ctx) =>
    Effect.gen(function* () {
      const lock = yield* Semaphore.make(1)
      const toolCalls = new Map<string, number>()
      const resumePending = new Set<string>()
      const key = (sessionID: string) => `goal/${sessionID}`
      const now = () => Date.now()

      const load = (sessionID: string) => ctx.storage.get(key(sessionID)).pipe(Effect.map(decodeGoal))

      const save = (sessionID: string, goal: Goal | undefined) =>
        goal ? ctx.storage.set(key(sessionID), goal) : ctx.storage.remove(key(sessionID))

      const send = (sessionID: string, text: string, resume: boolean) =>
        ctx.session
          .synthetic({ sessionID: sessionID as never, text, description: "goal", resume, delivery: "queue" })
          .pipe(Effect.asVoid)

      const resumeOnce = (sessionID: string, text: string) =>
        resumePending.has(sessionID)
          ? Effect.void
          : send(sessionID, text, true).pipe(Effect.tap(() => Effect.sync(() => resumePending.add(sessionID))))

      const perform = (sessionID: string, goal: Goal | undefined, effect: GoalEffect) => {
        switch (effect._tag) {
          case "None":
            return Effect.void
          case "Notify":
            return send(sessionID, `[goal] ${effect.text}`, false)
          case "Start":
            return goal ? resumeOnce(sessionID, startPrompt(goal)) : Effect.void
          case "Continue":
            return goal ? resumeOnce(sessionID, continuePrompt(goal)) : Effect.void
          case "WrapUp":
            return goal ? resumeOnce(sessionID, wrapUpPrompt(goal)) : Effect.void
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

      const toolError = (error: unknown) => new Tool.Error({ message: `goal: ${String(error)}` })

      const ownedGoal = (sessionID: string) =>
        load(sessionID).pipe(Effect.map((goal) => (goal?.directory === ctx.location.directory ? goal : undefined)))

      yield* ctx.command.transform((editor) => {
        editor.add({
          name: "goal",
          description: "Define, mostra, pausa, retoma ou limpa o goal persistente da sessão",
          execute: ({ sessionID, prompt }) => {
            const command = parseCommand(prompt.text)
            switch (command._tag) {
              case "Invalid":
                return send(sessionID, `[goal] ${command.message}`, false)
              case "Status":
                return load(sessionID).pipe(
                  Effect.flatMap((goal) => send(sessionID, `[goal] ${statusText(goal, now())}`, false)),
                )
              case "Set":
                return transition(sessionID, { ...command, directory: ctx.location.directory })
              default:
                return transition(sessionID, command)
            }
          },
        })
      })

      yield* ctx.tool.transform((editor) => {
        editor.namespace({ name: "goal", description: "Goal persistente da sessão" })
        editor.add({
          name: "create",
          description:
            "Cria um goal persistente: a sessão continua trabalhando entre turnos até o objetivo ser auditado como concluído. Use só quando o usuário pedir trabalho contínuo até uma condição.",
          input: createInput.input,
          options: { namespace: "goal", codemode: false },
          execute: (raw, context) =>
            Effect.gen(function* () {
              const input = yield* createInput.decode(raw)
              const existing = yield* load(context.sessionID)
              if (existing && (existing.status === "active" || existing.status === "paused")) {
                return { content: `Já existe um goal ${existing.status}. O usuário troca com /goal <objetivo>.` }
              }
              const goal = yield* transition(
                context.sessionID,
                {
                  _tag: "Set",
                  objective: input.objective,
                  turnBudget: input.turn_budget ?? null,
                  directory: ctx.location.directory,
                },
                { quiet: true },
              )
              return { content: `Goal criado.\n${statusText(goal, now())}` }
            }).pipe(Effect.mapError((error) => (error instanceof Tool.Error ? error : toolError(error)))),
        })
        editor.add({
          name: "get",
          description: "Mostra o goal da sessão: objetivo, status, turnos e nota.",
          input: { type: "object", properties: {}, additionalProperties: false },
          options: { namespace: "goal", codemode: false },
          execute: (_input, context) =>
            load(context.sessionID).pipe(Effect.map((goal) => ({ content: statusText(goal, now()) }))),
        })
        editor.add({
          name: "update",
          description:
            'Encerra o goal ativo. "complete" exige a auditoria com evidência para cada requisito. "blocked" quando todo caminho depende do usuário.',
          input: updateInput.input,
          options: { namespace: "goal", codemode: false },
          execute: (raw, context) =>
            updateInput.decode(raw).pipe(
              Effect.flatMap((input) =>
                transition(
                  context.sessionID,
                  input.status === "complete"
                    ? { _tag: "Complete", evidence: input.evidence }
                    : { _tag: "Block", reason: input.evidence },
                ).pipe(Effect.mapError(toolError)),
              ),
              Effect.map((goal) => ({
                content: goal ? `Goal ${goal.status}.` : "Nenhum goal nesta sessão.",
              })),
            ),
        })
      })

      yield* ctx.tool.hook("execute.after", (event) =>
        Effect.sync(() => toolCalls.set(event.sessionID, (toolCalls.get(event.sessionID) ?? 0) + 1)),
      )

      yield* ctx.session.hook("context", (event) =>
        ownedGoal(event.sessionID).pipe(
          Effect.map((goal) => {
            if (goal?.status === "active") event.system.push({ type: "text", text: systemBlock(goal, protocol) })
          }),
        ),
      )

      const onEvent = (sessionID: string, event: GoalEvent) =>
        ownedGoal(sessionID).pipe(
          Effect.flatMap((goal) => (goal ? Effect.asVoid(transition(sessionID, event)) : Effect.void)),
        )

      const handle = (event: Stream.Success<ReturnType<typeof ctx.event.subscribe>>) => {
        switch (event.type) {
          case "session.execution.started":
            return Effect.sync(() => {
              toolCalls.set(event.data.sessionID, 0)
              resumePending.delete(event.data.sessionID)
            })
          case "session.execution.succeeded":
            return onEvent(event.data.sessionID, {
              _tag: "TurnEnded",
              toolCalls: toolCalls.get(event.data.sessionID) ?? 0,
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
