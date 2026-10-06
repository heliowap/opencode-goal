# opencode-goal

`/goal` no estilo do Codex para o OpenCode 2. Um objetivo persistente por sessão que mantém o agente trabalhando entre turnos até a conclusão ser auditada com evidência.

## Instalar

```sh
bun install
./install.sh
```

O `install.sh` cria dois links em `~/.config/opencode`. `plugins/goal.ts` aponta para `src/index.ts` e `skills/goal` aponta para `skill/`.

## Usar

```text
/goal fazer a suíte de checkout passar sem mudar a API pública
/goal --turns 20 migrar os testes de Jest para Vitest
/goal            mostra o goal
/goal pause
/goal resume
/goal clear
```

O agente também cria e encerra goals com as tools `goal_create`, `goal_get` e `goal_update`.

## Como funciona

- O estado fica em `ctx.storage` do plugin, na chave `goal/<sessionID>`, e sobrevive a reinícios.
- Quando um turno termina (`session.execution.succeeded`) com o goal `active`, o plugin envia uma mensagem sintética que abre o próximo turno.
- Um turno sem chamada de ferramenta não abre outro. É assim que o agente espera o usuário.
- O usuário interromper o turno pausa o goal. Uma falha de turno também pausa.
- Ao esgotar `--turns`, o goal vira `budget_limited` e o agente recebe um último turno para resumir.
- Com o goal ativo, o protocolo de `skill/SKILL.md` entra no system prompt de cada turno.

Toda a lógica de estado está no reducer puro `step` em `src/goal.ts`. O `src/index.ts` só traduz eventos do OpenCode para `GoalEvent` e executa o `GoalEffect` devolvido.

## Limitação conhecida

A resposta de `/goal`, `pause`, `resume` e `clear` vai para a fila da sessão como mensagem sintética. Ela aparece na conversa no próximo turno, não na hora.

## Desenvolver

```sh
bun test
bun run typecheck
```
