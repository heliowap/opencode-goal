import type { Goal } from "./goal.ts"

const turns = (goal: Goal) =>
  goal.turnBudget === null ? `${goal.turnsUsed} turnos usados, sem orçamento` : `${goal.turnsUsed} de ${goal.turnBudget} turnos`

const elapsed = (goal: Goal, now: number) => {
  const minutes = Math.floor((now - goal.createdAt) / 60_000)
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

export const stripFrontmatter = (markdown: string) => markdown.replace(/^---\n[\s\S]*?\n---\n/, "").trim()

export const systemBlock = (goal: Goal, protocol: string) =>
  ["<goal>", "Goal ativo nesta sessão:", goal.objective, "</goal>", "", protocol].join("\n")

export const startPrompt = (goal: Goal) =>
  [
    "Um goal foi definido para esta sessão:",
    "",
    goal.objective,
    "",
    "Comece agora. Siga o protocolo do goal no system prompt e continue até concluir, travar ou esgotar o orçamento.",
  ].join("\n")

export const continuePrompt = (goal: Goal) =>
  [
    `Continue o goal ativo (${turns(goal)}).`,
    "Execute e verifique o próximo passo concreto.",
    'Quando cada requisito tiver evidência, chame goal_update com status "complete". Se tudo depender do usuário, use status "blocked".',
  ].join("\n")

export const wrapUpPrompt = (goal: Goal) =>
  [
    `O orçamento do goal acabou (${turns(goal)}).`,
    "Pare o trabalho substantivo. Resuma o progresso, os bloqueios e o próximo passo útil.",
    "O goal não está concluído.",
  ].join("\n")

export const statusText = (goal: Goal | undefined, now: number) => {
  if (!goal) return "Nenhum goal nesta sessão. Defina com /goal [--turns N] <objetivo>."
  return [
    `Goal ${goal.status} · ${turns(goal)} · ${elapsed(goal, now)}`,
    goal.objective,
    ...(goal.note ? [`Nota: ${goal.note}`] : []),
  ].join("\n")
}
