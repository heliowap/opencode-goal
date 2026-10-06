import { afterEach, describe, expect, test } from "bun:test"
import { afterToolResult } from "./harness/fixture.ts"
import { Host, type Session } from "./harness/host.ts"

const TIMEOUT = 180_000
const tmux = Bun.which("tmux")
let host: Host | undefined
let terminal: string | undefined

afterEach(async () => {
  if (terminal) Bun.spawnSync(["tmux", "kill-session", "-t", terminal])
  terminal = undefined
  await host?.stop()
  host = undefined
})

const open = (session: Session) => {
  terminal = `goal-tui-${process.pid}-${Date.now()}`
  const env = ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "OPENCODE_SERVER_PASSWORD"]
  const spawned = Bun.spawnSync([
    "tmux", "new-session", "-d", "-s", terminal, "-x", "160", "-y", "40", "-c", host!.project,
    "env", ...env.map((name) => `${name}=${host!.env[name]}`), "TERM=xterm-256color",
    process.env.OPENCODE_BIN ?? "opencode", "--server", host!.base, "--session", session.id,
  ])
  expect(spawned.exitCode).toBe(0)
}

const screen = () => Bun.spawnSync(["tmux", "capture-pane", "-p", "-t", terminal!]).stdout.toString()

const badgeLine = () => {
  const lines = screen().split("\n")
  const input = lines.findIndex((line) => line.trimStart().startsWith("┃"))
  const above = input > 0 ? lines[input - 1]! : ""
  return above.slice(0, 100).trim()
}

const shows = async (expected: string, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (badgeLine() === expected) return
    await Bun.sleep(250)
  }
  throw new Error(`the line above the input never showed "${expected}". Screen:\n${screen()}`)
}

describe.skipIf(!tmux && !process.env.CI)("status above the input in the terminal UI", () => {
  test(
    "T1 running with usage, then paused, then gone after clear",
    async () => {
      host = await Host.start({ script: () => ({ text: "Step.", delayMs: 4_000 }) })
      const session = await host.session()
      await host.goal(session, "--tokens 50K show me in the bar")
      open(session)

      await shows("◎ goal running · 120 / 50K")
      await shows("◎ goal running · 240 / 50K")
      await host.goal(session, "pause")
      await shows("⏸ goal paused")
      await host.settle(session)
      await host.goal(session, "clear")
      await shows("")
      expect(host.stored(session)).toBeUndefined()
    },
    TIMEOUT,
  )

  test(
    "T2 an active goal between turns, blocked, and over budget",
    async () => {
      host = await Host.start({
        script: (request) => {
          if (request.messages.some((message) => message.role === "user" && JSON.stringify(message).includes("over budget"))) {
            return afterToolResult(request) ? { text: "Done." } : { text: "Spending." }
          }
          return { empty: true }
        },
      })
      const planned = await host.session("plan")
      await host.goal(planned, "plan only")
      open(planned)
      await host.settle(planned)
      await shows("◎ goal active · 0")
      Bun.spawnSync(["tmux", "kill-session", "-t", terminal!])

      const blocked = await host.session()
      await host.goal(blocked, "nothing happens")
      await host.settle(blocked)
      expect(host.stored(blocked)?.status).toBe("blocked")
      open(blocked)
      await shows("⚠ goal blocked")
      Bun.spawnSync(["tmux", "kill-session", "-t", terminal!])

      const limited = await host.session()
      await host.goal(limited, "--tokens 100 over budget")
      await host.settle(limited)
      expect(host.stored(limited)).toMatchObject({ status: "budget_limited", tokensUsed: 240 })
      open(limited)
      await shows("goal budget reached · 240 / 100")
    },
    TIMEOUT,
  )
})
