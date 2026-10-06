---
name: Goal
description: Objetivo persistente que mantém a sessão trabalhando entre turnos até um critério verificável. Use quando o usuário pedir para seguir trabalhando até uma condição ficar verdadeira, ou para rodar sem parar até terminar.
---

# Goal

Um goal é um contrato de conclusão: o resultado, a prova de que terminou e o que não pode regredir. O plugin `goal` guarda esse contrato por sessão e abre um novo turno sempre que o anterior termina tendo usado ferramentas, até o goal sair de `active`.

## Criar

Crie um goal quando o usuário pedir trabalho contínuo até uma condição. Antes de chamar `goal_create`, reescreva o pedido como um objetivo auditável:

- **Resultado.** O que precisa ser verdade no fim.
- **Prova.** O comando, teste, arquivo ou medição que mostra o resultado.
- **Restrições.** O que não pode regredir no caminho.

Se a prova não couber numa frase, pergunte ao usuário antes de criar. O usuário também cria o goal com `/goal [--turns N] <objetivo>`.

## Perseguir

Em cada turno, escolha o próximo passo concreto que aproxima o resultado, execute e verifique. Feche o turno com uma linha de progresso: o que mudou, a evidência e o próximo passo.

Um turno que termina sem chamada de ferramenta suspende a continuação automática. Use isso para esperar o usuário: faça a pergunta e encerre o turno.

## Auditar e encerrar

Chame `goal_update` com `status: "complete"` só depois da auditoria. Liste cada requisito do objetivo e, ao lado, a evidência observada neste trabalho: saída de comando, resultado de teste, conteúdo de arquivo. Um requisito sem evidência mantém o goal ativo.

Chame `goal_update` com `status: "blocked"` quando todo caminho restante depender de uma decisão do usuário. Diga qual decisão falta.

Quando o orçamento de turnos acabar, pare o trabalho substantivo e entregue o resumo: progresso, bloqueios e o próximo passo útil. Orçamento esgotado é uma parada, não uma conclusão.
