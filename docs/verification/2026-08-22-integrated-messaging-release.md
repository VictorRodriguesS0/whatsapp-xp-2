# Verificação do release integrado de mensagens

Data da verificação: 2026-08-22/23 (America/Sao_Paulo)

## Escopo publicado

- Revisão em produção: `15b323036108bbb4d1240e3bd53db26f90114ddc`.
- A revisão é um merge que contém `e357b344ca425c3bb7db12028d4b9f214ed82169` (busca de mensagens + respostas citadas) e preserva a implementação posterior de reações.
- Imagem em execução: `xp-whatsapp:15b323036108bbb4d1240e3bd53db26f90114ddc`.
- Label OCI da imagem igual à revisão publicada.
- Configuração persistente `XP_WHATSAPP_IMAGE` alinhada à imagem em execução. Backup do arquivo anterior: `/opt/apps/example-app/.env.production.backup`.

## Gate local reproduzível

Ambiente: Node.js 22.15.0, PostgreSQL 18.6 local isolado e FFmpeg 9.0.

- `prisma migrate deploy`: 14 migrações aplicadas, incluindo busca, respostas citadas e reações.
- Vitest: 132 arquivos aprovados, 2 ignorados; 1.212 testes aprovados, 3 ignorados.
- ESLint: aprovado.
- TypeScript (`tsc --noEmit`): aprovado.
- `prisma validate`: schema válido.
- `npm audit --omit=dev`: 0 vulnerabilidades.
- `next build`: aprovado; rotas de busca, contexto, respostas e reações presentes no artefato.

## Evidências de produção

- `https://whatsapp.xpeletronicos.com/api/health`: três amostras consecutivas com `{"status":"ok"}`.
- `/login`: HTTP 200.
- `/conversas` sem sessão: HTTP 307 para autenticação.
- `/api/message-search?q=teste` sem sessão: HTTP 401.
- Verificação inválida do webhook: HTTP 403.
- Banco de produção: 14 migrações e schema atualizado.
- Container da aplicação: saudável, usuário `1001:1001`, zero reinícios após a publicação.
- Container do banco preservado: ID `4804d7dee6031cd657b94ebca9a4bd6c945e364e02b4d974f848d399124ee585`.
- FFmpeg e FFprobe presentes no container.
- Backup validado: `/srv/backups/example-app/example-backup`; hashes do banco e da mídia aprovados.
- Artefato compilado contém os controles de busca e de resposta citada.

## Observações operacionais

- Durante um gate remoto anterior, a KVM reiniciou às 23:57 UTC e encerrou os containers temporários com código 255. A produção recuperou automaticamente; nenhum reboot adicional foi executado. A suíte completa foi então movida para PostgreSQL local, evitando nova carga de testes na KVM.
- Após o release, a Meta repetiu cinco eventos de status de mensagens ainda desconhecidas pelo sistema dentro da janela deliberada de recuperação de cinco minutos. Os eventos ficaram isolados como `FAILED`/retryable, sem falha do banco ou do health check. Na observação final, todos já estavam fora da janela e não houve novo `webhook.processing_failed` nos 30 segundos anteriores; os registros permanecem `FAILED` até a próxima redelivery da Meta, quando o fluxo os encerra sem bloquear os demais webhooks.
