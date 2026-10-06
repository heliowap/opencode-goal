export type GoalCommand =
  | { readonly _tag: "Status" }
  | { readonly _tag: "Pause" }
  | { readonly _tag: "Resume" }
  | { readonly _tag: "Clear" }
  | { readonly _tag: "Set"; readonly objective: string; readonly turnBudget: number | null }
  | { readonly _tag: "Invalid"; readonly message: string }

const keywords = { "": "Status", status: "Status", pause: "Pause", resume: "Resume", clear: "Clear" } as const

export const parseCommand = (text: string): GoalCommand => {
  const trimmed = text.trim()
  const keyword = keywords[trimmed.toLowerCase() as keyof typeof keywords]
  if (keyword) return { _tag: keyword }

  const budget = /^--turns(?:=|\s+)(\S+)\s*/.exec(trimmed)
  if (!budget) return { _tag: "Set", objective: trimmed, turnBudget: null }

  const turns = Number(budget[1])
  if (!Number.isInteger(turns) || turns < 1) {
    return { _tag: "Invalid", message: `--turns precisa de um inteiro positivo, recebeu "${budget[1]}".` }
  }
  const objective = trimmed.slice(budget[0].length).trim()
  return objective
    ? { _tag: "Set", objective, turnBudget: turns }
    : { _tag: "Invalid", message: "Escreva o objetivo depois de --turns N." }
}
