export type GoalCommand =
  | { readonly _tag: "Status" }
  | { readonly _tag: "Pause" }
  | { readonly _tag: "Resume" }
  | { readonly _tag: "Clear" }
  | { readonly _tag: "Edit"; readonly objective: string }
  | { readonly _tag: "Set"; readonly objective: string; readonly tokenBudget: number | null }
  | { readonly _tag: "Invalid"; readonly message: string }

const keywords = { "": "Status", status: "Status", pause: "Pause", resume: "Resume", clear: "Clear" } as const

const multipliers: Record<string, number> = { "": 1, k: 1_000, m: 1_000_000 }

export const parseTokens = (text: string): number | undefined => {
  const match = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(text)
  if (!match) return undefined
  const tokens = Math.round(Number(match[1]) * multipliers[match[2]!.toLowerCase()]!)
  return tokens > 0 ? tokens : undefined
}

export const parseCommand = (text: string): GoalCommand => {
  const trimmed = text.trim()
  const keyword = keywords[trimmed.toLowerCase() as keyof typeof keywords]
  if (keyword) return { _tag: keyword }

  const edit = /^edit(?:\s+|$)/i.exec(trimmed)
  if (edit) {
    const objective = trimmed.slice(edit[0].length)
    return objective ? { _tag: "Edit", objective } : { _tag: "Invalid", message: "Write the new objective after /goal edit." }
  }

  const budget = /^--tokens(?:=|\s+)(\S+)\s*/i.exec(trimmed)
  if (!budget) return { _tag: "Set", objective: trimmed, tokenBudget: null }

  const tokens = parseTokens(budget[1]!)
  if (tokens === undefined) {
    return { _tag: "Invalid", message: `--tokens needs a positive number such as 50000, 250K or 1.5M, got "${budget[1]}".` }
  }
  const objective = trimmed.slice(budget[0].length)
  return objective
    ? { _tag: "Set", objective, tokenBudget: tokens }
    : { _tag: "Invalid", message: "Write the objective after --tokens N." }
}
