# AGENTS.md

OpenCode 2 plugin that adds a Codex-style `/goal`. Bun, TypeScript, Effect.

Before editing `src/`, `test/`, or `templates/`, read `CODING_STANDARDS.md`.

- Verify with `bun test` and `bun run typecheck`; changes to `src/index.ts` also need `bun test ./host`; changes to `src/goal.ts`, `src/command.ts`, `src/prompts.ts`, `src/badge.ts`, or `src/format.ts` also need `bun run mutation`; changes to `src/tui.tsx` need `bun test ./host/tui.test.ts` (requires tmux).
- Write everything in English: code, comments, docs, commit messages, issues, and pull requests.
- This checkout is the live plugin on this machine: saving `src/` reloads it in every OpenCode session.
