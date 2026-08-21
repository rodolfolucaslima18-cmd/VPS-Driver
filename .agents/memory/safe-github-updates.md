---
name: Safe GitHub updates
description: Safety rules for the VPS Drive updater that fetches application code from GitHub.
---

Atualizações pelo GitHub devem trocar somente código e dependências: nunca devem
editar o `.env` nem executar automaticamente operações de schema que possam
aceitar perda de dados. Quando o armazenamento estiver dentro da pasta da
instalação, ele precisa ser preservado antes de qualquer operação que substitua
arquivos.

**Why:** Um reset Git, um rsync com exclusão e comandos de schema forçados podem
sobrescrever arquivos enviados, modificar a configuração do operador ou alterar
dados de forma irreversível.

**How to apply:** Para mudanças futuras, use migrações versionadas e revisadas
separadamente da atualização de código. Mantenha o backup/restauração explícito
para armazenamento relativo à instalação e deixe caminhos externos intocados.