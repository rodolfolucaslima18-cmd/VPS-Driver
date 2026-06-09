---
name: Drizzle sessions filter
description: connect-pg-simple cria a tabela sessions fora do schema drizzle — sem filtro, push-force a apaga.
---

A tabela `sessions` é criada pelo `connect-pg-simple` com `createTableIfMissing: true` e não faz parte do schema drizzle. Sem o filtro, `drizzle-kit push --force` tenta dropá-la a cada migração.

**Why:** Durante update da VPS, o `update.sh` roda `push-force`. Se a tabela sessions for dropada, todos os usuários são deslogados e novos logins falham até o PM2 restartar e recriar a tabela.

**How to apply:** `lib/db/drizzle.config.ts` deve sempre ter:
```ts
tablesFilter: ["!sessions"],
```
Se adicionar outras tabelas gerenciadas externamente (ex: tabelas de jobs, queues), adicionar ao array: `["!sessions", "!outra_tabela"]`.
