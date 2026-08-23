# Conversas fixadas — verificação de produção

Data: 2026-08-23

## Release

- Revisão publicada: `8f223a77bc05c4a592991c34a2cd8d4c955984ae`.
- Imagem imutável: `xp-whatsapp:8f223a77bc05c4a592991c34a2cd8d4c955984ae`.
- ID da imagem: `sha256:78a6187f9b3e8c33dd727d958a92b74862e0c910c83f773509475f717405387e`.
- ID do container: `d383427a62dc869d186015a3b75834c2edea3bd5a969bd7bc1e7d87433c09165`.
- Início estável: `2026-08-23T14:01:14.50579604Z`.
- Release anterior preservada para rollback: `15b323036108bbb4d1240e3bd53db26f90114ddc`.

## Funcionalidade

- Fixar e desfixar conversas sem limite pela lista de atendimento.
- Estado compartilhado e sincronizado em tempo real entre todos os usuários.
- Conversas fixadas antes das demais, com ordem estável e paginação sem duplicações.
- Atualização otimista, reconciliação autoritativa e restauração segura após falha.
- Ação separada de abrir a conversa, disponível por teclado, leitor de tela e toque.

## Gates

- Prisma generate/validate, TypeScript, ESLint e build Next.js: aprovados.
- Auditoria de dependências de produção: zero vulnerabilidades.
- Build Linux limitado a meia CPU, 2 GB de RAM e 3 GB incluindo swap: aprovado sem impacto na produção anterior.
- Imagem final: revisão exata, UID/GID efetivo `1001:1001`, FFmpeg/FFprobe e 15 migrations presentes; testes e configuração Vitest ausentes do runtime.
- Suíte ampla isolada: 130 arquivos e 1.223 testes aprovados; os dois únicos contratos pendentes identificaram a nova coluna temporal e um timeout de migration sob CPU limitada.
- Após a correção dos contratos, os gates afetados e toda a superfície da funcionalidade foram repetidos: 8 arquivos e 148 testes aprovados, incluindo PostgreSQL real com 51 conversas fixadas atravessando a paginação.
- Migration aplicada duas vezes em banco descartável novo sem alteração do ledger: aprovada.

## Backup e deploy

- Backup validado: `/srv/backups/example-app/example-backup`.
- Migration aplicada: `202608230001_pinned_conversations`.
- Estado final: 15 migrations concluídas, nenhuma incompleta e nenhuma revertida.
- `conversations.pinned_at`: `timestamp with time zone`, anulável.
- Índice `conversations_pinned_queue_idx`: presente com `pinned_at DESC NULLS LAST`.
- Somente `xp-whatsapp-app` foi parado e recriado.
- PostgreSQL preservou o mesmo container ID durante toda a implantação.
- Snapshot pré/pós dos 28 containers não relacionados: `dfd527ccc993f67f760e219d408d9a17a1608673d8f926a14da9424f2a14e5cc`, idêntico.

## Pós-deploy

- Saúde local e pública: HTTP 200.
- Login: HTTP 200; conversa sem sessão: HTTP 307 para login.
- Endpoint de fixação sem autenticação: HTTP 401.
- Webhook com assinatura inválida: HTTP 401.
- Provedor Meta e credenciais obrigatórias presentes, sem expor valores.
- Logs desde o início: zero correspondências para erro, exceção, fatal ou pânico.
- Três amostras de estabilidade: saudável, zero reinícios, mesmo banco e mesma imagem.
- Total de containers ativos no host permaneceu em 29.

## Integração paralela

O preflight comparou todas as worktrees. Antes do deploy, a linha `whatsapp-read-sync` continha somente especificação e plano, sem código pronto. Uma implementação não commitada de recibos de leitura começou naquela worktree durante o rollout; ela não fazia parte da produção anterior e não foi incluída incompleta. A release publicada parte da última release integrada de produção e não remove nenhuma funcionalidade publicada.
